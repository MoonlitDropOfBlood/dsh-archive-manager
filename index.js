/**
 * dsh-archive-manager — Host half.
 *
 * A Cordis "class plugin": this module exports an `ArchiveManagerService`
 * extending `TypertRemoteService`. The DSH loader instantiates the class and
 * registers it as the `archiveManager` service; the Typert Gateway exposes its
 * `@Remote`-marked methods to the browser Client half under the
 * `archiveManager` Remote namespace.
 *
 * Responsibilities:
 *   - `restore`: remove a session from the workspace registry's archive set
 *     (durable write through the registry's own state writer, which keeps the
 *     registry cache, the domain store and the `host/archived-sessions-changed`
 *     client frame in sync).
 *   - `delete`: refuse sessions whose agent is actually running, remove the
 *     session's durable log directory via the shell, then drop the archive
 *     entry. Live-but-idle sessions keep their archive entry so they do not
 *     "revive" in the sidebar; the `state` call marks them as ghost.
 *   - `state`: report which archived sessions are still live in memory while
 *     their log files no longer exist (ghost records the Client hides).
 */

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Service } from "@deepseek-ai/cordis";

/**
 * Mark one instance method as a Remote export without relying on decorator
 * syntax (Node ESM does not support the proposal decorators here). We drive
 * the same `Remote(name)` decorator manually through a synthetic decorator
 * context and run the registered initializers against the instance.
 *
 * @param {object} instance - live service instance whose prototype is marked.
 * @param {string} method - public instance method name.
 * @param {string} [exportName] - wire export name; defaults to the method name.
 */
function markRemoteMethod(instance, method, exportName) {
  const decorator = Remote(method, undefined);
  const initializers = [];
  decorator(undefined, {
    kind: "method",
    name: method,
    static: false,
    private: false,
    addInitializer: (fn) => initializers.push(fn),
  });
  for (const fn of initializers) fn.call(instance);
}

/**
 * Read the current archive set from the authoritative workspace domain, with a
 * fallback to the registry's own getter when the domain is unavailable.
 */
function readArchived(domain) {
  if (domain) {
    try {
      const state = domain.global.get();
      if (state && Array.isArray(state.archivedSessionIds)) {
        return [...state.archivedSessionIds];
      }
    } catch {
      /* fall through to registry getter */
    }
  }
  const registry = this?.ctx?.get?.("workspaceRegistry");
  if (registry && Array.isArray(registry.archivedSessionIds)) {
    return [...registry.archivedSessionIds];
  }
  return [];
}

export class ArchiveManagerService extends TypertRemoteService {
  static inject = [
    "workspaceRegistry",
    "storageDomain",
    "sessionPersistence",
    "sessionQuery",
    "shell",
    "sandboxPolicy",
    "sessions",
    "agents",
  ];

  /**
   * Cordis instantiates class plugins with `new Callback(ctx, config)` — the
   * second argument is the plugin config, NOT the service key. `TypertRemoteService`
   * has a `(ctx, serviceKey, options)` constructor that validates the key; without
   * an explicit constructor here, `config` is passed as `serviceKey` and the
   * `validateName` check throws during construction. As a result the `archiveManager`
   * service was never registered, so the client stayed pending forever on
   * `remote.archiveManager` (web boot: 1 entry did not activate). Match the official
   * `MessageFeedbackService` pattern: pass the exact service key to `super()`.
   */
  constructor(ctx, config) {
    super(ctx, "archiveManager");
  }

  /**
   * Cordis class-plugin initializer: runs right after construction, before the
   * service is published. Mark every Remote method and cache resolved config.
   */
  [Service.init]() {
    markRemoteMethod(this, "restore", "restore");
    markRemoteMethod(this, "delete", "delete");
    markRemoteMethod(this, "state", "state");
  }

  /** Resolve the workspace domain (the domain the registry opened). */
  workspaceDomain() {
    const domain = this.ctx.get("storageDomain");
    return domain ? domain.get("workspace") : undefined;
  }

