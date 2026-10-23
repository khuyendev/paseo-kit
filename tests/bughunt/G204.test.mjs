// G204: the forensics topic reaches the helper on stdin, never as shell text, and the skill describes the JSON output.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { main, readsStdin } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";

const FLOW = path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs");
const SKILL = path.join(SHIP_DIR, ".claude/skills/gsd-forensics/SKILL.md");

test("G204 forensics-path takes the topic from stdin, so $(...) in it is only slug text", async () => {
  let line = "";
  const code = await main(["forensics-path"], { root: process.cwd(), input: "review $(touch marker)", out: (l) => { line = l; } });
  assert.equal(code, 0);
  assert.match(JSON.parse(line).path, /^\.planning\/forensics\/\d{4}-\d{2}-\d{2}-review-touch-marker\.md$/);
});

test("G204 the CLI reads the topic from its stdin and prints one JSON object with a path field", () => {
  const r = spawnSync(process.execPath, [FLOW, "forensics-path"], { input: "review run 2", encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout.trim().split(/\r?\n/).pop()).path, /-review-run-2\.md$/);
});

test("G204 forensics-path is a stdin verb, so the shell helper reads its input", () => {
  assert.equal(readsStdin("forensics-path"), true);
});

test("G204 the forensics skill sends the topic on stdin and describes the JSON output", () => {
  const t = fs.readFileSync(SKILL, "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(t, /forensics-path "/);
  for (const s of ["forensics-path <<'EOF'", "`@'`", "on stdin", "one JSON object", "`path` field"]) assert.ok(t.includes(s), s);
});
