// Kit feedback 93 and the 99 addendum: the hand-edit scan does not list what the flow itself made (a fixer's edit the wave commit
// holds, a generator output, an outline revision a newer record or a stopped run of the phase wrote), and its first scan of a log
// the previous kit wrote drops the open entries the flow made.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { testEnv } from "../helpers/env.mjs";
import { sha256 } from "../../ship/.agents/harness/lib/hash.mjs";

const PLAN1 = `${P1}/01-01-PLAN.md`;
const PLAN2 = `${P1}/01-02-PLAN.md`;
const OUTLINE = `${P1}/01-PLAN-OUTLINE.md`;
const scan = (p) => gsd(p, ["hand-edit", "scan", "1"]);
const rec = (p, key, env) => gsd(p, ["revisions", "record", "1", key, "--settings", "S"], env ? { env } : {});
const flowEnv = () => testEnv({ PASEO_HARNESS_WORKFLOW_RUN: "wf_flow" });
const shaOf = (text) => sha256(Buffer.from(text));
const transfer = (p, id, files) => p.writeJson(`${P1}/transfers/${id}.json`, { plan: id, files: Object.entries(files).map(([path, text]) => ({ path, sha256: shaOf(text) })) });
const commit = (p, subject, ...files) => {
  p.git("add", "--", ...files);
  p.git("commit", "-q", "-m", subject);
  return p.git("rev-parse", "HEAD");
};
// Record times of the revisions keys, so which record is newer does not depend on the clock's second.
const setAt = (p, times) => {
  const r = p.readJson(`${P1}/revisions.json`);
  for (const [k, at] of Object.entries(times)) r.keys[k].at = at;
  p.writeJson(`${P1}/revisions.json`, r);
};
const files = (r) => r.json.pending.map((e) => e.files[0]).sort();
const iso = (ms) => new Date(ms).toISOString();
const touch = (p, rel, ms) => fs.utimesSync(p.path(rel), new Date(ms), new Date(ms));
const run = (p, id, phaseDir, start, end) => {
  p.writeJson(`_workspace/_runs/${id}/args.json`, { phaseDir });
  p.writeJson(`_workspace/_runs/${id}/run.json`, { runId: id, status: end === null ? "running" : "needs-owner", startedAt: iso(start), ...(end === null ? {} : { endedAt: iso(end) }) });
};
const twoPlans = (extra = {}) => project({ files: { [PLAN1]: plan({ id: "01" }), [PLAN2]: plan({ id: "02", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }), [OUTLINE]: "# outline\n", "src/a.js": "a1\n", "src/b.js": "b1\n", ...extra.files }, overlay: extra.overlay });

