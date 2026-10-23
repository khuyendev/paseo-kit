// THIN.md stage 2 (TE, kit feedback 87): gsd-execute.js is a composition: its agent prompts are kit templates, its reply schemas
// and decisions are kit verbs, and it does not grow back. The 700-line budget of THIN item 4 (TI-budget) is not met by stage 2:
// this ratchet keeps the size reached (1887 -> at most EXECUTE_RATCHET lines) until a later stage moves more out. Stage 3 S1
// (TS1) moved the steps the schedules share into the kit step library (harness/workflow/steps.mjs): 1461 -> 441, the
// ratchet follows; the prompts and the exec-* verbs are the composition's and its steps'.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COMMAND_NAMES } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { compositionBudget, WORKFLOWS_DIR } from "./budget.mjs";

const EXECUTE_RATCHET = 441;
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const text = `${read(path.join(WORKFLOWS_DIR, "gsd-execute.js"))}\n${read(path.join(SHIP_DIR, ".agents/harness/workflow/steps.mjs"))}`;

test("TE gsd-execute.js stays within the size stage 2 reached and defines no engine helper", () => {
  const { lines, helperDefinitions } = compositionBudget("gsd-execute.js");
  assert.ok(lines <= EXECUTE_RATCHET, `gsd-execute.js has ${lines} lines; stage 3 S1 left it at ${EXECUTE_RATCHET}`);
  assert.deepEqual(helperDefinitions, []);
});

test("TE gsd-execute.js holds no agent prompt text and no reply schema: it renders kit templates and takes the schemas from exec-setup", () => {
  for (const inline of [/<kit_executor_runtime>/, /<kit_fixer_runtime>/, /Verify these review findings/, /Resolution check of plan/, /Lines this plan changed/, /Cross-plan change requests were made/, /Integration fix: these gate failures/, /Fix round \$\{/, /Shared changes for \$\{/, /const \w+_SCHEMA = \{/, /Measurement only \(it changes nothing/]) {
    assert.doesNotMatch(text, inline);
  }
  const rendered = [...text.matchAll(/renderPrompt\("([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rendered)].sort(), ["code-review", "executor", "executor-fix", "finding-verifier", "fixer", "integration-fix", "request-resolver", "resolution-check", "shared-changes"]);
  for (const name of rendered) assert.ok(fs.existsSync(path.join(WORKFLOWS_DIR, "prompts", `${name}.md`)), name);
  const verbs = [...new Set([...text.matchAll(/flow\(\["(exec-[a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(verbs.length >= 15, verbs.join(", "));
  for (const v of verbs) assert.ok(COMMAND_NAMES.includes(v), v);
});
