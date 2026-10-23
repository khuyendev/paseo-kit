// G045: two gsd-verify runs of one phase at once share one VERIFICATION report and one verify attempt record.
// The second run is refused while the first holds the phase verification lock; no attempt is recorded for it.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";

const REPORT_V = `${PHASE_DIR}/01-VERIFICATION.md`;
function verifyWorld() {
  const w = makeWorld();
  w.gsd.on("verification status", () => {
    const t = w.read(REPORT_V);
    if (!t) return { code: 66, json: { status: "missing" } };
    const status = /^status: (.*)$/m.exec(t)?.[1];
    if (!["passed", "gaps_found", "human_needed"].includes(status)) return { code: 1, json: { status: "invalid", error: "bad status" } };
    return { code: 0, json: { status, sha: `sha-${t.length}-${t.charCodeAt(t.length - 2)}`, score: "3/3", gaps: status === "gaps_found" ? [{ id: "G1" }] : [], human_verification: [] } };
  });
  w.gsd.on("verification fingerprint", () => ({ covered_files: ["a"], covered_digest: "kit:abc" }));
  w.gsd.on("phase complete", () => { w.events.push("phase complete"); return { completed: true, warnings: [] }; });
  w.gsd.on("requirements revert", () => { w.events.push("requirements revert"); return { reverted: ["R-1"] }; });
  return w;
}
const verify = (w, agent, args = {}, runId) => runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, ...args }, agent, ...(runId ? { runId } : {}) });
const writes = (w, status) => () => { w.write(REPORT_V, `---\nstatus: ${status}\n---\nreport ${status}\n`); return { status }; };

test("G045 a second verify of a phase is refused while the first holds the phase lock and records no attempt", async () => {
  const w = verifyWorld();
  let dispatched;
  const inFlight = new Promise((resolve) => { dispatched = resolve; });
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const first = verify(w, async () => { dispatched(); await gate; return writes(w, "passed")(); }, {}, "wf_a");
  await inFlight;
  const second = await verify(w, writes(w, "gaps_found"), {}, "wf_b");
  assert.equal(second.result.status, "refused", JSON.stringify(second.result));
  assert.match(second.result.reason, /wf_a/);
  assert.equal(second.calls.length, 0);
  assert.equal(w.attempts.verify.runId, "wf_a");
  assert.equal(w.read(REPORT_V), "");
  finish();
  const a = await first;
  assert.deepEqual([a.result.status, a.result.route], ["passed", "complete"], JSON.stringify(a.result));
  assert.equal(w.events.includes("requirements revert"), false);
});

test("G045 the phase lock is released when a verify ends without a report, so the next verify runs", async () => {
  const w = verifyWorld();
  const failed = await verify(w, () => ({ status: "failed" }), {}, "wf_c");
  assert.match(failed.result.reason, /wrote no/);
  const next = await verify(w, writes(w, "gaps_found"), {}, "wf_d");
  assert.deepEqual([next.result.route, w.events.includes("requirements revert")], ["plan-gaps", true], JSON.stringify(next.result));
});