  /** The currently configured workspace-write root, for shell policy. */
  workspaceRoot() {
    const policy = this.ctx.get("sandboxPolicy");
    return policy && typeof policy.workspaceRoot === "string" ? policy.workspaceRoot : "";
  }

  /**
   * Remove a session from the archive set using the registry's own state
   * writer: durable write + registry cache sync + `domain/changed` emission.
   */
  async writeArchived(next) {
    const domain = this.workspaceDomain();
    if (!domain) throw new Error("workspace domain unavailable");
    const state = domain.global.get();
    await this.ctx.workspaceRegistry.setState({
      ...state,
      archivedSessionIds: next,
    });
  }

  /** Resolve a session header (live-preferred, then persisted). */
  async findHeader(sessionId) {
    const sessionQuery = this.ctx.get("sessionQuery");
    if (sessionQuery && typeof sessionQuery.listSessions === "function") {
      try {
        const records = await sessionQuery.listSessions();
        const rec = records.find((r) => String(r.header.id) === sessionId);
        if (rec) return rec.header;
      } catch {
        /* fall through */
      }
    }
    const sessionPersistence = this.ctx.get("sessionPersistence");
    if (sessionPersistence && typeof sessionPersistence.list === "function") {
      try {
        const headers = await sessionPersistence.list();
        return headers.find((h) => String(h.id) === sessionId);
      } catch {
        /* fall through */
      }
    }
    return undefined;
  }

  /** Run a PowerShell command with full-access policy and return the result. */
  async runShell(command) {
    const shell = this.ctx.get("shell");
    if (!shell || typeof shell.run !== "function") return undefined;
    const spec = shell.resolve({
      command,
      timeoutMs: 15000,
      sandboxPolicy: {
        mode: "danger-full-access",
        workspaceRoot: this.workspaceRoot(),
      },
    });
    return await shell.run(spec);
  }

