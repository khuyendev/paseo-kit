// Kit feedback #87 part D (RD): docs/ITEM-MAP.md maps every feedback item 1-87 to what covers it. The map is a
// regression list, so it must not name a test file that does not exist, or a test title tag that no test of that file
// carries, and every item has exactly one row with a known status.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";

const MAP = path.join(KIT_DIR, "docs", "ITEM-MAP.md");
const LAST_ITEM = 87;
const STATUSES = new Set(["covered", "composition", "partial", "open", "superseded", "synthesis"]);
const NEEDS_TEST = new Set(["covered", "composition", "partial", "synthesis"]);
const REF = /`(tests\/[^`:]+\.test\.mjs)(?::([^`]+))?`/g;
const TITLE = /\btest\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;

// The rows of the map table: {item, status, tests: [{file, tag}], line}.
function parseMap(text) {
  const rows = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    rows.push({ item: Number(m[1]), status: cells[2], tests: [...(cells[4] ?? "").matchAll(REF)].map((r) => ({ file: r[1], tag: r[2] ?? null })), line: i + 1 });
  }
  return rows;
}

// Problems of a parsed map against the kit tree at `root`.
function mapProblems(rows, root) {
  const problems = [];
  const titles = new Map();
  const titlesOf = (file) => {
    if (!titles.has(file)) titles.set(file, [...fs.readFileSync(path.join(root, file), "utf8").matchAll(TITLE)].map((t) => t[2]));
    return titles.get(file);
  };
  const seen = new Map();
  for (const r of rows) {
    if (r.item < 1 || r.item > LAST_ITEM) problems.push(`line ${r.line}: item ${r.item} is outside 1-${LAST_ITEM}`);
    if (seen.has(r.item)) problems.push(`line ${r.line}: item ${r.item} is mapped again (first on line ${seen.get(r.item)})`);
    else seen.set(r.item, r.line);
    if (!STATUSES.has(r.status)) problems.push(`line ${r.line}: item ${r.item} has unknown status "${r.status}"`);
    if (NEEDS_TEST.has(r.status) && !r.tests.length) problems.push(`line ${r.line}: item ${r.item} is ${r.status} but names no test`);
    for (const { file, tag } of r.tests) {
      if (!fs.existsSync(path.join(root, file))) { problems.push(`line ${r.line}: item ${r.item} names ${file}, which does not exist`); continue; }
      if (tag && !titlesOf(file).some((t) => t.includes(tag))) problems.push(`line ${r.line}: item ${r.item}: no test title in ${file} contains "${tag}"`);
    }
  }
  for (let n = 1; n <= LAST_ITEM; n++) if (!seen.has(n)) problems.push(`item ${n} has no row`);
  return problems;
}

test("RD the item map names only existing test files and test titles, and maps every item 1-87 once", () => {
  const rows = parseMap(fs.readFileSync(MAP, "utf8"));
  assert.equal(rows.length, LAST_ITEM);
  assert.deepEqual(mapProblems(rows, KIT_DIR), []);
});

test("RD the check fails on a missing test file, a tag no title carries, a missing or doubled item and a row without a test", () => {
  const head = "| # | Item | Status | Layer | Tests | Notes |\n|---|---|---|---|---|---|\n";
  const rows = (lines) => parseMap(head + lines.join("\n"));
  const full = Array.from({ length: LAST_ITEM }, (_, i) => `| ${i + 1} | x | open | x |  | |`);
  assert.deepEqual(mapProblems(rows(full), KIT_DIR), []);
  const withRow = (n, row) => full.map((l, i) => (i === n - 1 ? row : l));
  assert.deepEqual(mapProblems(rows(withRow(5, "| 5 | x | covered | x | `tests/r87/no-such-file.test.mjs` | |")), KIT_DIR), ["line 7: item 5 names tests/r87/no-such-file.test.mjs, which does not exist"]);
  assert.deepEqual(mapProblems(rows(withRow(5, "| 5 | x | covered | x | `tests/r87/RD-item-map.test.mjs:no title has this` | |")), KIT_DIR), ['line 7: item 5: no test title in tests/r87/RD-item-map.test.mjs contains "no title has this"']);
  assert.deepEqual(mapProblems(rows(withRow(5, "| 5 | x | covered | x | `tests/r87/RD-item-map.test.mjs:names only existing test files` | |")), KIT_DIR), []);
  assert.deepEqual(mapProblems(rows(withRow(5, "| 5 | x | covered | x |  | |")), KIT_DIR), ["line 7: item 5 is covered but names no test"]);
  assert.deepEqual(mapProblems(rows(withRow(5, "| 5 | x | fixed | x |  | |")), KIT_DIR), ['line 7: item 5 has unknown status "fixed"']);
  assert.deepEqual(mapProblems(rows(withRow(5, "| 4 | x | open | x |  | |")), KIT_DIR), ["line 7: item 4 is mapped again (first on line 6)", "item 5 has no row"]);
  assert.deepEqual(mapProblems(rows([...full, "| 88 | x | open | x |  | |"]), KIT_DIR), [`line ${LAST_ITEM + 3}: item 88 is outside 1-${LAST_ITEM}`]);
});
