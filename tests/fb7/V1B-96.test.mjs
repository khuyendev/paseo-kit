// Kit feedback #96 b, c (V1B): the shared step logs "the fixer saw a failure outside the shared files" only when the fixer's
// outside answer names one (b), and a pending-request task leaves pendingRequestTasks once the run's commits (each after a green
// gate) hold its blocking paths (c): it is listed under pendingSettled with the commit.
import assert from "node:assert/strict";
import test from "node:test";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { execSharedReply } from "../../ship/.agents/workflows/lib/flow-exec.mjs";

const OUTSIDE = /the fixer saw a failure outside the shared files/;
const REPAIR = "lib/client/rpc.dart";
const exec = (w, overrides) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });

test("V1B 96 b exec-shared-reply logs an outside failure only when the answer names one", () => {
  const open = [{ id: "S1" }];
  const said = (outside) => execSharedReply({ waveId: "gsd-03-w5", open, reply: { status: "fixed", changes: [{ index: 0, applied: true }], outside } }).logs.filter((l) => OUTSIDE.test(l));
  for (const none of ["No failures outside the shared files were observed.", "none", "None.", "N/A", "nothing outside", "", "  ", undefined, "No other failures seen"]) assert.deepEqual(said(none), [], String(none));
  for (const some of ["test/app/router_test.dart fails to compile", "session_ping timeout in another plan's test", "No failure in the shared files, but test/bootstrap_test.dart fails", "No test of the shared files fails; test/x_test.dart times out"]) assert.equal(said(some).length, 1, some);
  assert.match(said("router_test fails")[0], /^shared gsd-03-w5: the fixer saw a failure outside the shared files, left to the gate: router_test fails$/);
});

test("V1B 96 b exec-shared-reply keeps the per-change report: present changes, and the line for an unresolved answer", () => {
  const open = [{ id: "S1" }, { id: "S2" }];
  assert.deepEqual(execSharedReply({ waveId: "w1", open, reply: { status: "fixed" } }), { made: ["S1", "S2"], logs: [] });
  const part = execSharedReply({ waveId: "w1", open, reply: { status: "unresolved", changes: [{ index: 1, applied: true }, { index: 0, applied: false }] } });
  assert.deepEqual(part.made, ["S2"]);
  assert.deepEqual(part.logs, ["shared w1: 1 of 2 change(s) reported present although the fixer answered unresolved; the gate verifies them"]);
});

test("V1B 96 b a run whose shared fixer says it saw no outside failure logs none", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, {
    "exec-01-01": async (...a) => ({ ...(await run(...a)), requests: [{ path: "config/app.json", change: "add key x", reason: "shared" }] }),
    "shared-": () => { w.write("config/app.json", "{}\n"); return { status: "fixed", changes: [{ index: 0, applied: true }], outside: "No failures outside the shared files were observed." }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.equal(r.logs.some((l) => OUTSIDE.test(l)), false, r.logs.filter((l) => /shared/.test(l)).join("\n"));
});

// 01-01 routes a repair of REPAIR (no plan owns it: a shared change) and reports its task 3 pending-request on it.
const pendingReply = (w, run) => async (...a) => ({ ...(await run(...a)), taskResults: [{ task: "1", status: "implemented" }, { task: "3", status: "pending-request", evidence: "waits for the repair", blockedBy: [REPAIR] }], requests: [{ path: REPAIR, change: "prefer payload.requestId", reason: "r" }] });

test("V1B 96 c a pending-request task whose blocking path the wave commit holds is settled, not listed as pending", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, { "exec-01-01": pendingReply(w, run), "shared-": () => { w.write(REPAIR, "// repaired\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.equal(r.result.pendingRequestTasks, undefined);
  const head = w.git("rev-parse", "HEAD").stdout.trim();
  assert.deepEqual(r.result.pendingSettled, [{ plan: "01-01", task: "3", blockedBy: [REPAIR], via: "blockedBy", commit: head }]);
  assert.ok(r.result.events.includes(`pending-request 01-01 3 settled ${head.slice(0, 7)}`));
  assert.ok(r.result.events.indexOf("pending-request 01-01 3") < r.result.events.findIndex((e) => e.startsWith("pending-request 01-01 3 settled")));
});

test("V1B 96 c a run that stops before the commit still lists the task as pending", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, { "exec-01-01": pendingReply(w, run), "shared-": () => ({ status: "unresolved", evidence: "cannot repair", changes: [{ index: 0, applied: false }] }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Integration"]);
  assert.deepEqual(r.result.pendingRequestTasks, [{ plan: "01-01", task: "3", blockedBy: [REPAIR], via: "blockedBy" }]);
  assert.equal(r.result.pendingSettled, undefined);
});
