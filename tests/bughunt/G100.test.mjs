// G100: gsd-verify names the uat or plan-gaps route only after its UAT write or requirements revert succeeded.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";

const REPORT = `${PHASE_DIR}/01-VERIFICATION.md`;
const UAT = `${PHASE_DIR}/01-UAT.md`;

function verifyWorld() {
  const w = makeWorld();
  w.gsd.on("verification status", () => {
    const t = w.read(REPORT);
    if (!t) return { code: 66, json: { status: "missing" } };
    const status = /^status: (.*)$/m.exec(t)[1];
    return { code: 0, json: { status, sha: `sha-${t.length}`, score: "3/3", gaps: status === "gaps_found" ? [{ id: "G1" }] : [], human_verification: status === "human_needed" ? [{ test: "open the app", expected: "it starts" }] : [] } };
  });
  w.gsd.on("verification fingerprint", () => ({ covered_files: ["a"], covered_digest: "kit:abc" }));
  w.gsd.on("phase complete", () => { w.events.push("phase complete"); return { completed: true, warnings: [] }; });
  return w;
}
const verify = (w, status) => runScript("gsd-verify", {
  root: w.root,
  gsd: w.gsd,
  args: { phaseDir: PHASE_DIR },
  agent: () => { w.write(REPORT, `---\nstatus: ${status}\n---\nreport ${status}\n`); return { status }; },
});

test("G100 a rejected UAT write fails the run and names no uat route", async () => {
  const w = verifyWorld();
  w.gsd.on("write", () => ({ code: 1, json: { status: "error", error: "EPERM: rename" } }));
  const r = await verify(w, "human_needed");
  assert.equal(r.result.status, "failed", JSON.stringify(r.result));
  assert.match(r.result.reason, /UAT write failed: EPERM: rename/);
  assert.equal(r.result.route, undefined);
  assert.equal(w.read(UAT), "");
});

test("G100 a failed requirements revert fails the run and names no plan-gaps route", async () => {
  const w = verifyWorld();
  w.gsd.on("requirements revert", () => ({ code: 1, json: { status: "error", error: "REQUIREMENTS.md does not exist" } }));
  const r = await verify(w, "gaps_found");
  assert.equal(r.result.status, "failed", JSON.stringify(r.result));
  assert.match(r.result.reason, /requirements revert failed: REQUIREMENTS\.md does not exist/);
  assert.equal(r.result.route, undefined);
});