test("V3 the first scan of a log the previous kit wrote drops the open entries the flow made and keeps the orchestrator's", async () => {
  const p = twoPlans();
  transfer(p, "01-01", { "src/a.js": "a1\n" });
  transfer(p, "01-02", { "src/b.js": "b1\n", "src/c.js": "c1\n" });
  // The gate fixer answered a request in src/a.js; the wave commit holds it. src/b.js was fixed by the orchestrator in a
  // commit with a Plans trailer, which the resume gate reconciled. src/c.js was edited by hand before the wave commit took it in.
  p.write("src/a.js", "a2 by the gate fixer\n");
  p.write("src/c.js", "c2 by hand\n");
  const wave = commit(p, "feat(01-w1): wave 1\n\nPlans: 01-01,01-02", "src/a.js", "src/c.js");
  p.write("src/b.js", "b2 by hand\n");
  const hand = commit(p, "chore(01): fix b\n\nPlans: 01-02", "src/b.js");
  p.writeJson(`${P1}/commits.json`, [{ sha: wave, phase: "01", wave: 1, plans: { "01-01": ["src/a.js"], "01-02": ["src/c.js"] } }, { sha: hand, phase: "01", wave: null, plans: { "01-02": ["src/b.js"] }, reconciled: true }]);
  // A plan key recorded before an outline revision, and the flow's newer freeze record of the revised outline.
  await rec(p, "plan:01-01");
  p.write(OUTLINE, "# outline\nrevised by the outline reviser\n");
  await rec(p, "freeze", flowEnv());
  setAt(p, { "plan:01-01": "2026-10-23T10:00:00Z", freeze: "2026-10-23T11:00:00Z" });
  const outlineDigest = p.readJson(`${P1}/revisions.json`).keys.freeze.parts[OUTLINE];
  // The previous kit's scan logged them after the commits, but src/c.js before the wave commit took it in.
  const later = iso(Date.now() + 5000);
  const entry = (id, key, kind, file, digest, extra = {}) => ({ id, key, kind, files: [file], digest, at: later, category: null, note: null, ...extra });
  p.writeJson(`${P1}/hand-edits.json`, { v: 1, edits: [
    entry("HE-1", "owned:01-01", "owned", "src/a.js", shaOf("a2 by the gate fixer\n")),
    entry("HE-2", "owned:01-02", "owned", "src/b.js", shaOf("b2 by hand\n")),
    entry("HE-3", "plan:01-01", "artifact", OUTLINE, outlineDigest),
    entry("HE-4", "freeze", "artifact", OUTLINE, "an older digest", { category: "other", note: "answered before the update", loggedAt: "2026-10-23T12:30:00Z" }),
    entry("HE-5", "owned:01-02", "owned", "src/c.js", shaOf("c2 by hand\n"), { at: "2026-10-23T09:00:00Z" }),
  ] });
  const first = await scan(p);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.deepEqual(first.json.dropped, ["HE-1", "HE-3"]);
  assert.deepEqual(first.json.pending.map((e) => e.id), ["HE-2", "HE-5"], "the orchestrator's reconciled commit and an edit a later flow commit took in are hand edits");
  assert.equal(first.json.new, 0);
  const log = p.readJson(`${P1}/hand-edits.json`);
  assert.equal(log.v, 2);
  assert.deepEqual(log.edits.map((e) => [e.id, e.category]), [["HE-2", null], ["HE-4", "other"], ["HE-5", null]], "an answered entry stays");
  assert.deepEqual(log.dropped.map((d) => [d.id, d.files[0], d.by]), [["HE-1", "src/a.js", `commit ${wave.slice(0, 7)}`], ["HE-3", OUTLINE, "record freeze"]]);
  const second = await scan(p);
  assert.equal(second.json.dropped, undefined, "the migration runs once");
  assert.deepEqual(second.json.pending.map((e) => e.id), ["HE-2", "HE-5"]);
  // A hand edit after the wave commit is listed, under an id no dropped entry had.
  p.write("src/a.js", "a3 by hand\n");
  const third = await scan(p);
  assert.equal(third.json.new, 1);
  assert.deepEqual(third.json.pending.map((e) => [e.id, e.files[0]]), [["HE-2", "src/b.js"], ["HE-5", "src/c.js"], ["HE-6", "src/a.js"]]);
});

test("V3 a fixer's edit the wave commit holds and a generator output are no hand edits; a later hand edit is", async () => {
  const p = twoPlans({ files: { "src/gen/strings.g.js": "g1\n" }, overlay: { adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [], regenerated: ["src/gen/**"] } } } });
  transfer(p, "01-01", { "src/a.js": "a1\n", "src/gen/strings.g.js": "g1\n" });
  p.write("src/a.js", "a2 by the request fixer\n");
  const wave = commit(p, "feat(01-w1): wave 1\n\nPlans: 01-01", "src/a.js");
  p.writeJson(`${P1}/commits.json`, [{ sha: wave, phase: "01", wave: 1, plans: { "01-01": ["src/a.js"] } }]);
  p.write("src/gen/strings.g.js", "g2 regenerated\n");
  const first = await scan(p);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.deepEqual({ new: first.json.new, pending: first.json.pending }, { new: 0, pending: [] });
  assert.deepEqual(first.json.flowMade, [{ file: "src/a.js", by: `commit ${wave.slice(0, 7)}` }, { file: "src/gen/strings.g.js", by: "regenerated" }]);
  p.write("src/a.js", "a3 by hand\n");
  const second = await scan(p);
  assert.deepEqual(files(second), ["src/a.js"]);
  assert.equal(second.json.pending[0].id, "HE-1");
  // An owner commit recorded for the resume gate is not the flow's content either.
  const owner = commit(p, "fix(01): owner", "src/a.js");
  p.writeJson(`${P1}/commits.json`, [{ sha: wave, phase: "01", wave: 1, plans: { "01-01": ["src/a.js"] } }, { sha: owner, phase: "01", wave: null, plans: { "01-01": ["src/a.js"] }, by: "owner" }]);
  assert.deepEqual(files(await scan(p)), ["src/a.js"]);
});

