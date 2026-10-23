// gsd-plan.js against the fake host and the file-backed fake ph gsd.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "./host.mjs";
import { makeWorld, PHASE_DIR, planText, plannerResponder } from "./world.mjs";

const plan = (w, args = {}, overrides = {}, rows) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides, ...(rows ? { rows } : {}) }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const editContext = (w, text) => w.write(`${PHASE_DIR}/01-CONTEXT.md`, `<decisions>\n- **D-01:** ${text}\n</decisions>\n`);

test("GSDF-01 owner markers become needs-owner, quota errors fail without retry, prompts carry paths not PLAN bodies", async () => {
  const w = makeWorld();
  const split = await plan(w, {}, { outline: () => ({ marker: "## PHASE SPLIT RECOMMENDED", question: "split into two?" }) });
  assert.equal(split.result.status, "needs-owner");
  assert.equal(split.result.stage, "Outline");
  assert.equal(split.result.question, "split into two?");
  assert.ok(split.result.options.length >= 2);
  const w2 = makeWorld();
  const quota = await plan(w2, {}, { "skeleton-L1": () => NULL("agent error: usage limit reached") });
  assert.equal(quota.result.status, "failed");
  assert.equal(quota.calls.filter((c) => c.opts.label === "skeleton-L1").length, 1);
  const ok = await plan(makeWorld());
  for (const c of ok.calls) assert.doesNotMatch(c.prompt, /<tasks>|<task>/);
});

test("GSDF-03 an input change changes the planner prompt digest; an unsafe phase dir is refused before any shell call", async () => {
  const w = makeWorld();
  const first = await plan(w);
  editContext(w, "changed");
  const second = await plan(w);
  const outlinePrompt = (r) => r.calls.find((c) => c.opts.label === "outline").prompt;
  assert.notEqual(outlinePrompt(first).match(/Input digest \(inputs\): (\S+)/)[1], outlinePrompt(second).match(/Input digest \(inputs\): (\S+)/)[1]);
  const bad = await runScript("gsd-plan", { root: w.root, args: { phaseDir: ".planning/phases/01-a&b" }, gsd: w.gsd });
  assert.equal(bad.result.status, "failed");
  assert.equal(bad.shells.length, 0);
});

test("GSDF-15 argument validation fails before any agent; defaults come from the gsd overlay", async () => {
  const w = makeWorld();
  for (const args of [{ maxCheckIterations: 4 }, { maxSkeletonPasses: 0 }, { skeletonLanes: [] }, { skeletonLanes: [{ lens: " " }] }, { wiring: "sometimes" }, { skeletonLanes: [{ lens: "nope" }] }]) {
    const r = await plan(w, args);
    assert.equal(r.result.status, "failed", JSON.stringify(args));
    assert.equal(r.calls.length, 0);
  }
  const w2 = makeWorld({ overlay: { gsd: { skeleton_lanes: [{ lens: "fidelity" }] } } });
  const r = await plan(w2);
  assert.deepEqual(labels(r).filter((l) => l.startsWith("skeleton-")), ["skeleton-L1"]);
});

test("GSDF-16 research preconditions: missing research and an empty skip reason stop, a skip with reason proceeds", async () => {
  const w = makeWorld({ research: false });
  const r1 = await plan(w);
  assert.deepEqual([r1.result.status, r1.result.stage], ["needs-owner", "Research"]);
  const r2 = await plan(w, { skipResearch: true, researchSkipReason: "" });
  assert.deepEqual([r2.result.status, r2.result.stage], ["needs-owner", "Research"]);
  const r3 = await plan(w, { skipResearch: true, researchSkipReason: "trivial phase" });
  assert.equal(r3.result.status, "planned");
  assert.ok(r3.logs.includes("log research skipped: trivial phase"));
  const w4 = makeWorld({ files: { [`${PHASE_DIR}/01-DISCUSS-CHECKPOINT.json`]: "{}" } });
  assert.deepEqual([(await plan(w4)).result.stage], ["Discuss"]);
});

