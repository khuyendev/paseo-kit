import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../workflow/helpers.mjs";

const DEAD_PID = spawnSync(process.execPath, ["-e", ""]).pid;

function fixtureRun(s, id, { status, pid = DEAD_PID, log = [], extra = {} }) {
  const dir = path.join(s.project.path("_workspace/_runs"), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: id, status, pid, startedAt: "2026-10-20T10:00:00.000Z", name: "n", ...extra }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "log.txt"), log.map((l) => `${l}\n`).join(""));
  return dir;
}

test("G159 the stop reason and the error of a run that ended without a terminal log line reach the watch line", async () => {
  const s = setup();
  fixtureRun(s, "wf_s", { status: "stopped", log: ["workflow start wf_s x"], extra: { stopReason: "owner: cancel, the spec changed" } });
  fixtureRun(s, "wf_x", { status: "failed", log: ["workflow start wf_x x"], extra: { error: "Cannot connect to daemon: ECONNREFUSED" } });
  const stopped = await s.ph(["watch-run", "wf_s"]);
  assert.equal(stopped.out.at(-1), "workflow ended (run.json status stopped; reason: owner: cancel, the spec changed)");
  const failed = await s.ph(["watch-run", "wf_x"]);
  // A failed run is followed by its resume command (feedback #39).
  assert.equal(failed.out.at(-2), "workflow ended (run.json status failed; error: Cannot connect to daemon: ECONNREFUSED)");
  assert.match(failed.out.at(-1), /^next: resume with `node ".+ph\.mjs" workflow --resume wf_x --detach`; /);
});

test("G159 a multi-line or long stop reason is shown on one line of at most 300 characters", async () => {
  const s = setup();
  fixtureRun(s, "wf_m", { status: "stopped", extra: { stopReason: `first line\n   second  line ${"x".repeat(400)}` } });
  const r = await s.ph(["watch-run", "wf_m"]);
  assert.equal(r.out.length, 1);
  const reason = `first line second line ${"x".repeat(300)}`.slice(0, 300);
  assert.equal(r.out[0], `workflow ended (run.json status stopped; reason: ${reason})`);
});

test("G159 the ph skill says which watch lines are printed by default and how several runs are prefixed", () => {
  const doc = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md"), "utf8");
  assert.ok(doc.includes("`ph watch-run RUNID --all` prints every line below."));
  assert.ok(doc.includes("each line starts with `[<last 4 characters of the run id>] `."));
  assert.ok(doc.includes("grep --line-buffered -E '(^|\\] )(phase |agent (start|done) )'"));
});

test("G159 a done run.json whose terminal log line is written a moment later still shows that line", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock });
  const dir = fixtureRun(s, "wf_r", { status: "done" });
  const p = s.ph(["watch-run", "wf_r"]);
  const step = async () => {
    await clock.advance(1000);
    await new Promise((r) => setImmediate(r));
  };
  fs.appendFileSync(path.join(dir, "log.txt"), "workflow done wf_r: r.json (ok 1)\n");
  await step();
  const r = await p;
  assert.deepEqual(r.out, ["workflow done wf_r: r.json (ok 1)"]);
});