test("V3 what a stopped run of the phase wrote is the flow's; an edit after it, or during another phase's run, is a hand edit", async () => {
  const p = twoPlans();
  await rec(p, "freeze");
  await rec(p, "plan:01-01");
  transfer(p, "01-01", { "src/a.js": "a1\n" });
  const t0 = Date.now() - 600000;
  // Run wf_a revised the outline and a fixer answered a request in src/a.js, then stopped before its record and commit.
  run(p, "wf_a", P1, t0, t0 + 20000);
  p.write(OUTLINE, "# outline\nrevised by wf_a\n");
  p.write("src/a.js", "a2 by the request fixer of wf_a\n");
  touch(p, OUTLINE, t0 + 5000);
  touch(p, "src/a.js", t0 + 10000);
  run(p, "wf_b", ".planning/phases/02-api", t0 + 30000, t0 + 50000);
  const first = await scan(p);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.deepEqual(first.json.pending, []);
  assert.deepEqual(first.json.flowMade.map((f) => [f.file, f.by]).sort(), [[OUTLINE, "run wf_a"], ["src/a.js", "run wf_a"]]);
  // A hand edit while only phase 2 runs.
  p.write("src/a.js", "a3 by hand\n");
  touch(p, "src/a.js", t0 + 40000);
  assert.deepEqual(files(await scan(p)), ["src/a.js"]);
  // A run whose runner died has no end: it ends at its journal's last write.
  run(p, "wf_c", `${P1}/`, t0 + 60000, null);
  p.write(`_workspace/_runs/wf_c/journal.jsonl`, "{}\n");
  touch(p, "_workspace/_runs/wf_c/journal.jsonl", t0 + 80000);
  touch(p, "_workspace/_runs/wf_c/run.json", t0 + 60000);
  p.write(PLAN1, `${plan({ id: "01" })}\nrevised by wf_c\n`);
  touch(p, PLAN1, t0 + 70000);
  const died = await scan(p);
  assert.deepEqual(files(died), ["src/a.js"]);
  assert.ok(died.json.flowMade.some((f) => f.file === PLAN1 && f.by === "run wf_c"), JSON.stringify(died.json.flowMade));
  p.write(PLAN1, `${plan({ id: "01" })}\nby hand after wf_c\n`);
  touch(p, PLAN1, t0 + 90000);
  assert.deepEqual(files(await scan(p)), [PLAN1, "src/a.js"]);
});

test("V3 a hand revisions record keeps a hand edit but not an outline revision a newer flow record holds", async () => {
  const p = twoPlans();
  await rec(p, "plan:01-01");
  await rec(p, "plan:01-02");
  p.write(OUTLINE, "# outline\nrevised by the flow\n");
  await rec(p, "freeze", flowEnv());
  setAt(p, { "plan:01-01": "2026-10-23T10:00:00Z", "plan:01-02": "2026-10-23T10:00:00Z", freeze: "2026-10-23T11:00:00Z" });
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  const r = await rec(p, "plan:01-01");
  assert.equal(r.code, 0);
  assert.deepEqual(p.readJson(`${P1}/hand-edits.json`).edits.map((e) => [e.id, e.files[0]]), [["HE-1", PLAN1]]);
  // The revised outline is the flow's even for the plan key that was never recorded on it; a hand revert of it is not.
  assert.deepEqual(files(await scan(p)), [PLAN1]);
  p.write(OUTLINE, "# outline\n");
  assert.deepEqual(files(await scan(p)), [PLAN1, OUTLINE]);
});
