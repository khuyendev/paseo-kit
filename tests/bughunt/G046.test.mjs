// G046 (2026-10-23 bug hunt): concurrent research runs of one phase and concurrent revision records must not drop
// each other's work. A research run holds a per-phase lock; revisions.json is read, merged and written under its lock.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";
import { P1, project } from "../gsd-core/fixture.mjs";

const lib = (f) => pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib", f)).href;
const { lock, unlock, lockCheck } = await import(lib("flow-files.mjs"));
const PH = path.join(SHIP_DIR, ".agents", "harness", "ph.mjs");

const REPORT = `${PHASE_DIR}/01-RESEARCH.md`;
// research status reads the report frontmatter the way GSDC-32 does (simplified), as research-verify.test.mjs does.
function researchWorld() {
  const w = makeWorld({ research: false });
  w.gsd.on("research prompt", () => ({ prompt: "<upstream research dispatch>", path: REPORT }));
  w.gsd.on("research status", () => {
    const t = w.read(REPORT);
    if (!t) return { code: 66, json: { status: "missing" } };
    const f = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(t)?.[1] ?? null;
    const digest = w.gsd.handlers["revisions hash"]([PHASE_DIR, "research"]).hash;
    const json = { status: f("status"), attempt_key: f("attempt_key"), input_digest: f("input_digest") };
    if (json.status === "blocked") return { code: 1, json: { ...json, blockers: ["needs owner"] } };
    if (json.input_digest !== digest) return { code: 1, json: { ...json, status: "stale" } };
    return { code: 0, json };
  });
  return w;
}
const writeReport = (w, prompt) => {
  const key = /attempt_key: ([^\s;]+)/.exec(prompt)[1];
  const digest = /input_digest: (\S+)/.exec(prompt)[1];
  w.write(REPORT, `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${key}\n---\nfindings\n<!-- gsd:research-complete ${key} -->\n`);
};
const research = (w, args, agent, runId) => runScript("gsd-research", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, ...args }, agent, ...(runId ? { runId } : {}) });

test("G046 a research run is refused while another run holds its phase lock; no attempt is recorded and no agent runs", async () => {
  const w = researchWorld();
  const held = lock(w.root, "research-01", "wf_other", process.pid, "gsd-research");
  assert.equal(held.locked, true);
  const refused = await research(w, {}, (p) => { writeReport(w, p); return { status: "complete" }; }, "wf_b");
  assert.deepEqual([refused.result.status, refused.calls.length, w.attempts.research], ["refused", 0, undefined]);
  assert.equal(w.read(REPORT), "", "the held phase's report is not written");
  unlock(w.root, "research-01", held.token);
  const after = await research(w, {}, (p) => { writeReport(w, p); return { status: "complete" }; }, "wf_c");
  assert.equal(after.result.status, "researched", JSON.stringify(after.result));
});

test("G046 the research lock is released on every exit path: a failed or accepted run leaves the phase free", async () => {
  const w = researchWorld();
  const failed = await research(w, {}, () => ({ status: "complete" }), "wf_a");
  assert.equal(failed.result.status, "failed");
  assert.equal(lockCheck(w.root, "research-01").held, false);
  const done = await research(w, {}, (p) => { writeReport(w, p); return { status: "complete" }; }, "wf_b");
  assert.equal(done.result.status, "researched");
  assert.equal(lockCheck(w.root, "research-01").held, false);
  const view = await research(w, { view: true }, null, "wf_c");
  assert.equal(view.calls.length, 0, "a view never dispatches");
});

// Real processes started together: each `ph gsd revisions record` reads, merges and writes the phase's revisions.json.
function phAsync(root, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PH, ...args], { cwd: root, env: { ...testEnv(), PASEO_HARNESS_ROOT: root }, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

test("G046 revisions records of one phase started together keep every key", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions>- **D-01:** keep it small</decisions>\n", "src/a.js": "1" } });
  const keys = ["research", "inputs", "freeze", "plans", "checked", "handoff"];
  const runs = await Promise.all(keys.map((key) => phAsync(p.root, ["gsd", "revisions", "record", "1", key])));
  assert.deepEqual(runs.map((r) => r.code), keys.map(() => 0));
  assert.deepEqual(Object.keys(p.readJson(`${P1}/revisions.json`).keys).sort(), [...keys].sort());
});