test("GSDF-14 with skipResearch and an old report on disk every role prompt says Approved research: NONE", async () => {
  const w = makeWorld();
  const r = await plan(w, { skipResearch: true, researchSkipReason: "no unknowns" });
  assert.ok(r.calls.length >= 5);
  for (const c of r.calls) {
    assert.match(c.prompt, /<research_input_policy>\nApproved research: NONE\. Do not read or use any RESEARCH\.md on disk\./, c.opts.label);
  }
  const approved = await plan(makeWorld());
  assert.match(approved.calls[0].prompt, /Approved research: \.planning\/phases\/01-core\/01-RESEARCH\.md\. Read and use only this report\./);
});

test("GSDF-17 planner prompts carry planning_context, the specless block and the revision context", async () => {
  const w = makeWorld();
  let revised = null;
  w.probes.owns = { problems: [{ plan: "01-01", message: "owns overlaps" }] };
  const r = await plan(w, {}, { "revise-01-01": (p) => { revised = p; w.probes.owns = { problems: [] }; w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01") + "\n"); return { marker: "## REVISION COMPLETE" }; } });
  assert.equal(r.result.status, "planned");
  const planPrompt = r.calls.find((c) => c.opts.label === "plan-01-01").prompt;
  for (const s of ["<planning_context>", "Phase: 01 (Core)", "- .planning/STATE.md", "- .planning/phases/01-core/01-CONTEXT.md (user decisions: locked, do not revisit)", "Phase requirement IDs: R-1", "TRACER_MODE: true", "REVERSIBILITY_GATES: true", "MVP_MODE: false", "WALKING_SKELETON: false", "Granularity: standard", "<specless_edges>", "must_haves.prohibitions"]) assert.ok(planPrompt.includes(s), s);
  for (const s of ["<revision_context>", "Existing plans: .planning/phases/01-core/01-01-PLAN.md", "Checker issues (JSON):", "REVISION_CONFLICT"]) assert.ok(revised.includes(s), s);
});

test("GSDF-18 outline and plan calls resolve their own roles and sessions; the engine, not the script, records the role table", async () => {
  const w = makeWorld();
  const r = await plan(w, { roles: { outline: { model: "p/outline-model" }, planner: { model: "p/plan-model", effort: "high" } } });
  const outline = r.calls.find((c) => c.opts.label === "outline");
  const p1 = r.calls.find((c) => c.opts.label === "plan-01-01");
  assert.deepEqual([outline.opts.role, outline.opts.model, outline.opts.session], ["outline", "p/outline-model", "planner:outline"]);
  assert.deepEqual([p1.opts.role, p1.opts.model, p1.opts.effort, p1.opts.session], ["planner", "p/plan-model", "high", "planner:01-01"]);
  assert.equal(r.result.roles, undefined);
  const lane = r.calls.find((c) => c.opts.label === "skeleton-L1");
  assert.deepEqual([lane.opts.role, lane.opts.readOnly, lane.opts.agentType], ["skeleton_lane", true, "gsd-skeleton-reviewer"]);
});

test("GSDF-19 a regeneration that returns nothing after an input change fails; failing fix turns fail with the errors", async () => {
  const w = makeWorld();
  assert.equal((await plan(w)).result.status, "planned");
  editContext(w, "new input");
  const r = await plan(w, {}, { outline: () => NULL("finished without a reply") });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /regeneration returned nothing/);
  const w2 = makeWorld();
  w2.outlineErrors = [["row 2: empty objective"], ["row 2: empty objective"], ["row 2: empty objective"]];
  const f = await plan(w2);
  assert.equal(f.result.status, "failed");
  assert.deepEqual(f.result.errors, ["row 2: empty objective"]);
  assert.equal(labels(f).filter((l) => l === "outline-fix").length, 2);
});

test("GSDF-20 the wiring stage runs only with an adapter architect and a consumes edge", async () => {
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "Api" }] }];
  const archAgent = { ".agents/agents/arch.md": "---\nname: arch\n---\nbody\n" };
  const w = makeWorld({ files: archAgent, overlay: { adapter: { agents: { architect: "arch" } } } });
  const r = await plan(w, {}, { architect: () => { w.write(`${PHASE_DIR}/01-WIRING.md`, "Api: 01-01 -> 01-02\n"); return { status: "complete", sharedChanges: [{ path: "x" }], outlineChanges: [] }; } }, rows);
  assert.equal(r.result.status, "planned");
  assert.equal(labels(r).filter((l) => l === "architect").length, 1);
  assert.deepEqual(r.result.sharedChanges, [{ path: "x" }]);
  const noEdge = await plan(makeWorld({ files: archAgent, overlay: { adapter: { agents: { architect: "arch" } } } }));
  assert.equal(labels(noEdge).includes("architect"), false);
  const noArch = await plan(makeWorld(), {}, {}, rows);
  assert.ok(noArch.logs.includes("log wiring: no architect agent"));
  const w3 = makeWorld({ files: archAgent, overlay: { adapter: { agents: { architect: "arch" } } } });
  const conflict = await plan(w3, {}, { architect: () => ({ status: "conflict", conflicts: ["two owners"] }) }, rows);
  assert.deepEqual([conflict.result.status, conflict.result.stage], ["needs-owner", "Wiring"]);
});

