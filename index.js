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
 *     session's durable log directory with plain `node:fs` calls (fully
 *     cross-platform: Windows, macOS, Linux), then drop the archive
 *     entry. Live-but-idle sessions keep their archive entry so they do not
 *     "revive" in the sidebar; the `state` call marks them as ghost.
 *   - `state`: report which archived sessions are still live in memory while
 *     their log files no longer exist (ghost records the Client hides).
 */

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Service } from "@deepseek-ai/cordis";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

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
      const target = String(location.path);
      try {
        // Delete straight from the host process via node:fs — no shell, no
        // PowerShell, no sandbox escalation, so this behaves identically on
        // Windows, macOS and Linux. Composition plugins run in-process with
        // the host's own privileges, which makes the sandbox ACL dance the
        // previous shell-based implementation needed unnecessary. maxRetries
        // absorbs transient Windows file locks (antivirus / indexers) and is
        // a no-op elsewhere.
        await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        removed = !existsSync(target);
        if (!removed) fileError = "path-still-exists";
      } catch (error) {
        fileError = String(error && error.message ? error.message : error);
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
    if (!sessions || !sessionPersistence || typeof sessionPersistence.locate !== "function") {
      return { ok: true, value: { ghostIds: [] } };
    }
    const ids = readArchived.call(this, this.workspaceDomain());
    const ghostIds = [];
    for (const id of ids) {
      try {
        const session = sessions.get(id);
        if (session === undefined) continue; // not live in memory → not a ghost
        const location = sessionPersistence.locate(session.header);
        // Live but the log directory is gone → ghost the client hides.
        if (location && location.path && !existsSync(String(location.path))) ghostIds.push(id);
      } catch {
        /* skip */
      }
    }
    return { ok: true, value: { ghostIds } };
  }
}

export default ArchiveManagerService;
