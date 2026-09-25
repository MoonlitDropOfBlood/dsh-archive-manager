#!/usr/bin/env node
/**
 * Smoke-run the client half's apply() with stubbed DSH services:
 *   - $mount + both style tags install/teardown,
 *   - exactly three slot injects register (footer.action, and the two 0.1.7
 *     archive row lists),
 *   - invoking each inject callback performs its ctx.slots.register() with
 *     the expected name/id/order and a real component reference (catches any
 *     undefined identifier or apply-order bug in the modern-mode path).
 * React rendering itself is out of scope — no DOM/React here.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
const ok = (label) => console.log(`  ok    ${label}`);
const fail = (label, error) => {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${error instanceof Error ? error.message : error}`);
};
const expect = (cond, label) => (cond ? ok(label) : fail(label, new Error("assertion failed")));

// --- browser stubs ---------------------------------------------------------
const styleTags = [];
let entry;
globalThis.window = {
  __ModuleLoader__: {
    load: (e) => {
      entry = e;
    },
  },
};
globalThis.document = {
  createElement: () => {
    const tag = { textContent: "", removed: false, remove() { this.removed = true; } };
    return tag;
  },
  head: {
    appendChild(tag) {
      styleTags.push(tag);
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

await import(pathToFileURL(path.join(here, "client.js")).href);
if (!entry || typeof entry.factory !== "function") {
  fail("capture client module entry", new Error("__ModuleLoader__.load never fired"));
  process.exit(1);
}

const fakeReact = {
  useSyncExternalStore: () => {
    throw new Error("useSyncExternalStore must not run during the apply smoke test");
  },
};
const capturedRequire = (spec) => {
  if (spec === "react") return fakeReact;
  throw new Error(`unexpected require("${spec}")`);
};

const clientExports = entry.factory(capturedRequire);

// --- fake ctx --------------------------------------------------------------
const injects = [];
const registrations = [];
const disposers = [];
const remoteCalls = { state: 0 };

const fakeRemote = {
  async state() {
    remoteCalls.state += 1;
    return { ok: true, value: { ghostIds: [] } };
  },
  async restore() {
    return { ok: true, value: { restored: true } };
  },
  async delete() {
    return { ok: true, value: { fileRemoved: true, live: false } };
  },
};

const ctx = {
  effect(fn) {
    const cleanup = fn();
    if (typeof cleanup === "function") disposers.push(cleanup);
    return () => {};
  },
  get(name) {
    if (name === "remote.archiveManager") return fakeRemote;
    if (name === "sessions") return undefined;
    throw new Error(`unexpected ctx.get("${name}")`);
  },
  slots: {
    inject(slotName, callback) {
      injects.push({ slotName, callback });
    },
    register(options, component) {
      if (typeof component !== "function") throw new Error(`register("${options.name}"): component is not a function`);
      registrations.push({ options, component });
      return () => {};
    },
  },
};
ctx.remote = { async $mount() { return async () => {}; } };

// --- run -------------------------------------------------------------------
try {
  await clientExports.apply(ctx);
  ok("apply() completes");
} catch (error) {
  fail("apply() completes", error);
  process.exit(1);
}

expect(styleTags.length === 2, "two style tags installed (common + legacy)");
expect(disposers.length === 2, "both style tags have teardown effects");

const names = injects.map((i) => i.slotName).sort();
expect(
  JSON.stringify(names) ===
    JSON.stringify([
      "sidebar.footer.action",
      "sidebar.workspaces.session.menu.item",
      "sidebar.workspaces.session.row.action",
    ].sort()),
  `three slot injects registered (got ${JSON.stringify(names)})`
);

// --- drive each inject callback (as the declaring slot would) --------------
for (const { slotName, callback } of injects) {
  try {
    const dispose = callback();
    if (typeof dispose !== "function") throw new Error("inject callback must return its registration disposer");
    ok(`inject fires for ${slotName} and registers one entry`);
  } catch (error) {
    fail(`inject fires for ${slotName}`, error);
  }
}

const bySlot = new Map(registrations.map((r) => [r.options.name, r]));
const menu = bySlot.get("sidebar.workspaces.session.menu.item");
const row = bySlot.get("sidebar.workspaces.session.row.action");
const foot = bySlot.get("sidebar.footer.action");

expect(menu && menu.options.id === "dsh-archive-manager.delete" && menu.options.order === 450, "menu entry id/order (delete after shipped rows)");
expect(row && row.options.id === "dsh-archive-manager.delete" && row.options.order === 300, "row entry id/order (delete after archive/pin)");
expect(foot && foot.options.id === "archive-manager", "footer entry still registered for the confirm dialog");

// The legacy style tag must be cleared once modern mode is marked.
const legacyTag = styleTags[1];
expect(legacyTag !== undefined && legacyTag.textContent === "", "markModern clears the footer-column CSS");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
