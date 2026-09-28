#!/usr/bin/env node
/**
 * Boot-gate check: run the REAL DSH profile loader against this plugin and
 * report whether dsh-app-boot's `skippedBundles` would drop it at boot.
 *
 * This is the exact code path behind the launcher line
 *   `dsh: skipping profile bundle "<name>": <reason>`
 * emitted by `reportSkippedBundles`. Loading a profile never prints, so this
 * reproduces the decision the launcher makes — including the DSH >= 0.2.0
 * `peerDependencies` compatibility gate in `evaluatePluginCompatibility`, which
 * is what made dsh-archive-manager silently disappear on dsh 0.2.0.
 *
 * Usage:
 *   node scripts/check-profile-bundle.mjs              # the live profile
 *   node scripts/check-profile-bundle.mjs --sandbox    # throwaway profile,
 *                                                      # links THIS repo in
 *
 * `--sandbox` builds a temporary profile whose only bundle is a link to this
 * working tree, so the answer always reflects the code under review rather than
 * whatever npm copy a profile happens to hold. It needs no DSH home and is
 * therefore safe to run on any machine and in CI.
 *
 * Exit code 0 = the bundle loads; 1 = dsh would skip it.
 */
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const PACKAGE_NAME = "@duke-dsh-plugins/dsh-archive-manager";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const installRoot =
  argValue("--install")
  || process.env.DSH_INSTALL
  || path.join(os.homedir(), "AppData", "Roaming", "DeepSeek Harness Desktop", "dsh");
const packageName = argValue("--package") || PACKAGE_NAME;
const sandbox = process.argv.includes("--sandbox");

const appBoot = path.join(installRoot, "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
if (!existsSync(appBoot)) {
  console.error(`dsh-app-boot not found at ${appBoot}; pass --install <dsh install dir>`);
  process.exit(2);
}

const dshManifest = path.join(installRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
const runtimeVersion = JSON.parse(readFileSync(dshManifest, "utf8")).version;
const { loadProfileDirectory, reportSkippedBundles } = await import(pathToFileURL(appBoot).href);
if (typeof loadProfileDirectory !== "function") {
  console.error(`${appBoot} does not export loadProfileDirectory (DSH version too old for this check)`);
  process.exit(2);
}

/**
 * Build a throwaway profile that resolves `packageName` to `sourceDir`.
 * `resolveBundleDir` probes Node's own module lookup paths from the profile
 * manifest, so a single junction under the profile's node_modules is enough.
 */
function buildSandboxProfile(sourceDir) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dsh-archive-manager-profile-"));
  const modules = path.join(dir, "node_modules");
  mkdirSync(path.join(modules, path.dirname(packageName)), { recursive: true });
  symlinkSync(sourceDir, path.join(modules, packageName), "junction");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "dsh-profile-check", private: true, dependencies: {}, dsh: { profile: { bundles: [packageName] } } },
      undefined,
      2,
    ),
  );
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n");
  return dir;
}

const sandboxDir = sandbox ? buildSandboxProfile(repo) : undefined;
const profileDir = sandboxDir ?? path.join(os.homedir(), ".dsh", "profiles", argValue("--profile") || "web");

console.log(`dsh runtime      : ${runtimeVersion}`);
console.log(`install root     : ${installRoot}`);
console.log(`profile          : ${profileDir}${sandbox ? "  (throwaway; links this working tree)" : ""}`);
console.log(`bundle           : ${packageName}`);

let profile;
try {
  profile = loadProfileDirectory("dsh", profileDir, dshManifest, { userLayer: false });
} catch (error) {
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
  console.error(`dsh could not load the profile at all:\n${String(error)}`);
  process.exit(1);
}

const layer = profile.layers.find((l) => l.packageName === packageName);
const skipped = profile.skippedBundles.find((s) => s.packageName === packageName);

if (skipped) {
  console.error(`\nSKIPPED by dsh at boot:\n${skipped.reason}`);
  reportSkippedBundles("dsh", profile);
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
  process.exit(1);
}
if (!layer) {
  console.error(`\n${packageName} is not among the profile's loaded bundle layers`);
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
  process.exit(1);
}

console.log(`\nLOADED — bundle layer mounted from ${layer.packageDir}`);
console.log(`patch files      : ${layer.patchPaths.join(", ")}`);
console.log(`patch rows       : ${JSON.stringify(layer.patches)}`);
const others = profile.skippedBundles.map((s) => s.packageName);
if (others.length > 0) console.log(`(other skipped bundles in this profile: ${others.join(", ")})`);
if (sandboxDir) {
  rmSync(sandboxDir, { recursive: true, force: true });
  console.log("(throwaway profile removed)");
}
