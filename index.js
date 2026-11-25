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
import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

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

/**
 * Resolve the session directory that owns a session's log artifact.
 *
 * `sessionPersistence.locate(header).path` changed meaning across DSH majors:
 *   - DSH < 0.2.0: the session DIRECTORY (`…/<project>/<sessionId>/`), which is
 *     what `rm(..., { recursive: true })` was written against.
 *   - DSH >= 0.2.0 (`dsh-session-persistence-jsonl`): the current generation's
 *     log FILE inside that directory (`…/<project>/<sessionId>/session.v4.jsonl.zstd`).
 *     Removing only that file would leave the directory and any older generation
 *     (`session.v3.jsonl.zstd`) behind, so a restart could resurrect the session —
 *     exactly what "永久删除" must not do.
 *
 * So: prefer `stat` on the path itself; when the artifact is already gone, fall
 * back to the name shape — a located log file always carries an extension
 * (`session.v4.jsonl.zstd`), while a per-session directory never does.
 *
 * @param {string} locatedPath - `sessionPersistence.locate(header).path`.
 * @returns {string} the directory to remove.
 */
function deletionTarget(locatedPath) {
  const target = String(locatedPath);
  try {
    if (statSync(target).isDirectory()) return target;
    if (statSync(target).isFile()) return dirname(target);
  } catch {
    /* artifact already gone — infer from the path shape below */
  }
  return extname(basename(target)) === "" ? target : dirname(target);
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
        const stored = await sessionPersistence.list();
        // DSH >= 0.1.7 returns `{ header, formatStatus, revision }` snapshots
        // from `list()`; older builds may hand back bare headers. Accept both
        // shapes (the previous version only handled the bare header, so this
        // fallback always missed on every modern DSH).
        const match = stored.find((snapshot) =>
          String(snapshot && snapshot.header ? snapshot.header.id : snapshot && snapshot.id) === sessionId
        );
        if (match) return match.header ? match.header : match;
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
    // A live session's header is authoritative and free to read; only a
    // non-live target needs the (potentially expensive) corpus listing.
    const sessions = this.ctx.get("sessions");
    let liveSession;
    try {
      liveSession = sessions ? sessions.get(sessionId) : undefined;
    } catch {
      liveSession = undefined;
    }
    const header = liveSession ? liveSession.header : await this.findHeader(sessionId);
    const sessionPersistence = this.ctx.get("sessionPersistence");
    if (header && (!sessionPersistence || typeof sessionPersistence.locate !== "function")) {
      // The header exists but this build cannot tell us where its log lives.
      // Claiming success here would silently keep the session on disk.
      return {
        ok: false,
        error: {
          code: "locate-unavailable",
          message: "当前 DSH 版本的会话存储未提供 locate()，无法定位会话日志目录，已保留归档条目",
        },
      };
    }
    let location;
    if (header) {
      try {
        location = sessionPersistence.locate(header);
      } catch {
        location = undefined;
      }
    }
    let removed = false;
    let fileError;
    if (location && location.path) {
      const target = deletionTarget(location.path);
      try {
        // Delete straight from the host process via node:fs — no shell, no
        // PowerShell, no sandbox escalation, so this behaves identically on
        // Windows, macOS and Linux. Composition plugins run in-process with
        // the host's own privileges, which makes the sandbox ACL dance the
        // previous shell-based implementation needed unnecessary. maxRetries
        // absorbs transient Windows file locks (antivirus / indexers) and is
        // a no-op elsewhere. The whole owning session directory goes, so older
        // format generations cannot survive the delete (DSH >= 0.2.0).
        await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
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
    const live = liveSession !== undefined;
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
   * Resolve every stored session id from the authoritative corpus, or
   * `undefined` when neither source can list it (callers must not guess:
   * pruning on a failed listing would drop live archive entries).
   *
   * @returns {Promise<Set<string>|undefined>} stored ids, or undefined.
   */
  async listStoredIds() {
    const sessionQuery = this.ctx.get("sessionQuery");
    if (sessionQuery && typeof sessionQuery.listSessions === "function") {
      try {
        const records = await sessionQuery.listSessions();
        const ids = new Set();
        for (const record of records) {
          const header = record && record.header ? record.header : record;
          if (header && header.id !== undefined) ids.add(String(header.id));
        }
        return ids;
      } catch {
        /* fall through to the persistence listing */
      }
    }
    const sessionPersistence = this.ctx.get("sessionPersistence");
    if (sessionPersistence && typeof sessionPersistence.list === "function") {
      try {
        const snapshots = await sessionPersistence.list();
        const ids = new Set();
        for (const snapshot of snapshots) {
          const header = snapshot && snapshot.header ? snapshot.header : snapshot;
          if (header && header.id !== undefined) ids.add(String(header.id));
        }
        return ids;
      } catch {
        /* cannot know */
      }
    }
    return undefined;
  }

  /**
   * One-shot archive-set hygiene: drop ids whose session is neither live nor
   * stored any more.
   *
   * A live `delete` deliberately keeps the archive entry (the resident session
   * must not "revive" in the sidebar), so after the next DSH start that session
   * is gone together with its log while the id would linger in the durable
   * archive set forever. This prunes exactly those ids, at most once per
   * process, and only when a full corpus listing succeeded.
   *
   * @returns {Promise<void>} settles after the (possibly) written cleanup.
   */
  reconcileArchived() {
    if (this.reconcileRun === undefined) {
      this.reconcileRun = (async () => {
        try {
          const stored = await this.listStoredIds();
          if (stored === undefined) return;
          const sessions = this.ctx.get("sessions");
          const ids = readArchived.call(this, this.workspaceDomain());
          const stale = ids.filter((id) => {
            let live = false;
            try {
              live = !!(sessions && sessions.get(id) !== undefined);
            } catch {
              live = false;
            }
            return !live && !stored.has(id);
          });
          if (stale.length === 0) return;
          await this.writeArchived(ids.filter((id) => !stale.includes(id)));
        } catch {
          /* best-effort hygiene; the archive set is unchanged */
        }
      })();
    }
    return this.reconcileRun;
  }

  /**
   * State: report archived sessions that are still live in memory while their
   * log files no longer exist. The Client hides these (ghost) and tells the
   * user they clear on restart. Also kicks the once-per-process cleanup of
   * archive ids whose session is gone completely (see `reconcileArchived`).
   */
  async state() {
    const sessions = this.ctx.get("sessions");
    const sessionPersistence = this.ctx.get("sessionPersistence");
    if (!sessions || !sessionPersistence || typeof sessionPersistence.locate !== "function") {
      return { ok: true, value: { ghostIds: [] } };
    }
    void this.reconcileArchived();
    const ids = readArchived.call(this, this.workspaceDomain());
    const ghostIds = [];
    for (const id of ids) {
      try {
        const session = sessions.get(id);
        if (session === undefined) continue; // not live in memory → not a ghost
        const location = sessionPersistence.locate(session.header);
        // Live but the log is gone → ghost the client hides. Probed against the
        // owning session directory, i.e. exactly what `delete` removes: on DSH
        // >= 0.2.0 `locate` names the current generation's file inside it.
        if (location && location.path && !existsSync(deletionTarget(location.path))) ghostIds.push(id);
      } catch {
        /* skip */
      }
    }
    return { ok: true, value: { ghostIds } };
  }
}

export default ArchiveManagerService;
