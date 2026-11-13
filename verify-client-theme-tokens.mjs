#!/usr/bin/env node
/**
 * Static guard for the confirm-dialog danger button's foreground token.
 *
 * Bug: `.am-confirm-danger` used `color: var(--dsw-alias-bg-base, #fff)` —
 * the PAGE background token. In dark themes that resolves to near-black
 * (rgb(21,21,23)) on the red danger fill, so the "永久删除" label was
 * unreadable; wallpaper plugins could even rewrite it to `transparent`.
 *
 * The host ships a semantically correct on-color token —
 * `--dsw-alias-label-on-color` (always rgb(255,255,255), and not rewritten
 * by wallpaper plugins) — so the danger button must use it, and the hover
 * rule must pin the same color (its `filter: brightness(1.06)` brightens
 * the red fill).
 *
 * This is a source-level guard: no DOM, no React, no browser.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, "client.js");

let failures = 0;
const ok = (label) => console.log(`  ok    ${label}`);
const fail = (label, error) => {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${error instanceof Error ? error.message : error}`);
};
const expect = (cond, label) => (cond ? ok(label) : fail(label, new Error("assertion failed")));

const source = fs.readFileSync(clientPath, "utf8");
const lines = source.split(/\r?\n/);

// Every CSS rule that targets the confirm dialog's danger button.
const dangerRules = lines
  .map((text, index) => ({ text: text.trim(), line: index + 1 }))
  .filter(({ text }) => text.includes(".am-confirm-danger") && text.includes("{"));

expect(dangerRules.length >= 2, `found the .am-confirm-danger rules (${dangerRules.length})`);

const baseRule = dangerRules.find(({ text }) => !text.includes(":hover"));
const hoverRule = dangerRules.find(({ text }) => text.includes(":hover"));

expect(Boolean(baseRule), "found the base .am-confirm-danger rule");
expect(Boolean(hoverRule), "found the :hover .am-confirm-danger rule");

// 1) The page-background token must never leak into the danger button.
for (const rule of dangerRules) {
  expect(
    !rule.text.includes("var(--dsw-alias-bg-base"),
    `line ${rule.line}: no var(--dsw-alias-bg-base in the danger rule`
  );
}

// 2) The on-color token must be used — for the resting state and for hover.
if (baseRule) {
  expect(
    baseRule.text.includes("color:var(--dsw-alias-label-on-color"),
    `line ${baseRule.line}: base rule colors with var(--dsw-alias-label-on-color)`
  );
}
if (hoverRule) {
  expect(
    hoverRule.text.includes("color:var(--dsw-alias-label-on-color"),
    `line ${hoverRule.line}: hover rule pins color:var(--dsw-alias-label-on-color)`
  );
}

// 3) No hard-coded white in place of the host token.
for (const rule of dangerRules) {
  expect(
    !/color:\s*#fff\b/.test(rule.text),
    `line ${rule.line}: no hard-coded #fff color (use the host token)`
  );
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
