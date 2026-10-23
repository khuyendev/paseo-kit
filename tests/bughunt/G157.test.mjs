import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup } from "../workflow/helpers.mjs";

// A run directory next to the runs dir (_workspace/_runs), reachable only by walking out of it with ..
function outsideRun(s) {
  const dir = s.project.path("_workspace/outside");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: "outside", status: "done", pid: 1, startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:40.000Z", name: "secret-role" }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "journal.jsonl"), "");
  fs.writeFileSync(path.join(dir, "log.txt"), "workflow done outside: secret\n");
}

function okRun(s, id) {
  const dir = s.project.path(`_workspace/_runs/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: id, status: "stopped", pid: 1, startedAt: "2026-10-20T10:00:00.000Z", name: "n" }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "log.txt"), "");
  fs.writeFileSync(path.join(dir, "journal.jsonl"), "");
}

test("G157 watch-run refuses a run id that leaves the runs dir before any stream starts", async () => {
  const s = setup();
  outsideRun(s);
  okRun(s, "wf_ok");
  const r = await s.ph(["watch-run", "wf_ok", "../outside", "--all"]);
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /invalid run id '\.\.\/outside'/);
  assert.deepEqual(r.out, []);
  assert.equal((await s.ph(["watch-run", ".."])).code, 1);
});

test("G157 run-stats fails the bad id on its own line and still prints the good run", async () => {
  const s = setup();
  outsideRun(s);
  okRun(s, "wf_ok");
  const r = await s.ph(["run-stats", "../outside", "wf_ok"]);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^failed \.\.\/outside: invalid run id '\.\.\/outside'/);
  assert.equal(r.out[1], "wf_ok [] status stopped");
  assert.match(r.out[2], /^wall /);
  assert.equal(r.out.length, 3);
  assert.ok(!r.out.some((l) => l.includes("secret-role")));
});
