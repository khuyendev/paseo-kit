import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MSG } from "../../ship/.claude/hooks/io_guard.mjs";
import { main as kitMain } from "../../kit.mjs";
import { testEnv } from "../helpers/env.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { benchContextGuard } from "./bench_context_guard.mjs";

// The five File I/O rules (HOOK-24) and the words each io guard reminder uses to state its rule. Since 2026-10-22 the
// reminders carry the rules alone: the AGENTS.md block no longer repeats them (owner decision).
const RULES = {
  lookups: /Grep[^\n]*content[^\n]*Glob[^\n]*name/i,
  readBatch: /relevant[^\n]*(parts|sections|functions)[^\n]*/i,
  editBatch: /batch edits[^\n]*whole-file writes[^\n]*new files/i,
  noReread: /(not|never) re-read[^\n]*verify[^\n]*write/i,
  correctness: /correctness[^\n]*(over|priority over) fewer (tool )?calls/i,
};
const KIND_RULE = [
  ["firstLookup", MSG.firstLookup, "readBatch", /as few rounds as possible/],
  ["lookupStreak", MSG.lookupStreak(2), "lookups", /one Grep with alternation, one Glob/],
  ["empty", MSG.empty, "lookups", /Fix the pattern inside the next batched call/],
  ["truncated", MSG.truncated, "lookups", /Narrow the path or the pattern/],
  ["firstEdit", MSG.firstEdit, "editBatch", /apply them all in one turn/],
  ["editStreak", MSG.editStreak(2), "editBatch", /write_multiple_files for new files/],
  ["reread", MSG.reread(["a"]), "noReread", /do not re-read the file to verify it/],
];

const blockOf = (text) => /<!-- PASEO-HARNESS-KIT START[^\n]*\n([\s\S]*?)<!-- PASEO-HARNESS-KIT END -->/.exec(text)?.[1] ?? "";
const count = (text, re) => (text.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`)) ?? []).length;

test("HOOK-24 each io guard reminder kind states one File I/O rule", () => {
  for (const [kind, text, rule, words] of KIND_RULE) {
    assert.ok(RULES[rule], kind);
    assert.match(text, words, kind);
  }
  assert.deepEqual(new Set(KIND_RULE.map(([kind]) => kind)), new Set(Object.keys(MSG)));
});

test("HOOK-24 an installed block leaves the File I/O rules to the io guard reminders and an update does not duplicate the block", async () => {
  const project = makeTempProject();
  const env = testEnv();
  const io = { env, out: () => {}, err: () => {} };
  assert.ok([0, 2].includes(await kitMain(["install", project.root], io)));
  assert.ok([0, 2].includes(await kitMain(["update", project.root], io)));
  const block = blockOf(project.read("AGENTS.md"));
  assert.ok(block, "kit block present");
  for (const [name, re] of Object.entries(RULES)) assert.equal(count(block, re), 0, `${name} is not repeated in the installed block`);
  assert.equal(count(project.read("AGENTS.md"), /PASEO-HARNESS-KIT START/), 1);
  assert.ok(fs.existsSync(path.join(SHIP_DIR, "blocks", "AGENTS.md")));
});

test("HOOK-12 the shipped benchmark reports p50/p95 far below the 10 s hook timeout", () => {
  const { runs, p50, p95 } = benchContextGuard(5);
  assert.equal(runs, 5);
  assert.ok(p50 > 0 && p95 >= p50);
  assert.ok(p95 < 10000, `p95 ${p95} ms`);
});
