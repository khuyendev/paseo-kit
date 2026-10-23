// G127: a detached workflow's wait can be quiet, so the leader is woken once at the end and not by every progress line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup } from "../workflow/helpers.mjs";

function fixtureRun(s, id, { status = "done", log = [] } = {}) {
  const dir = path.join(s.project.path("_workspace/_runs"), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: id, status, pid: 1, startedAt: "2026-10-20T10:00:00.000Z", endedAt: null, name: "n" }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "log.txt"), log.map((l) => `${l}\n`).join(""));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), "");
}

const LOG = [
  "workflow start wf_q x",
  "phase Plan",
  "log wave 1",
  "agent start #1 a 12345678 p/m",
  "agent done #1 a ok tokens=1 cost=? 1s",
  "agent done #2 b null (finished without a reply) tokens=0 cost=? 1s",
  "shell start #3 make",
  "shell done #3 code=0 1s",
  "workflow done wf_q: /runs/wf_q/result.json (ok 1, null 1, cached 0, tokens 1, cost $0)",
];

test("G127 --quiet prints only the line that ends the watch, from the start and after a resume", async () => {
  const s = setup();
  fixtureRun(s, "wf_q", { log: LOG });
  const quiet = await s.ph(["watch-run", "wf_q", "--from-start", "--quiet"]);
  assert.equal(quiet.code, 0);
  assert.deepEqual(quiet.out, ["workflow done wf_q: /runs/wf_q/result.json (ok 1, null 1, cached 0, tokens 1, cost $0)"]);
  const resumed = await s.ph(["watch-run", "wf_q", "--quiet"]);
  assert.deepEqual(resumed.out, ["workflow done wf_q: /runs/wf_q/result.json (ok 1, null 1, cached 0, tokens 1, cost $0)"]);
});

test("G127 --quiet still reports a run that ends without a terminal log line", async () => {
  const s = setup();
  fixtureRun(s, "wf_s", { status: "stopped", log: ["phase Plan"] });
  const r = await s.ph(["watch-run", "wf_s", "--from-start", "--quiet"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ["workflow ended (run.json status stopped)"]);
});

test("G127 --quiet and --all together are a usage error", async () => {
  const s = setup();
  fixtureRun(s, "wf_q", { log: LOG });
  const r = await s.ph(["watch-run", "wf_q", "--all", "--quiet"]);
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /give --all or --quiet, not both/);
});
