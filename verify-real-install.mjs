#!/usr/bin/env node
/**
 * Verify dsh-archive-manager against a REAL DSH installation.
 *
 * The checks in verify-constructor / verify-typert-compat / verify-client-apply
 * run against this repository's own node_modules, which pin the OLDEST supported
 * DSH APIs. They therefore stay green on a DSH release that refuses to load the
 * plugin at all. This script closes that gap against whatever is installed:
 *
 *   1. Boot gate (`evaluatePluginCompatibility`, the real dsh-app-boot copy):
 *      a plugin whose `@deepseek-ai/dsh*` peers do not admit the running runtime
 *      is dropped from the profile's bundle layers at boot — dsh prints
 *      "skipping profile bundle ..." and mounts nothing. This is the failure
 *      that took dsh-archive-manager down on DSH 0.2.0.
 *   2. Host activation against the install's OWN cordis + typert-protocol: the
 *      real index.js class is constructed and its Remote markers read back.
 *   3. Deletion semantics against both on-disk session layouts: `locate()` names
 *      a session DIRECTORY on DSH < 0.2.0 and the current generation's log FILE
 *      inside it on DSH >= 0.2.0. "永久删除" must remove the whole owning
 *      directory in both cases, or an older format generation resurrects the
 *      session on the next restart.
 *
 * Real installs are probed through DSH_INSTALL (plus the default Desktop
 * install location); an absent install is a skip, never a silent pass.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = "@duke-dsh-plugins/dsh-archive-manager";
const here = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
let skips = 0;
const ok = (label) => console.log(`  ok    ${label}`);
const skip = (label, why) => {
  skips += 1;
  console.log(`  skip  ${label} (${why})`);
};
const fail = (label, error) => {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${error instanceof Error ? error.message : error}`);
};
const attempt = async (label, fn) => {
  try {
    await fn();
    ok(label);
  } catch (error) {
    fail(label, error);
  }
};

const PACKAGE_MANIFEST = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));

// --- locate a real DSH installation ------------------------------------------

function findInstall() {
  const candidates = [
    process.env.DSH_INSTALL,
    path.join(os.homedir(), "AppData", "Roaming", "DeepSeek Harness Desktop", "dsh"),
  ].filter(Boolean);
  for (const root of candidates) {
    if (existsSync(path.join(root, "node_modules", "@deepseek-ai", "dsh", "package.json"))) return root;
  }
  return null;
}

const installRoot = findInstall();
if (installRoot === null) {
  console.log("  skip  real DSH install not found (set DSH_INSTALL to the dsh install directory)");
  console.log("\nNO REAL INSTALL FOUND — nothing was verified against a running DSH build");
  process.exit(2);
}

const runtimeVersion = JSON.parse(
  readFileSync(path.join(installRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
).version;
console.log(`\nreal DSH install: ${installRoot} (dsh ${runtimeVersion})`);

// --- cordis-shaped fake context ----------------------------------------------

function runEffect(fn) {
  const cleanups = [];
  const result = fn();
  if (result && typeof result.next === "function") {
    let step = result.next();
    while (!step.done) {
      if (typeof step.value === "function") cleanups.push(step.value);
      step = result.next();
    }
  } else if (typeof result === "function") {
    cleanups.push(result);
  }
  return () => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()();
      } catch {
        /* disposers are best-effort in tests */
      }
    }
  };
}

function makeCtx(extra = {}) {
  const props = Object.create(null);
  const ctx = {
    root: { fiber: null, registry: { counter: 1 }, reflect: null },
    extend: () => ctx,
    logger: { warn() {}, error() {} },
    on() {
      return () => {};
    },
    get(name) {
      return extra[name];
    },
    reflect: {
      props,
      provide(name) {
        props[name] = { type: "service" };
        return () => {
          delete props[name];
        };
      },
    },
    effect(fn) {
      return runEffect(fn);
    },
  };
  ctx.root.reflect = ctx.reflect;
  return Object.assign(ctx, extra);
}

// ---------------------------------------------------------------------------
// 1. The boot gate: would dsh-app-boot drop this bundle from the profile?
// ---------------------------------------------------------------------------

