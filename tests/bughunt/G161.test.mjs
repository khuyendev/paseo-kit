import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { runRecord } from "../../ship/.agents/harness/workflow/metrics.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { setup } from "../workflow/helpers.mjs";

const OK = { n: 1, label: "plan:a", agentId: "a1", status: "ok", duration_s: 10, tokens: 5, usage: { input: 100, cachedInput: 50, output: 5, costUsd: 0.01 } };
const INFO = { runId: "wf_n", status: "done", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:40.000Z", name: "n" };

test("G161 readJournal drops JSON null lines and keeps the object entries", () => {
  const dir = makeTempDir();
  const j = path.join(dir, "journal.jsonl");
  fs.writeFileSync(j, ["null", JSON.stringify(OK), "null", ""].join("\n"));
  assert.deepEqual(readJournal(j), [OK]);
});

test("G161 run-stats of a journal with JSON null lines prints the numbers of its valid entries", async () => {
  const s = setup();
  const dir = s.project.path("_workspace/_runs/wf_n");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(INFO));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), ["null", JSON.stringify(OK), "null", ""].join("\n"));
  const r = await s.ph(["run-stats", "wf_n"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, [
    "wf_n [plan] status done",
    "wall 100 s; agents 1: median 10 s, slowest 10 s; tokens in 100 cached 50 out 5; cost $0.01",
  ]);
});

test("G161 runRecord (ledger import) accepts a journal with a JSON null line", () => {
  const dir = makeTempDir();
  const j = path.join(dir, "journal.jsonl");
  fs.writeFileSync(j, ["null", JSON.stringify(OK)].join("\n"));
  const rec = runRecord("wf_n", INFO, readJournal(j), null);
  assert.equal(rec.runId, "wf_n");
  assert.equal(rec.status, "done");
});
