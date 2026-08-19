// Standalone smoke test for the cross-platform delete/state logic copied
// verbatim from ArchiveManagerService (node:fs based, no PowerShell).
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function assert(cond, label) {
  if (cond) console.log("PASS  " + label);
  else { failures++; console.error("FAIL  " + label); }
}

// --- delete(): remove a located session log directory -----------------------
async function deleteLike(location) {
  let removed = false;
  let fileError;
  if (location && location.path) {
    const target = String(location.path);
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      removed = !existsSync(target);
      if (!removed) fileError = "path-still-exists";
    } catch (error) {
      fileError = String(error && error.message ? error.message : error);
    }
  } else {
    removed = true;
  }
  return { removed, fileError };
}

const base = await mkdtemp(join(tmpdir(), "am-smoke-"));

// 1. real directory with nested files (session.jsonl.zstd + .bak)
const logDir = join(base, "session-abc");
await mkdir(logDir, { recursive: true });
await writeFile(join(logDir, "session.jsonl.zstd"), "fake");
await writeFile(join(logDir, "session.jsonl.zstd.bak"), "fake-bak");
const r1 = await deleteLike({ path: logDir });
assert(r1.removed === true && r1.fileError === undefined, "delete: real dir removed, no error");
assert(existsSync(logDir) === false, "delete: dir verified gone");

// 2. path already missing (force:true must not throw)
const r2 = await deleteLike({ path: join(base, "does-not-exist") });
assert(r2.removed === true && r2.fileError === undefined, "delete: missing path treated as removed");

// 3. no located artifact
const r3 = await deleteLike(undefined);
assert(r3.removed === true, "delete: no location → already gone");

// --- state(): ghost = live session whose located path no longer exists ------
function ghostLike(location) {
  return !!(location && location.path && !existsSync(String(location.path)));
}
assert(ghostLike({ path: join(base, "does-not-exist") }) === true, "state: missing dir → ghost");
assert(ghostLike({ path: base }) === false, "state: existing dir → not ghost");
assert(ghostLike(undefined) === false, "state: no location → not ghost");

await rm(base, { recursive: true, force: true });
console.log(failures === 0 ? "ALL PASS" : failures + " FAILURES");
process.exitCode = failures === 0 ? 0 : 1;
