#!/usr/bin/env node
/**
 * Verify the dsh-archive-manager Host-half fix end-to-end:
 * 1. Construction (the bug that broke boot) — explicit super(ctx,"archiveManager").
 * 2. Remote markers — restore/delete/state must be visible via remoteMethods().
 */
import { Remote, TypertRemoteService, remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { Service } from "@deepseek-ai/cordis";

function markRemoteMethod(instance, method, exportName) {
  const decorator = Remote(method, undefined);
  const initializers = [];
  decorator(undefined, {
    kind: "method", name: method, static: false, private: false,
    addInitializer: (fn) => initializers.push(fn),
  });
  for (const fn of initializers) fn.call(instance);
}

function makeCtx() {
  const props = Object.create(null);
  const fiber = { effect: (fn) => { fn(); return () => {}; }, store: {}, runtime: null };
  const ctx = {
    fiber,
    root: { fiber, registry: { counter: 1 } },
    extend: () => ctx,
    reflect: {
      props,
      provide(name, value, check) {
        props[name] = { type: "service" };
        if (!ctx.root.__isolate) ctx.root.__isolate = {};
        ctx.root.__isolate[name] = Symbol(name);
        return () => { delete props[name]; };
      },
    },
  };
  return ctx;
}

class FixedArchiveManagerService extends TypertRemoteService {
  static inject = ["workspaceRegistry", "storageDomain", "sessionPersistence", "sessionQuery", "sessions", "agents"];
  constructor(ctx, config) {
    super(ctx, "archiveManager");
  }
  [Service.init]() {
    markRemoteMethod(this, "restore", "restore");
    markRemoteMethod(this, "delete", "delete");
    markRemoteMethod(this, "state", "state");
  }
  async restore() { return { ok: true, value: { restored: true } }; }
  async delete() { return { ok: true, value: { fileRemoved: true, live: false } }; }
  async state() { return { ok: true, value: { ghostIds: [] } }; }
}

const ctx = makeCtx();
const instance = new FixedArchiveManagerService(ctx, {});
for (const hook of instance?.[Service.init] && []) {}
instance[Service.init]?.();

console.log(`constructed: ${instance.name}; service registered as "${instance.name}"`);
console.log(`typertRemote serviceKey: ${instance.typertRemote?.serviceKey}; namespace: ${instance.typertRemote?.namespace}`);
const remote = remoteMethods(instance);
console.log(`remoteMethods: ${JSON.stringify(remote)}`);
const ok = instance.name === "archiveManager"
  && instance.typertRemote?.serviceKey === "archiveManager"
  && remote.some((r) => r.method === "restore")
  && remote.some((r) => r.method === "delete")
  && remote.some((r) => r.method === "state");
console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
