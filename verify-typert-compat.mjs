#!/usr/bin/env node
/**
 * Verify dsh-archive-manager's wire contract against BOTH DSH typert worlds:
 *
 *   - DSH < 0.1.7  (typert-loader / typert-registry): a strict codec must
 *     carry `codec.schema`, a zod v4 INSTANCE (`_zod` + `parse`); the
 *     gateway parses with `codec.schema.parse(...)`.
 *   - DSH >= 0.1.7: a strict codec must carry `codec.create`, a FACTORY
 *     returning a zod schema ("strict codec has no create() factory"
 *     otherwise); the gateway parses with `codec.create().parse(...)`.
 *
 * Layers, strongest first:
 *   1. When a real DSH install is found (DSH_INSTALL_015 / DSH_INSTALL_017
 *      env vars, or the known default locations), import its ACTUAL
 *      `validateTypertManifest` and ACTUAL TypertRegistry and run our host
 *      manifest + client contribution through them.
 *   2. Always: replicate the exact published checks (both versions) over the
 *      host TYPERT manifest and the client CLIENT_REMOTE contribution, so
 *      this script stays meaningful on machines without a DSH install.
 *   3. Always: construct the real ArchiveManagerService from index.js and
 *      assert its Remote markers (the host half's activation contract).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = "@duke-dsh-plugins/dsh-archive-manager";
const here = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
let skips = 0;
function ok(label) {
  console.log(`  ok    ${label}`);
}
function fail(label, error) {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${error instanceof Error ? error.message : error}`);
}
function skip(label, why) {
  skips += 1;
  console.log(`  skip  ${label} (${why})`);
}
async function attempt(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (error) {
    fail(label, error);
  }
}

// ---------------------------------------------------------------------------
// Load the artifacts under test.
// ---------------------------------------------------------------------------

const { TYPERT } = await import(pathToFileURL(path.join(here, "typert.host.js")).href);

// client.js is a browser bundle: stub the module-loader host, then run its
// factory with a minimal require so CLIENT_REMOTE becomes readable.
const captured = {};
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      captured.entry = entry;
    },
  },
};
await import(pathToFileURL(path.join(here, "client.js")).href);
if (!captured.entry || typeof captured.entry.factory !== "function") {
  fail("client bundle registers via __ModuleLoader__.load", "load() was never called");
  process.exit(1);
}
const clientExports = captured.entry.factory((spec) => {
  if (spec === "react") return {};
  throw new Error(`unexpected require("${spec}") while loading the bundle factory`);
});
const CLIENT_REMOTE = clientExports.CLIENT_REMOTE;
if (!clientExports.apply || !Array.isArray(clientExports.inject) || !CLIENT_REMOTE) {
  fail("client exports (apply / inject / CLIENT_REMOTE)", "missing export");
  process.exit(1);
}
ok("client bundle factory loads and exposes CLIENT_REMOTE");

// The real Host class (index.js) constructs against the installed
// typert-protocol exactly as the cordis loader will.
const { ArchiveManagerService } = await import(pathToFileURL(path.join(here, "index.js")).href);

// ---------------------------------------------------------------------------
// A cordis-shaped fake context good enough to construct services and drive
// registry effects (same pattern as verify-constructor.mjs).
// ---------------------------------------------------------------------------

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

function makeCtx() {
  const props = Object.create(null);
  const ctx = {
    root: { fiber: null, registry: { counter: 1 }, reflect: null },
    extend: () => ctx,
    logger: { warn() {}, error() {} },
    on() {
      return () => {};
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
  return ctx;
}

// ---------------------------------------------------------------------------
// 2) Replicated published checks — always run.
// ---------------------------------------------------------------------------

console.log("\n[1] replicated codec rules (host manifest TYPERT)");

const WIRE_NAME = /^[A-Za-z0-9_$.-]+$/;

function checkHostCodec(codec, label) {
  // shared (both versions)
  if (codec.mode !== "strict") throw new Error(`${label}: mode must be "strict"`);
  if (typeof codec.typeSymbol !== "string" || codec.typeSymbol.length === 0) {
    throw new Error(`${label}: missing typeSymbol`);
  }
  // DSH < 0.1.7 (typert-loader requireStrictCodec / typert-registry validateCodec)
  if (typeof codec.schema !== "object" || codec.schema === null || !("_zod" in codec.schema) || typeof codec.schema.parse !== "function") {
    throw new Error(`${label}: DSH < 0.1.7 requires a zod v4 instance with parse() in codec.schema`);
  }
  // DSH >= 0.1.7 (typert-loader line "has no create() factory" / registry validateCodec)
  if (typeof codec.create !== "function") {
    throw new Error(`${label}: DSH >= 0.1.7 requires a create() factory in codec`);
  }
  // the factory must return something parseable (gateway calls create().parse)
  const built = codec.create();
  if (!built || typeof built.parse !== "function") {
    throw new Error(`${label}: codec.create() must return a schema with parse()`);
  }
}

function checkInvocationShape(inv, label) {
  if (typeof inv.id !== "string" || inv.id.length === 0) throw new Error(`${label}: invocation id must be nonempty`);
  if (typeof inv.service !== "string" || inv.service.length === 0 || inv.service.includes("#")) {
    throw new Error(`${label}: service key must be nonempty and must not contain "#"`);
  }
  if (!WIRE_NAME.test(inv.namespace)) throw new Error(`${label}: invalid namespace "${inv.namespace}"`);
  if (!WIRE_NAME.test(inv.method)) throw new Error(`${label}: invalid method "${inv.method}"`);
  if (!inv.invocation || inv.invocation.kind !== "direct") throw new Error(`${label}: receiver kind must be "direct"`);
  for (const p of inv.parameters) {
    if (!WIRE_NAME.test(p.name)) throw new Error(`${label}: invalid parameter name "${p.name}"`);
    if (!WIRE_NAME.test(p.wire)) throw new Error(`${label}: invalid wire field "${p.wire}"`);
    if (p.source !== "json") throw new Error(`${label}: parameter source must be "json"`);
    checkHostCodec(p.codec, `${label}/${p.name}`);
  }
  checkHostCodec(inv.result, `${label}/result`);
}

try {
  if (!Array.isArray(TYPERT.schemas)) throw new Error("TYPERT.schemas must be an array");
  for (const schema of TYPERT.schemas) {
    if (typeof schema.create !== "function") throw new Error(`schema "${schema.name}": DSH >= 0.1.7 requires create()`);
  }
  for (const inv of TYPERT.invocations) checkInvocationShape(inv, inv.id);
  ok(`all ${TYPERT.invocations.length} host invocations pass both versions' codec rules`);
} catch (error) {
  fail("host manifest dual rules", error);
}

console.log("\n[2] replicated registry rules (client contribution CLIENT_REMOTE)");

function checkClientDescriptor(desc) {
  const label = desc.id;
  if (typeof desc.id !== "string" || desc.id.length === 0) throw new Error(`${label}: id must be nonempty`);
  if (typeof desc.service !== "string" || desc.service.length === 0 || desc.service.includes("#")) {
    throw new Error(`${label}: invalid service key`);
  }
  if (!WIRE_NAME.test(desc.namespace)) throw new Error(`${label}: invalid namespace`);
  if (!WIRE_NAME.test(desc.method)) throw new Error(`${label}: invalid method`);
  if (!desc.invocation || desc.invocation.kind !== "direct") throw new Error(`${label}: receiver must be direct`);
  const codecRules = (codec, what) => {
    if (codec.mode !== "strict") throw new Error(`${label}/${what}: mode must be "strict"`);
    if (typeof codec.typeSymbol !== "string" || codec.typeSymbol.length === 0) throw new Error(`${label}/${what}: missing typeSymbol`);
    // DSH < 0.1.7 browser registry: `typeof codec.schema.parse !== "function"` throws.
    if (!codec.schema || typeof codec.schema.parse !== "function") throw new Error(`${label}/${what}: DSH < 0.1.7 requires codec.schema.parse`);
    // DSH >= 0.1.7 browser registry: "strict codec has no create() factory".
    if (typeof codec.create !== "function") throw new Error(`${label}/${what}: DSH >= 0.1.7 requires codec.create`);
    if (typeof codec.create().parse !== "function") throw new Error(`${label}/${what}: create() must return a parseable schema`);
  };
  for (const p of desc.parameters) {
    if (!WIRE_NAME.test(p.name) || !WIRE_NAME.test(p.wire)) throw new Error(`${label}: invalid parameter/wire name`);
    if (p.source !== "json") throw new Error(`${label}: parameter source must be "json"`);
    codecRules(p.codec, p.name);
  }
  codecRules(desc.result, "result");
}

try {
  if (typeof CLIENT_REMOTE.package !== "string" || CLIENT_REMOTE.package.length === 0 || CLIENT_REMOTE.package.includes("#")) {
    throw new Error("contribution package name must be nonempty without '#'");
  }
  for (const desc of CLIENT_REMOTE.descriptors) checkClientDescriptor(desc);
  ok(`all ${CLIENT_REMOTE.descriptors.length} client descriptors pass both versions' codec rules`);
} catch (error) {
  fail("client contribution dual rules", error);
}

// Host/client wiring must stay in sync (endpoint, codec typeSymbols).
try {
  const clientById = new Map(CLIENT_REMOTE.descriptors.map((d) => [d.id, d]));
  for (const inv of TYPERT.invocations) {
    const desc = clientById.get(inv.id);
    if (!desc) throw new Error(`no client descriptor for ${inv.id}`);
    if (desc.service !== inv.service || desc.namespace !== inv.namespace || desc.method !== inv.method) {
      throw new Error(`${inv.id}: client/host endpoint mismatch`);
    }
    if (desc.result.typeSymbol !== inv.result.typeSymbol) throw new Error(`${inv.id}: result typeSymbol mismatch`);
    for (let i = 0; i < inv.parameters.length; i++) {
      if (desc.parameters[i].codec.typeSymbol !== inv.parameters[i].codec.typeSymbol) {
        throw new Error(`${inv.id}: parameter typeSymbol mismatch`);
      }
    }
  }
  ok("client descriptors mirror the host manifest endpoints/typeSymbols");
} catch (error) {
  fail("host/client wiring consistency", error);
}

// ---------------------------------------------------------------------------
// 3) Real Host-class construction against the installed typert-protocol.
// ---------------------------------------------------------------------------

console.log("\n[3] host class activation (index.js)");

await attempt("ArchiveManagerService constructs and marks restore/delete/state", async () => {
  const { Service } = await import("@deepseek-ai/cordis");
  const { remoteMethods } = await import("@deepseek-ai/dsh-typert-protocol");
  const instance = new ArchiveManagerService(makeCtx(), {});
  instance[Service.init]();
  const methods = remoteMethods(instance).map((r) => r.method);
  for (const expected of ["restore", "delete", "state"]) {
    if (!methods.includes(expected)) throw new Error(`remoteMethods missing "${expected}" (got ${JSON.stringify(methods)})`);
  }
  if (instance.name !== "archiveManager") throw new Error(`service key is ${instance.name}`);
});

// ---------------------------------------------------------------------------
// 1) REAL DSH installs (optional but strongest).
// ---------------------------------------------------------------------------

function findArtifact(root, pkg, file) {
  const candidates = [
    path.join(root, "node_modules", "@deepseek-ai", pkg, "lib", file),
    path.join(root, pkg, "package", "lib", file),
    path.join(root, "@deepseek-ai", pkg, "lib", file),
  ];
  return candidates.find((p) => existsSync(p));
}

async function importIfPresent(root, pkg, file, label) {
  const found = findArtifact(root, pkg, file);
  if (!found) return null;
  try {
    return await import(pathToFileURL(found).href);
  } catch (error) {
    skip(label, `present but not importable: ${error.message}`);
    return null;
  }
}

const installs = [
  {
    name: "DSH < 0.1.7",
    root: process.env.DSH_INSTALL_015
      || path.join(os.homedir(), "AppData", "Roaming", "DeepSeek Harness Desktop", "dsh"),
    env: "DSH_INSTALL_015",
  },
  {
    name: "DSH >= 0.1.7",
    root: process.env.DSH_INSTALL_017 || path.join(here, ".tmppkg", "v017"),
    env: "DSH_INSTALL_017",
  },
];

for (const install of installs) {
  console.log(`\n[4] real install: ${install.name} — ${install.root}`);

  const loader = await importIfPresent(install.root, "dsh-typert-loader", "index.js", `${install.name} typert-loader import`);
  if (loader && typeof loader.validateTypertManifest === "function") {
    await attempt(`${install.name} validateTypertManifest accepts the host manifest`, async () => {
      loader.validateTypertManifest(PKG, TYPERT);
    });
  } else if (!loader) {
    skip(`${install.name} typert-loader`, `not found (set ${install.env})`);
  }

  const registry = await importIfPresent(install.root, "dsh-typert-registry", "index.js", `${install.name} typert-registry import`);
  if (registry && registry.TypertRegistry) {
    const { TypertRegistry } = registry;
    await attempt(`${install.name} TypertRegistry accepts the host manifest`, async () => {
      const reg = new TypertRegistry(makeCtx());
      reg.register(TYPERT);
    });
    await attempt(`${install.name} TypertRegistry accepts the client contribution`, async () => {
      const reg = new TypertRegistry(makeCtx());
      reg.remotes.register(CLIENT_REMOTE);
    });
  } else if (!registry) {
    skip(`${install.name} typert-registry`, `not found (set ${install.env})`);
  }}

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}${skips > 0 ? ` (${skips} skipped)` : ""}`);
process.exit(failures === 0 ? 0 : 1);