test("GSDF-21 a lane returning nothing twice fails the gate; info-only issues pass as advisories", async () => {
  const r = await plan(makeWorld(), {}, { "skeleton-L2": () => NULL("finished without a reply") });
  assert.equal(r.result.status, "failed");
  assert.equal(labels(r).filter((l) => l === "skeleton-L2").length, 2);
  const info = await plan(makeWorld(), {}, { "skeleton-L1": () => ({ issues: [{ severity: "info", description: "nit" }] }) });
  assert.equal(info.result.status, "planned");
  assert.deepEqual(info.result.advisories.map((x) => x.description), ["nit"]);
});

// Pass 1 opens three issues in lane L1; each resolution check resolves the ids listed for that pass.
function scripted(resolvePerPass, severity = "blocker") {
  let pass = 0;
  return {
    "skeleton-L1": () => ({ issues: [1, 2, 3].map((i) => ({ plan: "01-01", severity: i === 3 ? severity : "blocker", description: `issue ${i}`, target: "outline" })) }),
    "resolve-L1": () => ({ resolved: (resolvePerPass[pass++] ?? []).map((id) => ({ id, evidence: "fixed" })) }),
  };
}

test("GSDF-22 skeleton passes: a remaining blocker ends needs-owner, a remaining warning passes and is carried, 3-2-2 stalls", async () => {
  const blocker = await plan(makeWorld(), {}, scripted([["L1-1"], ["L1-2"]]));
  assert.deepEqual([blocker.result.status, blocker.result.stage], ["needs-owner", "Skeleton review"]);
  assert.match(blocker.result.reason, /1 open blockers after 3 passes/);
  const warn = await plan(makeWorld(), {}, scripted([["L1-1"], ["L1-2"]], "warning"));
  assert.equal(warn.result.status, "planned");
  assert.ok(warn.result.warnings.some((x) => x.includes("issue 3")));
  assert.match(warn.calls.find((c) => c.opts.label === "plan-01-01").prompt, /Open skeleton warnings for this plan:\n- skeleton L1-3 \(01-01\): issue 3/);
  const stall = await plan(makeWorld(), {}, scripted([["L1-1"], []]));
  assert.match(stall.result.reason, /stalled: 2 open blockers at pass 3 \(was 2\)/);
});