console.log("\n[1] profile bundle boot gate (dsh-app-boot compatibility)");

const appBootFile = path.join(installRoot, "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
if (!existsSync(appBootFile)) {
  skip("dsh-app-boot", `${appBootFile} not present`);
} else {
  const { evaluatePluginCompatibility } = await import(pathToFileURL(appBootFile).href);
  if (typeof evaluatePluginCompatibility !== "function") {
    skip("evaluatePluginCompatibility", "this dsh build has no peer compatibility gate");
  } else {
    // No exemptions: a fix must be a truthful range, never a granted bypass.
    const issue = evaluatePluginCompatibility(PACKAGE_MANIFEST, {});
    if (issue === undefined) {
      ok(`peerDependencies admit the running dsh ${runtimeVersion} (no exemption needed)`);
    } else {
      fail(
        `peerDependencies admit the running dsh ${runtimeVersion}`,
        new Error(
          `dsh would skip this bundle: ${JSON.stringify(issue.peers)} ` +
            `(declared ${JSON.stringify(PACKAGE_MANIFEST.peerDependencies)})`,
        ),
      );
    }
    // Guard the regression directly: the declared ranges must also admit the
    // older runtimes this plugin still supports, so widening 0.2.0 support
    // never silently drops < 0.2.0.
    const dshManifest = path.join(installRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
    let semver;
    try {
      semver = createRequire(dshManifest)("semver");
    } catch (error) {
      skip("older-runtime peer coverage", `semver not resolvable from the dsh install (${error.message})`);
    }
    if (semver) {
      const dshPeers = Object.entries(PACKAGE_MANIFEST.peerDependencies).filter(
        ([name]) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"),
      );
      for (const runtime of ["0.1.5", "0.1.7", runtimeVersion]) {
        const rejected = dshPeers.filter(([, range]) => !semver.satisfies(runtime, range, { includePrerelease: true }));
        if (rejected.length === 0) {
          ok(`peerDependencies still admit dsh ${runtime}`);
        } else {
          fail(
            `peerDependencies still admit dsh ${runtime}`,
            new Error(`incompatible: ${rejected.map(([n, r]) => `${n}@${r}`).join(", ")}`),
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Host activation against the install's own cordis + typert-protocol.
// ---------------------------------------------------------------------------

console.log(`\n[2] host activation on dsh ${runtimeVersion}`);

/**
 * index.js resolves `@deepseek-ai/*` from its own directory's node_modules,
 * which here pins the oldest supported APIs. Re-import the shipped bytes from a
 * scratch directory whose node_modules IS the dsh installation, so the class
 * binds to the runtime under test.
 */
async function loadHostAgainstInstall() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-host-"));
  symlinkSync(path.join(installRoot, "node_modules"), path.join(scratch, "node_modules"), "junction");
  writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "host-under-test", type: "module" }));
  writeFileSync(path.join(scratch, "index.js"), readFileSync(path.join(here, "index.js")));
  const module = await import(pathToFileURL(path.join(scratch, "index.js")).href);
  const { Service } = await import(
    pathToFileURL(path.join(installRoot, "node_modules", "@deepseek-ai", "cordis", "lib", "index.js")).href
  );
  const { remoteMethods } = await import(
    pathToFileURL(path.join(installRoot, "node_modules", "@deepseek-ai", "dsh-typert-protocol", "lib", "index.js")).href
  );
  return { ...module, Service, remoteMethods, scratch };
}

let host;
try {
  host = await loadHostAgainstInstall();
  ok("index.js imports against the installation's cordis/typert-protocol");
} catch (error) {
  fail("index.js imports against the installation's cordis/typert-protocol", error);
}

if (host) {
  await attempt(`ArchiveManagerService constructs and marks restore/delete/state on dsh ${runtimeVersion}`, async () => {
    const instance = new host.ArchiveManagerService(makeCtx(), {});
    instance[host.Service.init]();
    const methods = host.remoteMethods(instance).map((m) => m.method);
    for (const expected of ["restore", "delete", "state"]) {
      if (!methods.includes(expected)) throw new Error(`remoteMethods missing "${expected}" (got ${JSON.stringify(methods)})`);
    }
    if (instance.name !== "archiveManager") throw new Error(`service key is ${instance.name}`);
  });

  // --- 3. Deletion semantics for both session layouts ------------------------

  console.log("\n[3] delete() against both on-disk session layouts");

  const layoutCases = [
    {
      name: "DSH < 0.2.0 layout (locate returns the session directory)",
      build(root) {
        const dir = path.join(root, "project", "session-under-test");
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "session.jsonl.zstd"), "v1 log");
        writeFileSync(path.join(dir, "session.jsonl.zstd.bak"), "v1 backup");
        return dir;
      },
    },
    {
      name: "DSH >= 0.2.0 layout (locate returns the current generation's log file)",
      build(root) {
        const dir = path.join(root, "project", "session-under-test");
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), "current log");
        writeFileSync(path.join(dir, "session.v3.jsonl.zstd"), "older generation");
        return dir;
      },
    },
  ];

  for (const testCase of layoutCases) {
    await attempt(`delete() removes the whole session directory — ${testCase.name}`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-del-"));
      try {
        const dir = testCase.build(root);
        // The 0.2.0 backend hands back the generation FILE; the pre-0.2.0
        // backend handed back the directory. Both must end up fully removed.
        const located = testCase.name.includes("0.2.0") ? path.join(dir, "session.v4.jsonl.zstd") : dir;
        const writes = [];
        // The real shape: `storageDomain.get("workspace")` holds the durable
        // global, `workspaceRegistry.setState` writes it back through the
        // registry (the only supported write path).
        const workspaceState = { archivedSessionIds: ["session-under-test"] };
        const workspaceDomain = { global: { get: () => workspaceState } };
        const sessionPersistence = { locate: () => ({ kind: "jsonl", path: located }) };
        const ctx = makeCtx({
          sessionPersistence,
          sessionQuery: { listSessions: async () => [{ header: { id: "session-under-test", cwd: "project" }, live: false }] },
          sessions: { get: () => undefined },
          agents: { get: () => undefined },
          storageDomain: { get: (name) => (name === "workspace" ? workspaceDomain : undefined) },
          workspaceRegistry: {
            get archivedSessionIds() {
              return workspaceState.archivedSessionIds;
            },
            setState: async (state) => {
              workspaceState.archivedSessionIds = state.archivedSessionIds;
              writes.push(state);
            },
          },
        });
        const instance = new host.ArchiveManagerService(ctx, {});
        instance[host.Service.init]();
        const result = await instance.delete({ sessionId: "session-under-test" });
        if (!result.ok) throw new Error(`delete returned ${JSON.stringify(result.error)}`);
        if (result.value.fileRemoved !== true) throw new Error(`fileRemoved=${result.value.fileRemoved}`);
        if (existsSync(dir)) throw new Error(`session directory survived at ${dir}`);
        if (existsSync(located)) throw new Error(`located artifact survived at ${located}`);
        if (writes.length !== 1) throw new Error("archive entry was not cleared for a non-live session");
        if ((writes[0].archivedSessionIds ?? []).length !== 0) throw new Error("archive entry still holds the deleted session");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  // The live path must not depend on the corpus listing: a just-archived
  // session is still resident, its own header is the authoritative location
  // source, and the archive entry must survive as a ghost until restart.
  await attempt("delete() uses the live session header and keeps the ghost entry", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-live-"));
    try {
      const dir = path.join(root, "project", "session-under-test");
      mkdirSync(dir, { recursive: true });
      const located = path.join(dir, "session.v4.jsonl.zstd");
      writeFileSync(located, "current log");
      const writes = [];
      let listings = 0;
      const workspaceState = { archivedSessionIds: ["session-under-test"] };
      const ctx = makeCtx({
        sessionPersistence: { locate: () => ({ kind: "jsonl", path: located }) },
        sessionQuery: { listSessions: async () => { listings += 1; return []; } },
        sessions: { get: () => ({ header: { id: "session-under-test", cwd: "project" } }) },
        agents: { get: () => undefined },
        storageDomain: { get: (name) => (name === "workspace" ? { global: { get: () => workspaceState } } : undefined) },
        workspaceRegistry: {
          get archivedSessionIds() {
            return workspaceState.archivedSessionIds;
          },
          setState: async (state) => {
            workspaceState.archivedSessionIds = state.archivedSessionIds;
            writes.push(state);
          },
        },
      });
      const instance = new host.ArchiveManagerService(ctx, {});
      instance[host.Service.init]();
      const result = await instance.delete({ sessionId: "session-under-test" });
      if (!result.ok) throw new Error(`delete returned ${JSON.stringify(result.error)}`);
      if (result.value.fileRemoved !== true) throw new Error(`fileRemoved=${result.value.fileRemoved}`);
      if (result.value.live !== true) throw new Error("live flag was not reported");
      if (existsSync(dir)) throw new Error(`live session directory survived at ${dir}`);
      if (listings !== 0) throw new Error("the live header path still scanned the stored corpus");
      if (writes.length !== 0) throw new Error("the ghost archive entry was cleared before restart");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // DSH >= 0.1.7 `sessionPersistence.list()` returns `{ header, … }` snapshots;
  // the fallback must read that shape (it used to look for a bare `id`).
  await attempt("delete() resolves a header from sessionPersistence.list() snapshots", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-fallback-"));
    try {
      const dir = path.join(root, "project", "session-under-test");
      mkdirSync(dir, { recursive: true });
      const located = path.join(dir, "session.v4.jsonl.zstd");
      writeFileSync(located, "current log");
      const writes = [];
      const workspaceState = { archivedSessionIds: ["session-under-test"] };
      const ctx = makeCtx({
        sessionPersistence: {
          locate: () => ({ kind: "jsonl", path: located }),
          list: async () => [{ header: { id: "session-under-test", cwd: "project" }, formatStatus: "current" }],
        },
        sessionQuery: { listSessions: async () => { throw new Error("query index unavailable"); } },
        sessions: { get: () => undefined },
        agents: { get: () => undefined },
        storageDomain: { get: (name) => (name === "workspace" ? { global: { get: () => workspaceState } } : undefined) },
        workspaceRegistry: {
          get archivedSessionIds() {
            return workspaceState.archivedSessionIds;
          },
          setState: async (state) => {
            workspaceState.archivedSessionIds = state.archivedSessionIds;
            writes.push(state);
          },
        },
      });
      const instance = new host.ArchiveManagerService(ctx, {});
      instance[host.Service.init]();
      const result = await instance.delete({ sessionId: "session-under-test" });
      if (!result.ok) throw new Error(`delete returned ${JSON.stringify(result.error)}`);
      if (result.value.fileRemoved !== true) throw new Error(`fileRemoved=${result.value.fileRemoved}`);
      if (existsSync(dir)) throw new Error(`session directory survived at ${dir} — the { header } snapshot shape was not read`);
      if (writes.length !== 1) throw new Error("archive entry was not cleared for a non-live session");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // `state()` also drives the once-per-process archive-set hygiene: an id
  // whose session is neither live nor stored is pruned, a live ghost and a
  // stored session stay archived.
  await attempt("state() prunes archive ids whose session is gone completely", async () => {
    const writes = [];
    const workspaceState = {
      archivedSessionIds: ["session-live-ghost", "session-stale", "session-stored"],
    };
    const ctx = makeCtx({
      sessionPersistence: {
        locate: (header) => ({ kind: "jsonl", path: path.join(os.tmpdir(), "no-such-artifact", header.id) }),
      },
      sessionQuery: { listSessions: async () => [{ header: { id: "session-stored", cwd: "project" }, live: false }] },
      sessions: {
        get: (id) => (id === "session-live-ghost" ? { header: { id, cwd: "project" } } : undefined),
      },
      agents: { get: () => undefined },
      storageDomain: { get: (name) => (name === "workspace" ? { global: { get: () => workspaceState } } : undefined) },
      workspaceRegistry: {
        get archivedSessionIds() {
          return workspaceState.archivedSessionIds;
        },
        setState: async (state) => {
          workspaceState.archivedSessionIds = state.archivedSessionIds;
          writes.push(state);
        },
      },
    });
    const instance = new host.ArchiveManagerService(ctx, {});
    instance[host.Service.init]();
    const result = await instance.state();
    await instance.reconcileArchived();
    if (!result.ok) throw new Error(`state returned ${JSON.stringify(result.error)}`);
    if (!result.value.ghostIds.includes("session-live-ghost")) throw new Error("the live ghost was not reported");
    if (writes.length !== 1) throw new Error(`expected one cleanup write, got ${writes.length}`);
    const kept = writes[0].archivedSessionIds;
    if (JSON.stringify(kept) !== JSON.stringify(["session-live-ghost", "session-stored"])) {
      throw new Error(`unexpected archive set after cleanup: ${JSON.stringify(kept)}`);
    }
  });

  // A failed corpus listing must keep every entry: guessing "not listed"
  // would silently unarchive live sessions.
  await attempt("state() keeps the archive set when the corpus cannot be listed", async () => {
    const writes = [];
    const workspaceState = { archivedSessionIds: ["session-unknown"] };
    const ctx = makeCtx({
      sessionPersistence: { locate: () => ({ path: path.join(os.tmpdir(), "no-such-artifact") }) },
      sessionQuery: { listSessions: async () => { throw new Error("query index unavailable"); } },
      sessions: { get: () => undefined },
      agents: { get: () => undefined },
      storageDomain: { get: (name) => (name === "workspace" ? { global: { get: () => workspaceState } } : undefined) },
      workspaceRegistry: {
        get archivedSessionIds() {
          return workspaceState.archivedSessionIds;
        },
        setState: async (state) => {
          workspaceState.archivedSessionIds = state.archivedSessionIds;
          writes.push(state);
        },
      },
    });
    const instance = new host.ArchiveManagerService(ctx, {});
    instance[host.Service.init]();
    await instance.state();
    await instance.reconcileArchived();
    if (writes.length !== 0) throw new Error("the archive set was rewritten without a corpus listing");
    if (workspaceState.archivedSessionIds.length !== 1) throw new Error("the archived id was dropped");
  });

  await attempt("delete() refuses a running agent without touching disk", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-running-"));
    try {
      const dir = path.join(root, "project", "session-under-test");
      mkdirSync(dir, { recursive: true });
      const located = path.join(dir, "session.v4.jsonl.zstd");
      writeFileSync(located, "current log");
      const ctx = makeCtx({
        sessionPersistence: { locate: () => ({ path: located }) },
        sessionQuery: { listSessions: async () => [] },
        sessions: { get: () => undefined },
        agents: { get: () => ({ status: "running" }) },
        storageDomain: { get: () => undefined },
        workspaceRegistry: { setState: async () => {} },
      });
      const instance = new host.ArchiveManagerService(ctx, {});
      instance[host.Service.init]();
      const result = await instance.delete({ sessionId: "session-under-test" });
      if (result.ok) throw new Error("a running agent was not blocked");
      if (result.error.code !== "agent-running") throw new Error(`unexpected error code ${result.error.code}`);
      if (!existsSync(located)) throw new Error("the log was removed despite a running agent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await attempt("delete() refuses when this build cannot locate the log", async () => {
    const ctx = makeCtx({
      sessionPersistence: {},
      sessionQuery: { listSessions: async () => [{ header: { id: "session-under-test" }, live: false }] },
      sessions: { get: () => undefined },
      agents: { get: () => undefined },
      storageDomain: { get: () => undefined },
      workspaceRegistry: { setState: async () => {} },
    });
    const instance = new host.ArchiveManagerService(ctx, {});
    instance[host.Service.init]();
    const result = await instance.delete({ sessionId: "session-under-test" });
    if (result.ok) throw new Error("delete claimed success without being able to locate the log");
    if (result.error.code !== "locate-unavailable") throw new Error(`unexpected error code ${result.error.code}`);
  });

  rmSync(host.scratch, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}${skips > 0 ? ` (${skips} skipped)` : ""}`);
process.exit(failures === 0 ? 0 : 1);