  /**
   * Restore: remove `sessionId` from the archive set so the session returns to
   * its project slot in the sidebar.
   */
  async restore(request) {
    const sessionId = request && request.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return { ok: false, error: { code: "invalid-session" } };
    }
    const ids = readArchived.call(this, this.workspaceDomain());
    if (!ids.includes(sessionId)) {
      return { ok: false, error: { code: "not-archived" } };
    }
    try {
      await this.writeArchived(ids.filter((id) => id !== sessionId));
      return { ok: true, value: { restored: true } };
    } catch (error) {
      return {
        ok: false,
        error: { code: "write-failed", message: String(error && error.message ? error.message : error) },
      };
    }
  }

  /**
   * Delete: refuse a genuinely running agent, remove the session log directory
   * durably, then clear the archive entry. Live-but-idle sessions keep the
   * entry (ghost); non-live sessions are fully removed.
   */
  async delete(request) {
    const sessionId = request && request.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return { ok: false, error: { code: "invalid-session" } };
    }
    const agents = this.ctx.get("agents");
    let agent;
    try {
      agent = agents ? agents.get(sessionId) : undefined;
    } catch {
      agent = undefined;
    }
    if (agent !== undefined && agent.status === "running") {
      return { ok: false, error: { code: "agent-running", message: "该会话的智能体正在运行中，请等待其完成或停止后再删除" } };
    }
    const header = await this.findHeader(sessionId);
    let location;
    if (header) {
      const sessionPersistence = this.ctx.get("sessionPersistence");
      try {
        location = sessionPersistence.locate(header);
      } catch {
        location = undefined;
      }
    }
    let removed = false;
    let fileError;
    if (location && location.path) {
      const shell = this.ctx.get("shell");
      if (!shell || typeof shell.run !== "function") {
        fileError = "shell-unavailable";
      } else {
        try {
          const p = String(location.path).replace(/'/g, "''");
          const cmd =
            "Remove-Item -Force -Recurse -ErrorAction SilentlyContinue -LiteralPath '" +
            p +
            "'; if (Test-Path -LiteralPath '" +
            p +
            "') { exit 1 } else { exit 0 }";
          const result = await this.runShell(cmd);
          if (result && result.exitCode === 0) removed = true;
          else {
            const denied = !!(result && result.sandbox && result.sandbox.denied);
            let stderrText = "";
            try {
              stderrText =
                result && result.stderr && typeof result.stderr.text === "string"
                  ? result.stderr.text
                  : "";
            } catch {
              stderrText = "";
            }
            fileError =
              (denied ? "sandbox-denied" : "exit-" + (result ? result.exitCode : "unknown")) +
              (stderrText ? " stderr: " + stderrText.slice(0, 300) : "");
          }
        } catch (error) {
          fileError = String(error && error.message ? error.message : error);
        }
      }
    } else {
      removed = true; // no located artifact → already gone
    }
    if (!removed) {
      return {
        ok: false,
        error: { code: "delete-failed", message: "删除会话文件失败（" + (fileError || "未知错误") + "），已保留归档条目" },
      };
    }
    const sessions = this.ctx.get("sessions");
    const live = !!(sessions && sessions.get(sessionId) !== undefined);
    if (!live) {
      const ids = readArchived.call(this, this.workspaceDomain());
      if (ids.includes(sessionId)) {
        try {
          await this.writeArchived(ids.filter((id) => id !== sessionId));
        } catch {
          /* log already gone; entry cleanup best-effort */
        }
      }
    }
    return { ok: true, value: { fileRemoved: !!(location && location.path), live } };
  }

  /**
   * State: report archived sessions that are still live in memory while their
   * log files no longer exist. The Client hides these (ghost) and tells the
   * user they clear on restart.
   */
  async state() {
    const sessions = this.ctx.get("sessions");
    const sessionPersistence = this.ctx.get("sessionPersistence");
    const shell = this.ctx.get("shell");
    if (
      !sessions ||
      !sessionPersistence ||
      typeof sessionPersistence.locate !== "function" ||
      !shell ||
      typeof shell.run !== "function"
    ) {
      return { ok: true, value: { ghostIds: [] } };
    }
    const ids = readArchived.call(this, this.workspaceDomain());
    const live = [];
    for (const id of ids) {
      try {
        if (sessions.get(id) !== undefined) live.push(id);
      } catch {
        /* skip */
      }
    }
    if (live.length === 0) return { ok: true, value: { ghostIds: [] } };
    const paths = [];
    const byPath = {};
    for (const id of live) {
      try {
        const session = sessions.get(id);
        const location = sessionPersistence.locate(session.header);
        if (location && location.path) {
          paths.push(location.path);
          byPath[location.path] = id;
        }
      } catch {
        /* skip */
      }
    }
    if (paths.length === 0) return { ok: true, value: { ghostIds: [] } };
    const quoted = paths.map((p) => "'" + String(p).replace(/'/g, "''") + "'");
    const cmd =
      "$ps = @(" + quoted.join(",") + "); foreach ($p in $ps) { if (Test-Path -LiteralPath $p) { '1' } else { '0' } }";
    try {
      const result = await this.runShell(cmd);
      if (!result || result.exitCode !== 0) return { ok: true, value: { ghostIds: [] } };
      let text = "";
      try {
        text = result.stdout && typeof result.stdout.text === "string" ? result.stdout.text : "";
      } catch {
        text = "";
      }
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l === "0" || l === "1");
      if (lines.length !== paths.length) return { ok: true, value: { ghostIds: [] } };
      const missing = [];
      for (let i = 0; i < paths.length; i++) {
        if (lines[i] === "0") {
          const id = byPath[paths[i]];
          if (id !== undefined) missing.push(id);
        }
      }
      return { ok: true, value: { ghostIds: missing } };
    } catch {
      return { ok: true, value: { ghostIds: [] } };
    }
  }
}

export default ArchiveManagerService;