test("GSDF-22 a revision adding the first consumes edge without an architect becomes an integration-lane blocker", async () => {
  const w = makeWorld();
  let revised = false;
  const r = await plan(w, {}, {
    "skeleton-L1": () => (revised ? { issues: [] } : { issues: [{ plan: "01-02", severity: "blocker", description: "needs the api", target: "outline" }] }),
    "outline-revise": () => {
      revised = true;
      w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.manifest.json`, JSON.stringify({ phase: "1", plans: [{ id: "01-01", owns: ["Path:src/01-01/"] }, { id: "01-02", owns: ["Path:src/01-02/"], consumes: [{ plan: "01-01", symbol: "Api" }] }] }));
      return { marker: "## REVISION COMPLETE" };
    },
    "resolve-L1": () => ({ resolved: [{ id: "L1-1", evidence: "ok" }] }),
    "resolve-L2": () => ({ resolved: [] }),
  });
  assert.equal(r.result.status, "needs-owner");
  assert.ok(r.result.issues.some((i) => i.lane === "L2" && /new cross-plan edge/.test(i.description)));
  assert.equal(r.gsd.callsOf("revisions record").some((c) => c.argv.includes("freeze")), false);
});

test("GSDF-23 OUTLINE-REVIEW is written in every outcome; an unchanged rerun spawns no reviewer", async () => {
  const w = makeWorld();
  assert.equal((await plan(w)).result.status, "planned");
  assert.match(w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /Status: passed[\s\S]*## Lanes[\s\S]*## Passes[\s\S]*## Open[\s\S]*## Resolved[\s\S]*## Advisories[\s\S]*```json/);
  const again = await plan(w);
  assert.ok(again.logs.includes("log skeleton unchanged since its review passed"));
  assert.equal(labels(again).some((l) => l.startsWith("skeleton-")), false);
  const w2 = makeWorld();
  await plan(w2, {}, scripted([["L1-1"], ["L1-2"]]));
  assert.match(w2.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /Status: needs-owner/);
});

test("GSDF-24 a rerun after a crash in wave 2 keeps the wave-1 plan and plans only wave 2; an outline edit replans all", async () => {
  const w = makeWorld();
  const crash = await plan(w, {}, { "plan-01-02": () => NULL("agent error: rate limit") });
  assert.equal(crash.result.status, "failed");
  const rerun = await plan(w);
  assert.equal(rerun.result.status, "planned");
  assert.deepEqual(labels(rerun).filter((l) => l.startsWith("plan-")), ["plan-01-02"]);
  assert.ok(rerun.logs.includes("log plan 01-01 kept: unchanged since recorded"));
  const order = labels(crash);
  assert.ok(order.indexOf("plan-01-01") < order.indexOf("plan-01-02"));
  w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.md`, w.read(`${PHASE_DIR}/01-PLAN-OUTLINE.md`).replace("do it", "do it better"));
  const edited = await plan(w);
  assert.deepEqual(labels(edited).filter((l) => l.startsWith("plan-")), ["plan-01-01", "plan-01-02"]);
});

test("GSDF-25 the structure fixer gets the exact error list once; a second failure fails the run", async () => {
  const w = makeWorld();
  w.structureErrors = { [`${PHASE_DIR}/01-01-PLAN.md`]: [["missing frontmatter field must_haves"], ["missing frontmatter field must_haves"]] };
  const r = await plan(w);
  const fix = r.calls.find((c) => c.opts.label === "fix-01-01");
  assert.match(fix.prompt, /- missing frontmatter field must_haves/);
  assert.equal(fix.opts.session, "planner:01-01");
  assert.equal(r.result.status, "failed");
});

test("GSDF-26 checker: 5 issues twice stall, info-only passes with advisories, a probe blocker counts without checker issues", async () => {
  const five = { issues: Array.from({ length: 5 }, (_, i) => ({ plan: "01-01", severity: "blocker", required_property: `c${i} holds`, description: `c${i}` })) };
  const stalled = await plan(makeWorld(), {}, { "checker-": () => five });
  assert.deepEqual([stalled.result.stage, /stalled: 5 issues/.test(stalled.result.reason)], ["Checker", true]);
  assert.deepEqual(stalled.result.options, ["force proceed (rerun with forceProceed {reason})", "give guidance and retry", "abandon"]);
  const info = await plan(makeWorld(), {}, { "checker-": () => ({ issues: [{ severity: "info", required_property: "a holds", description: "a" }, { severity: "info", required_property: "b holds", description: "b" }] }) });
  assert.equal(info.result.status, "planned");
  assert.equal(info.result.advisories.length, 2);
  const w = makeWorld();
  w.probes.vcp = { probes: [{ plan: "01-01", severity: "blocker", detail: "MISSING target" }] };
  const probe = await plan(w, { maxCheckIterations: 1 });
  assert.equal(probe.result.status, "needs-owner");
  assert.match(probe.result.reason, /checker cap 1 reached with 1 issues/);
  const unk = makeWorld();
  unk.probes.owns = { code: 69, json: { status: "unavailable", reason: "no adapter" } };
  // G004: a warning-only probe no longer stops the phase; it is carried into the result.
  const warnOnly = await plan(unk, { maxCheckIterations: 1 });
  assert.equal(warnOnly.result.status, "planned");
  assert.ok(warnOnly.result.warnings.some((x) => x.includes("owns could not look")));
});

test("GSDF-27 REVISION_CONFLICT in the checker loop stops at once with the conflict", async () => {
  const r = await plan(makeWorld(), {}, {
    "checker-": () => ({ issues: [{ plan: "01-01", severity: "blocker", required_property: "x holds", description: "x" }] }),
    "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { issue: "x", decision: "D-01" } }),
  });
  assert.deepEqual([r.result.status, r.result.marker], ["needs-owner", "REVISION_CONFLICT"]);
  assert.deepEqual(r.result.conflict, { issue: "x", decision: "D-01" });
  assert.equal(labels(r).filter((l) => l.startsWith("revise-")).length, 1);
});

test("GSDF-28 forceProceed at the cap records the override in the result and STATE; a conflict is never forced", async () => {
  const w = makeWorld();
  const issue = () => ({ issues: [{ plan: "01-01", severity: "blocker", description: "still open" }] });
  const r = await plan(w, { forceProceed: { reason: "owner accepts" }, maxCheckIterations: 1 }, { "checker-": issue });
  assert.equal(r.result.status, "planned");
  assert.equal(r.result.override.reason, "owner accepts");
  assert.equal(r.result.override.remaining[0].description, "still open");
  assert.ok(w.events.some((e) => e.startsWith("state override") && e.includes("still open")));
  const c = await plan(makeWorld(), { forceProceed: { reason: "go" } }, { "checker-": issue, "revise-01-01": () => ({ marker: "REVISION_CONFLICT" }) });
  assert.equal(c.result.status, "needs-owner");
});

test("GSDF-29 a coverage failure offers three options; a passing set runs handoff", async () => {
  const w = makeWorld();
  w.coverage = { passed: false, decisions: { uncovered: ["D-02"] } };
  const r = await plan(w);
  assert.deepEqual([r.result.stage, r.result.options], ["Handoff", ["re-plan (recommended)", "move the requirement or decision to a later phase", "tag the decision informational"]]);
  assert.equal(w.events.some((e) => e.startsWith("handoff")), false);
  const ok = makeWorld();
  const p = await plan(ok);
  assert.ok(ok.events.includes("handoff"));
  assert.equal(p.result.planRevision, "rev1");
});

function gapWorld(extra = {}) {
  const done = {};
  for (const id of ["01-01", "01-02"]) { done[`${PHASE_DIR}/${id}-PLAN.md`] = planText(id); done[`${PHASE_DIR}/${id}-SUMMARY.md`] = "s\n"; }
  return makeWorld({ files: done, verification: { status: "gaps_found", sha: "ver1", gaps: [{ id: "G1" }, { id: "G2" }] }, ...extra });
}
const gapWriter = (w, { depends = false, stopAfterFirst = false } = {}) => ({
  gaps: () => {
    w.write(`${PHASE_DIR}/01-03-PLAN.md`, planText("01-03", { gap: true }));
    if (stopAfterFirst) return NULL("agent error: usage limit");
    w.write(`${PHASE_DIR}/01-04-PLAN.md`, planText("01-04", { gap: true, depends: depends ? ["01-03"] : [] }));
    return { marker: "## PLANNING COMPLETE" };
  },
});

test("GSDF-30 gap mode: one wave of independent gap plans, numbered after existing plans, handed off without tracer split", async () => {
  const w = gapWorld();
  const r = await plan(w, { mode: "gaps" }, gapWriter(w));
  assert.equal(r.result.status, "planned");
  assert.deepEqual(r.result.plans, ["01-03", "01-04"]);
  assert.match(r.calls[0].prompt, /numbered from 01-03, each with frontmatter gap_closure: true/);
  assert.equal(r.calls[0].opts.session, "planner:gaps");
  assert.ok(w.events.includes("handoff --plans 01-03,01-04 --prefix gap --no-tracer-split"));
  assert.equal(w.attempts.gap.done, true);
  assert.deepEqual(w.attempts.gap.result, { plans: ["01-03", "01-04"], waveExecuted: false });
});

test("GSDF-30 dependent gap plans, two handoff waves and an executed gap wave all return needs-owner before dispatch", async () => {
  const w = gapWorld();
  const dep = await plan(w, { mode: "gaps" }, gapWriter(w, { depends: true }));
  assert.deepEqual([dep.result.status, dep.result.stage], ["needs-owner", "Gaps"]);
  assert.equal(w.events.some((e) => e.startsWith("handoff")), false);
  const w2 = gapWorld();
  w2.handoff = { planRevision: "r", waves: [{ wave: 1 }, { wave: 2 }], sharedChanges: [] };
  const two = await plan(w2, { mode: "gaps" }, gapWriter(w2));
  assert.match(two.result.reason, /2 execution waves/);
  const w3 = gapWorld();
  w3.attempts.gap = { key: "k", runId: "wf_old", inputDigest: "ver1", done: true, result: { plans: ["01-03"], waveExecuted: true } };
  const capped = await plan(w3, { mode: "gaps" }, gapWriter(w3));
  assert.match(capped.result.reason, /capped at one wave/);
  assert.equal(capped.calls.length, 0);
  const notGaps = await plan(makeWorld({ verification: { status: "passed" } }), { mode: "gaps" });
  assert.equal(notGaps.result.status, "refused");
});

test("GSDF-30 a crash after 1 of 2 gap plans resumes the attempt and keeps the plan on disk", async () => {
  const w = gapWorld();
  const crash = await plan(w, { mode: "gaps" }, gapWriter(w, { stopAfterFirst: true }));
  assert.equal(crash.result.status, "failed");
  const key = w.attempts.gap.key;
  const resumed = await plan(w, { mode: "gaps" }, gapWriter(w));
  assert.equal(w.attempts.gap.key, key);
  assert.match(resumed.calls[0].prompt, /already written by this attempt \(keep them; write only the missing ones\): \.planning\/phases\/01-core\/01-03-PLAN\.md/);
  assert.equal(resumed.result.status, "planned");
});

test("GSDF-31 docs commits name the exact paths when commit_policy.docs is on and never otherwise", async () => {
  const on = makeWorld({ overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } });
  await plan(on);
  const commits = on.events.filter((e) => e.startsWith("commit"));
  assert.equal(commits.length, 2);
  assert.match(commits[0], /^commit docs\(01\): phase 01 outline and skeleton review --files \.planning\/phases\/01-core\/01-PLAN-OUTLINE\.md \.planning\/phases\/01-core\/01-PLAN-OUTLINE\.manifest\.json \.planning\/phases\/01-core\/01-OUTLINE-REVIEW\.md$/);
  assert.match(commits[1], /01-01-PLAN\.md .*01-02-PLAN\.md$/);
  const off = makeWorld();
  await plan(off);
  assert.equal(off.events.some((e) => e.startsWith("commit")), false);
});

test("GSDF-32 a rerun after a crash past the skeleton review spawns no outline or reviewer agent", async () => {
  const w = makeWorld();
  await plan(w, {}, { "plan-01-01": () => NULL("agent error: 429 too many requests") });
  const rerun = await plan(w);
  assert.equal(labels(rerun).some((l) => l === "outline" || l.startsWith("skeleton-")), false);
  const third = await plan(w);
  assert.deepEqual(labels(third), []);
  assert.ok(third.logs.includes("log checker skipped: plans unchanged since the last passing check"));
});

test("GSDF-33 a COMPLETE phase is refused without force and spawns nothing; force warns and replans", async () => {
  const w = makeWorld({ status: "COMPLETE" });
  const r = await plan(w);
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /01-VERIFICATION\.md/);
  assert.equal(r.calls.length, 0);
  const forced = await plan(w, { force: true });
  assert.equal(forced.result.status, "planned");
  assert.ok(forced.logs.some((l) => /warning: =+ replanning COMPLETE phase/.test(l)));
});

test("GSDF-34 an unrecognised reply with a plan on disk goes to the structure check; with no plan it is inconclusive", async () => {
  const w = makeWorld();
  const garbage = await plan(w, {}, { "plan-01-01": () => { w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01")); return { marker: "whatever" }; } });
  assert.equal(garbage.result.status, "planned");
  assert.ok(garbage.logs.includes("log planner 01-01: no recognised marker; the structure check decides"));
  const none = await plan(makeWorld(), {}, { "plan-01-01": () => ({ marker: "hmm" }) });
  assert.deepEqual([none.result.status, none.result.stage], ["needs-owner", "Plan"]);
  assert.match(none.result.reason, /inconclusive/);
});

test("GSDF-36 a planned result updates STATE and annotates ROADMAP dependencies", async () => {
  const w = makeWorld();
  await plan(w);
  assert.ok(w.events.includes("state planned-phase --phase 01 --plans 2"));
  assert.ok(w.events.includes("annotate"));
  assert.ok(w.events.indexOf("record handoff") < w.events.indexOf("annotate"));
});

test("GSDF-37 planReview runs the nested plan-review workflow; non-dropping counts end needs-owner", async () => {
  const w = makeWorld();
  const high = () => ({ issues: [{ severity: "high", actionable: true, description: "cites a missing symbol" }] });
  const r = await plan(w, { planReview: true }, {
    "find-": high,
    "verify-": (p, o, n, calls) => ({ verdicts: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], valid: true })) }),
    "judge-": (p) => ({ decisions: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], keep: true })) }),
    "editor-": () => ({ marker: "REVISION COMPLETE" }),
  });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan review"]);
  assert.match(r.result.reason, /not converging/);
  assert.equal(labels(r).filter((l) => l.startsWith("editor-")).length, 1);
  assert.ok(labels(r).some((l) => l === "find-01-01-source-grounding"));
});

test("GSDF-37 a converging plan review regenerates the handoff with a new planRevision", async () => {
  const w = makeWorld();
  let cycle = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] },
    agent: (p, o) => {
      if (o.label.startsWith("find-")) return { issues: cycle === 0 ? [{ severity: "high", description: "x" }] : [] };
      if (o.label.startsWith("verify-")) return { verdicts: [{ id: /"id":"([^"]+)"/.exec(p)[1], valid: true }] };
      if (o.label.startsWith("judge-")) return { decisions: [{ id: /"id":"([^"]+)"/.exec(p)[1], keep: true }] };
      if (o.label.startsWith("editor-")) { cycle++; w.handoff = { planRevision: "rev2", waves: [{ wave: 1 }] }; w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01")); return { marker: "REVISION COMPLETE" }; }
      return null;
    },
  });
  assert.deepEqual([r.result.status, r.result.planRevision, r.result.cycles], ["converged", "rev2", 2]);
  assert.match(r.calls.find((c) => c.opts.label === "find-01-01-source-grounding").prompt, /source-grounding\.md/);
});
