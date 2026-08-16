#!/usr/bin/env node
/**
 * Local installer for dsh-archive-manager.
 *
 * Installs the plugin into the DSH web profile:
 *   1. Copies this package (the project root) into
 *      `<DSH_HOME>/profiles/web/node_modules/dsh-archive-manager/`.
 *   2. Ensures the profile's `cordis.patch.yml` mounts it via an `insert` row.
 *   3. Reports whether a DSH restart is required.
 *
 * Usage:
 *   node scripts/install.mjs            # install into default profile (web)
 *   DSH_HOME=<path> node scripts/install.mjs
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
const PKG_NAME = "dsh-archive-manager";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const PROFILE = process.env.DSH_PROFILE || "web";
const PROFILE_DIR = join(DSH_HOME, "profiles", PROFILE);
const NODE_MODULES = join(PROFILE_DIR, "node_modules");
const TARGET = join(NODE_MODULES, PKG_NAME);
const PATCH_FILE = join(PROFILE_DIR, "cordis.patch.yml");

/** Files shipped to the profile (everything except dev/ignored files). */
const SHIP = ["package.json", "index.js", "client.js", "typert.host.js"];

function log(prefix, message) {
  console.log(`[${prefix}] ${message}`);
}

function pkgJson() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
}async function ensureProfile() {
  await mkdir(NODE_MODULES, { recursive: true });
}

async function copyPackage() {
  await mkdir(TARGET, { recursive: true });
  for (const file of SHIP) {
    const src = join(PROJECT_ROOT, file);
    if (!existsSync(src)) throw new Error(`missing shipped file: ${file}`);
    await cp(src, join(TARGET, file));
  }
  log("install", `copied plugin to ${TARGET}`);
}

/** Merge an `insert` row for the plugin into the profile patch (idempotent). */
async function ensurePatch() {
  let text = "";
  if (existsSync(PATCH_FILE)) {
    text = await readFile(PATCH_FILE, "utf8");
  }
  const marker = `name: '${PKG_NAME}'`;
  if (text.includes(marker)) {
    log("patch", "plugin row already present, skipping");
    return false;
  }
  const insert = `
# --- dsh-archive-manager (managed by scripts/install.mjs) ---
- insert:
  - id: archive-manager
    name: '${PKG_NAME}'
`;
  // Reuse an existing trailing insert block if it is the only content, else append.
  const trimmed = text.trimEnd();
  const next = trimmed.length === 0 ? insert : trimmed + "\n" + insert;
  await writeFile(PATCH_FILE, next, "utf8");
  log("patch", `added mount row to ${PATCH_FILE}`);
  return true;
}

/** Best-effort dependency availability check. */
async function checkDeps() {
  const deps = ["zod", "@deepseek-ai/cordis", "@deepseek-ai/dsh-typert-protocol", "@deepseek-ai/dsh-storage-domain"];
  const missing = [];
  for (const dep of deps) {
    const candidates = [
      join(NODE_MODULES, dep, "package.json"),
      join(TARGET, "node_modules", dep, "package.json"),
    ];
    const found = candidates.some((p) => existsSync(p));
    if (!found) missing.push(dep);
  }
  if (missing.length) {
    log("warn", `dependencies not resolvable from profile: ${missing.join(", ")}`);
    log(
      "warn",
      `run "npm install" in ${PROJECT_ROOT} and copy node_modules into ${TARGET}, ` +
        `or add the deps to the profile so DSH can resolve them.`
    );
  }
}

async function main() {
  const info = pkgJson();
  log("info", `installing ${info.name}@${info.version} into DSH profile "${PROFILE}"`);
  await ensureProfile();
  await copyPackage();
  await ensurePatch();
  await checkDeps();
  log("done", `restart DSH (node <dsh bin> web --profile ${PROFILE}) for the plugin to take effect.`);
}

main().catch((error) => {
  console.error(`[install] failed: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
