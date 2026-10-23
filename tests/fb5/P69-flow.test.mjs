// Kit feedback #69, #71, #76 (P69): gsd-plan's checker stage on the fake host. Reallocation (gsd.checker_reallocate), forceProceed with
// issues, and the incremental recheck (gsd.checker_recheck).
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, outlineText, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}, rows) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides, ...(rows ? { rows } : {}) }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const planFile = (id) => `${PHASE_DIR}/${id}-PLAN.md`;
const stateRecords = (w) => w.events.filter((e) => e.startsWith("state override ")).map((e) => JSON.parse(e.slice("state override ".length)));

// ---- forceProceed with issues (item 71) ----

const SCOPE = { plan: "01-01", dimension: "scope_sanity", severity: "blocker", required_property: "size", description: "too many files" };
const CONTRACT = { plan: "01-02", dimension: "contract", severity: "blocker", required_property: "back works", description: "isDismissible vetoes back" };
// The checker raises both issues until 01-02 was revised; then it repeats the scope issue and confirms the contract one resolved.
const twoIssues = (state) => ({
  "checker-": () => (state.fixed ? { issues: [SCOPE], resolved: [{ id: "open-1", evidence: "fixed" }] } : { issues: [SCOPE, CONTRACT] }),
  "revise-01-02": () => { state.fixed = true; return { marker: "## REVISION COMPLETE" }; },
  "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { why: "owns are frozen" } }),
});

test("P69 forceProceed {reason, issues} accepts only the named issue: the other is revised, the accepted one is never sent to a reviser", async () => {
  const args = { maxCheckIterations: 3, forceProceed: { reason: "size is structural", issues: [{ plan: "01-01", dimension: "scope_sanity" }] } };
  const control = await plan(makeWorld(), { maxCheckIterations: 3 }, twoIssues({}));
  assert.equal(control.result.status, "needs-owner", "without forceProceed the scope issue is revised and conflicts");
  assert.match(control.result.reason, /REVISION_CONFLICT/);

  const w = makeWorld();
  const first = await plan(w, args, twoIssues({}));
  assert.match(first.result.reason, /^forceProceed refused: 01-01 written by a planner in this run/);
  assert.equal(stateRecords(w).length, 0);
  const r = await plan(w, args, twoIssues({}));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(labels(r).includes("revise-01-02-1"), "the contract issue is still revised");
  assert.ok(!labels(r).some((l) => l.startsWith("revise-01-01")), "the accepted issue is not");
  assert.equal(r.result.override.mode, "issues");
  assert.deepEqual(r.result.override.accepted, [{ plan: "01-01", dimension: "scope_sanity", description: "too many files" }]);
  assert.deepEqual(r.result.override.remaining, []);
  const [saved] = stateRecords(w);
  assert.equal(saved.reason, "size is structural");
  assert.deepEqual(saved.issues, ["01-01 [scope_sanity]: too many files"]);
});

test("P69 forceProceed {reason, issues}: a stuck issue the owner did not name stops the run and the stop lists both", async () => {
  const w = makeWorld();
  const r = await plan(w, { maxCheckIterations: 1, forceProceed: { reason: "size is structural", issues: [{ plan: "01-01", dimension: "scope_sanity" }] } }, { "checker-": () => ({ issues: [SCOPE, CONTRACT] }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Checker");
  assert.match(r.result.reason, /^01-02: checker cap 1 reached/);
  assert.deepEqual(r.result.issues.map((i) => i.plan), ["01-02"]);
  assert.deepEqual(r.result.accepted, [{ plan: "01-01", dimension: "scope_sanity", description: "too many files" }]);
  assert.equal(stateRecords(w).length, 0, "nothing is written to STATE while the run stops");
  // The same dimension on another plan is not covered by the entry.
  const other = await plan(makeWorld(), { maxCheckIterations: 1, forceProceed: { reason: "r", issues: [{ plan: "01-02", dimension: "scope_sanity" }] } }, { "checker-": () => ({ issues: [SCOPE] }) });
  assert.equal(other.result.status, "needs-owner");
  assert.deepEqual(other.result.issues.map((i) => i.plan), ["01-01"]);
});

test("P69 forceProceed {reason, issues} names a probe by its dimension: an owns probe blocker is accepted, not revised", async () => {
  const w = makeWorld();
  w.probes.owns = { problems: [{ plan: "01-01", message: "owns overlaps 01-02" }] };
  const args = { forceProceed: { reason: "the overlap is a generated folder", issues: [{ plan: "01-01", dimension: "owns" }] } };
  const first = await plan(w, args);
  assert.match(first.result.reason, /^forceProceed refused: 01-01/);
  const r = await plan(w, args);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(!labels(r).some((l) => l.startsWith("revise-")));
  assert.deepEqual(r.result.override.accepted, [{ plan: "01-01", dimension: "owns", description: "owns overlaps 01-02" }]);
  assert.deepEqual(stateRecords(w)[0].issues, ["01-01 [owns]: owns overlaps 01-02"]);
});

test("P69 forceProceed {reason, issues}: an entry that matched nothing is reported as unused", async () => {
  const w = makeWorld();
  const args = { forceProceed: { reason: "r", issues: [{ plan: "01-01", dimension: "scope_sanity" }, { plan: null, dimension: "coverage" }] } };
  const checker = { "checker-": () => ({ issues: [SCOPE] }) };
  await plan(w, args, checker);
  const r = await plan(w, args, checker);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(r.result.override.unused, [{ plan: null, dimension: "coverage" }]);
});

test("P69 forceProceed {reason} alone keeps accepting every stuck issue, now per issue in STATE with a warning", async () => {
  const w = makeWorld();
  const checker = { "checker-": () => ({ issues: [SCOPE, CONTRACT] }) };
  const args = { maxCheckIterations: 1, forceProceed: { reason: "owner accepts all" } };
  await plan(w, args, checker);
  const r = await plan(w, args, checker);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(r.result.override.mode, "all");
  assert.deepEqual(r.result.override.accepted.map((x) => [x.plan, x.dimension]), [["01-01", "scope_sanity"], ["01-02", "contract"]]);
  assert.deepEqual(stateRecords(w)[0].issues, ["01-01 [scope_sanity]: too many files", "01-02 [contract]: isDismissible vetoes back"]);
  assert.ok(r.result.warnings.some((x) => /forceProceed without issues accepted every issue still stuck/.test(x)), r.result.warnings.join("\n"));
});

test("P69 forceProceed.issues is validated before any agent runs", async () => {
  for (const issues of [[], {}, [{ plan: "01-01" }], [{ dimension: "x" }], [{ plan: 1, dimension: "x" }], [{ plan: "01-01", dimension: " " }], [null]]) {
    const r = await plan(makeWorld(), { forceProceed: { reason: "r", issues } });
    assert.equal(r.result.status, "failed", JSON.stringify(issues));
    assert.match(r.result.reason, /forceProceed\.issues needs a non-empty list/);
    assert.equal(r.calls.length, 0);
  }
  const ok = await plan(makeWorld(), { forceProceed: { reason: "r", issues: [{ plan: null, dimension: "coverage" }] } });
  assert.equal(ok.result.status, "planned");
});

// ---- reallocation (item 69) ----

const MANIFEST = (id, dir) => ({ id, owns: [`Path:src/${dir}/`], requirements: ["R-1"], consumes: [] });
const SPLIT_ROWS = [{ id: "01-01", wave: 1 }, { id: "01-03", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
// The fake `ph gsd` reports 01-01 over the blocker line while `state.big` holds it; plan records depend on the outline like the real
// `plan:<id>` key (the freeze files are part of it), so an outline change makes every plan record stale.
function reallocWorld(rounds, state = { big: new Set(["01-01"]) }, gsdPart = {}) {
  const w = makeWorld({ overlay: { gsd: { checker_reallocate: rounds, ...gsdPart } } });
  const recs = new Map();
  const planKey = (args) => {
    const id = args[1].slice(5);
    const settings = args.includes("--settings") ? args[args.indexOf("--settings") + 1] : "";
    return `${settings}|${w.read(`${PHASE_DIR}/01-PLAN-OUTLINE.md`)}|${w.read(`${PHASE_DIR}/01-PLAN-OUTLINE.manifest.json`)}|${w.read(planFile(id))}`;
  };
  const baseCheck = w.gsd.handlers["revisions check"];
  const baseRecord = w.gsd.handlers["revisions record"];
  w.gsd.on("revisions check", (args, input, argv) => (args[1].startsWith("plan:")
    ? (!recs.has(args[1]) ? { code: 66, json: { status: "never" } } : recs.get(args[1]) === planKey(args) ? { code: 0, json: { same: true } } : { code: 1, json: { same: false } })
    : baseCheck(args, input, argv)));
  w.gsd.on("revisions record", (args, input, argv) => {
    if (!args[1].startsWith("plan:")) return baseRecord(args, input, argv);
    recs.set(args[1], planKey(args));
    return { recorded: args[1] };
  });
  const baseOutline = w.gsd.handlers["outline check"];
  w.gsd.on("outline check", (args, input, argv) => { const r = baseOutline(args, input, argv); return { code: r.code, json: { ...r.json, files_per_plan: { warning: 10, blocker: 15 } } }; });
  w.gsd.on("check owns", () => ({ problems: [], files_per_plan: { warning: 10, blocker: 15 }, plans: ["01-01", "01-02", "01-03"].filter((id) => w.read(planFile(id))).map((id) => ({ id, files_modified: Array.from({ length: state.big.has(id) ? 16 : 4 }, (_, i) => `src/${id}/f${i}.dart`), tracer: false })) }));
  w.state = state;
  return w;
}
// The outline writer's answer to a reallocation: 01-01 is split into 01-01 and 01-03.
const split = (state) => ({
  "reallocate-": (prompt, o) => {
    state.prompts = [...(state.prompts ?? []), prompt];
    const w = state.world;
    w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.md`, outlineText(SPLIT_ROWS));
    w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.manifest.json`, JSON.stringify({ phase: "1", plans: [MANIFEST("01-01", "01-01a"), MANIFEST("01-03", "01-01b"), MANIFEST("01-02", "01-02")] }));
    state.big = new Set();
    return { marker: "## OUTLINE COMPLETE" };
  },
});
const realloc = async (rounds, { overrides = {}, args = {}, state = { big: new Set(["01-01"]) }, gsdPart } = {}) => {
  const w = reallocWorld(rounds, state, gsdPart);
  state.world = w;
  const r = await plan(w, args, { ...split(state), ...overrides });
  return { w, r, state };
};

test("P69 gsd.checker_reallocate off (default): the probe does not exist, the checker gets the Files per plan lines and a big plan is no reason to go back", async () => {
  const { r } = await realloc(0, { state: { big: new Set(["01-01"]) } });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(!labels(r).includes("reallocate-1"));
  assert.equal(r.result.reallocated, undefined);
  const prompt = r.calls.find((c) => c.opts.label === "checker-1").prompt;
  assert.match(prompt, /Files per plan: warning at 10\+, blocker at 15\+/);
  assert.doesNotMatch(prompt, /reallocate/);
  assert.equal(r.calls.find((c) => c.opts.label === "checker-1").opts.schema.properties.issues.items.properties.outcome, undefined);
});

test("P69 a plan at the blocker line goes back to the outline before the checker agent is paid for; the others keep their records", async () => {
  const { r, w } = await realloc(1);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const l = labels(r);
  assert.equal(l.filter((x) => x === "reallocate-1").length, 1);
  assert.equal(l.filter((x) => x === "checker-1").length, 1, "the probe ended the first round before any checker call");
  assert.ok(l.indexOf("reallocate-1") < l.indexOf("checker-1"));
  assert.deepEqual([l.filter((x) => x === "plan-01-01").length, l.filter((x) => x === "plan-01-02").length, l.filter((x) => x === "plan-01-03").length], [2, 1, 1], "01-01 is written again, 01-03 is new, 01-02 is kept");
  assert.equal(r.result.reallocated.length, 1);
  const [one] = r.result.reallocated;
  assert.equal(one.round, 1);
  assert.deepEqual(one.plans, ["01-01"]);
  assert.deepEqual(one.changed, ["01-01", "01-03"]);
  assert.deepEqual(one.removed, []);
  assert.equal(one.issues[0].probe, "files-per-plan");
  assert.deepEqual(r.result.plans, ["01-01", "01-03", "01-02"]);
  // The outline writer is told whom to change, with the lines, and the new skeleton is reviewed again with that focus.
  const prompt = r.calls.find((c) => c.opts.label === "reallocate-1").prompt;
  assert.match(prompt, /Reallocation 1: the plan checker sent 01-01 back to the outline/);
  assert.match(prompt, /warning at 10\+, blocker at 15\+/);
  assert.match(prompt, /<revision_context>[\s\S]*files-per-plan/);
  assert.equal(r.calls.find((c) => c.opts.label === "reallocate-1").opts.session, "planner:outline");
  assert.deepEqual(labels(r).filter((x) => x.startsWith("skeleton-")), ["skeleton-L1", "skeleton-L2", "skeleton-L1", "skeleton-L2"]);
  const second = r.calls.filter((c) => c.opts.label === "skeleton-L1")[1].prompt;
  assert.match(second, /Reallocation: the plan checker sent 01-01 back to the outline and the allocation of 01-01, 01-03 changed/);
  assert.doesNotMatch(r.calls.filter((c) => c.opts.label === "skeleton-L1")[0].prompt, /Reallocation:/);
  assert.equal(w.events.filter((e) => e === "record freeze").length, 2, "the new allocation is recorded as the frozen skeleton");
  assert.equal(w.events.filter((e) => e === "record skeleton").length, 2);
  const planned = JSON.parse(w.read(`${PHASE_DIR}/handoff-args.json`) || "null");
  assert.equal(planned, null);
  assert.ok(r.result.waves.length >= 1);
});

test("P69 the second checker run after a reallocation writes its own review record, the first is kept", async () => {
  const { w } = await realloc(1);
  const files = w.root ? (await import("node:fs")).readdirSync(`${w.root}/${PHASE_DIR}/prereview`) : [];
  assert.ok(files.some((f) => /^skeleton-.*-reallocated-1\.json$/.test(f)), files.join(", "));
  assert.ok(files.some((f) => /^checker-wf_[^-]*_[^-]*(?!.*reallocated)\.json$/.test(f)) || files.some((f) => /^checker-/.test(f)), files.join(", "));
});

test("P69 a checker issue with outcome reallocate sends the plan back, with the outcome in the checker's schema and prompt", async () => {
  let calls = 0;
  const issue = { plan: "01-01", dimension: "scope_sanity", severity: "blocker", required_property: "one concern per plan", description: "owns two layers", outcome: "reallocate" };
  const { r } = await realloc(1, { state: { big: new Set() }, overrides: { "checker-": () => (++calls === 1 ? { issues: [issue] } : { issues: [] }) } });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(labels(r).filter((x) => x === "reallocate-1").length, 1);
  assert.equal(labels(r).filter((x) => x === "checker-1").length, 2);
  assert.ok(!labels(r).some((x) => x.startsWith("revise-")), "a reallocate issue is not revised");
  const first = r.calls.find((c) => c.opts.label === "checker-1");
  assert.match(first.prompt, /Files per plan is judged by a deterministic probe/);
  assert.doesNotMatch(first.prompt, /Files per plan: warning at/);
  assert.deepEqual(first.opts.schema.properties.issues.items.properties.outcome.enum, ["revise", "reallocate"]);
  assert.equal(r.result.reallocated[0].issues[0].plan, "01-01");
});

test("P69 an outline writer that leaves the named plan unchanged stops needs-owner; nothing is replanned", async () => {
  const state = { big: new Set(["01-01"]) };
  const { r } = await realloc(1, { state, overrides: { "reallocate-": () => ({ marker: "## OUTLINE COMPLETE" }) } });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Checker");
  assert.match(r.result.reason, /outline reallocation left 01-01 unchanged/);
  assert.equal(labels(r).filter((x) => x === "plan-01-01").length, 1);
  assert.ok(!labels(r).includes("checker-1"));
});

test("P69 rounds used up: the same plan still too large is an ordinary blocker again (revision, then the conflict stop)", async () => {
  const state = { big: new Set(["01-01"]) };
  const splitStillBig = { "reallocate-": (prompt) => { const w = state.world; w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.md`, outlineText(SPLIT_ROWS)); w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.manifest.json`, JSON.stringify({ phase: "1", plans: [MANIFEST("01-01", "01-01a"), MANIFEST("01-03", "01-01b"), MANIFEST("01-02", "01-02")] })); return { marker: "## OUTLINE COMPLETE" }; } };
  const { r } = await realloc(1, { state, overrides: { ...splitStillBig, "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { why: "owns are frozen" } }) } });
  assert.equal(labels(r).filter((x) => x.startsWith("reallocate-")).length, 1, "only the one round is taken");
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Checker");
  assert.match(r.result.reason, /REVISION_CONFLICT/);
  assert.ok(labels(r).includes("revise-01-01-1"));
  assert.equal(r.result.reallocated.length, 1);
});

test("P69 forceProceed naming files-per-plan accepts the size: no reallocation, no revision", async () => {
  const state = { big: new Set(["01-01"]) };
  const args = { forceProceed: { reason: "the layering needs 17 small files", issues: [{ plan: "01-01", dimension: "files-per-plan" }] } };
  const w = reallocWorld(1, state);
  state.world = w;
  const first = await plan(w, args, split(state));
  assert.match(first.result.reason, /^forceProceed refused: 01-01/);
  const r = await plan(w, args, split(state));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(!labels(r).some((x) => x.startsWith("reallocate-") || x.startsWith("revise-")));
  assert.equal(r.result.override.accepted[0].dimension, "files-per-plan");
});

test("P69 the streams flow does not use gsd.checker_reallocate: the checker keeps judging the Files per plan lines", async () => {
  const { r } = await realloc(1, { args: { planFlow: "streams" } });
  assert.ok(!labels(r).includes("reallocate-1"));
  assert.match(r.calls.find((c) => c.opts.label === "checker-1").prompt, /Files per plan: warning at 10\+/);
});

// ---- incremental recheck (item 76 F2) ----

const ROWS3 = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }, { id: "01-03", wave: 1 }];
function recheckWorld(mode = "incremental") {
  const w = makeWorld({ overlay: { gsd: { checker_recheck: mode } } });
  w.fake = { checked: null, body: null, links: {} };
  const baseCheck = w.gsd.handlers["revisions check"];
  const baseRecord = w.gsd.handlers["revisions record"];
  w.gsd.on("revisions check", (args, input, argv) => {
    if (args[1] === "checked" && w.fake.checked) return w.fake.checked;
    if (args[1] === "checkedbody") return w.fake.body ?? { code: 66, json: { status: "never" } };
    return baseCheck(args, input, argv);
  });
  w.gsd.on("revisions record", (args, input, argv) => {
    if (args[1] !== "checkedbody") return baseRecord(args, input, argv);
    w.events.push("record checkedbody");
    return { recorded: "checkedbody" };
  });
  w.gsd.on("frontmatter", ([, file, key]) => {
    const id = /(\d+-\d+)-PLAN/.exec(file)[1];
    const links = w.fake.links[id] ?? {};
    if (key === "owns") return { value: links.owns ?? [`Path:src/${id}/`] };
    if (key === "files_modified") return { value: links.files ?? [] };
    return { value: { key_links: links.key_links ?? [] } };
  });
  return w;
}
const changedAfter = (...ids) => ({ code: 1, json: { same: false, changed: ids.map(planFile) } });
const primed = async (mode) => {
  const w = recheckWorld(mode);
  const first = await plan(w, {}, {}, ROWS3);
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  return w;
};
const checkedPlans = (r) => /read-only: ([^\n]*)\./.exec(r.calls.find((c) => c.opts.label === "checker-1").prompt)[1].split(", ").map((p) => /(\d+-\d+)-PLAN/.exec(p)[1]);
const allProbesOnAllPlans = (w) => w.gsd.callsOf("check owns").every((c) => !c.argv.includes("--plans"));

test("P69 incremental: a passing check records the body digest; a full-mode project records none", async () => {
  const inc = await primed("incremental");
  assert.ok(inc.events.includes("record checkedbody"));
  const full = await primed("full");
  assert.ok(!full.events.includes("record checkedbody"));
});

test("P69 incremental: an owns or files_modified edit only starts no checker agent; every probe still ran on all plans", async () => {
  const w = await primed();
  w.fake.checked = changedAfter("01-02");
  w.fake.body = { code: 1, json: { same: false, changed: [] } };
  const r = await plan(w, {}, {}, ROWS3);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(!labels(r).some((l) => l.startsWith("checker-")), labels(r).join(","));
  assert.deepEqual(r.result.recheck, { mode: "incremental", changed: ["01-02"], bodyChanged: [], linked: [], agent: [] });
  assert.ok(allProbesOnAllPlans(w) && w.gsd.callsOf("check owns").length > 0);
});

test("P69 incremental: a content edit sends the changed plan and the plans linked by depends_on to the checker, not the rest", async () => {
  const w = await primed();
  w.fake.checked = changedAfter("01-02");
  w.fake.body = changedAfter("01-02");
  const r = await plan(w, {}, {}, ROWS3);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(checkedPlans(r), ["01-01", "01-02"], "01-02 depends on 01-01; 01-03 is not linked");
  assert.deepEqual(r.result.recheck, { mode: "incremental", changed: ["01-02"], bodyChanged: ["01-02"], linked: ["01-01"], agent: ["01-01", "01-02"] });
  assert.equal(labels(r).filter((l) => l.startsWith("checker-")).length, 1);
  assert.ok(allProbesOnAllPlans(w));
});

test("P69 incremental: a plan whose key_links reach the changed plan's write set, and a consumer in the manifest, are linked", async () => {
  const w = await primed();
  w.fake.links["01-03"] = { key_links: [{ from: "src/01-03/page.dart", to: "src/01-01/service.dart" }] };
  w.fake.checked = changedAfter("01-01");
  w.fake.body = changedAfter("01-01");
  const r = await plan(w, {}, {}, ROWS3);
  assert.deepEqual(checkedPlans(r), ["01-01", "01-02", "01-03"], "01-02 depends on it, 01-03's key_link ends in src/01-01/");
  assert.deepEqual(r.result.recheck.linked, ["01-02", "01-03"]);
});

test("P69 incremental: a changed outline part, a removed plan or a missing record is a full check", async () => {
  for (const [checked, body, why] of [
    [{ code: 1, json: { same: false, changed: [planFile("01-02"), `${PHASE_DIR}/01-PLAN-OUTLINE.md`] } }, changedAfter("01-02"), "outline"],
    [{ code: 1, json: { same: false, changed: ["settings"] } }, changedAfter("01-02"), "settings"],
    [{ code: 1, json: { same: false, changed: [planFile("01-09")] } }, changedAfter("01-02"), "removed plan"],
    [{ code: 1, json: { same: false, changed: null } }, changedAfter("01-02"), "unknown parts"],
    [{ code: 66, json: { status: "never" } }, changedAfter("01-02"), "no record"],
  ]) {
    const w = await primed();
    w.fake.checked = checked;
    w.fake.body = body;
    const r = await plan(w, {}, {}, ROWS3);
    assert.equal(r.result.status, "planned", why);
    assert.deepEqual(checkedPlans(r), ["01-01", "01-02", "01-03"], why);
    assert.equal(r.result.recheck, undefined, why);
  }
});

test("P69 incremental: without a body record every changed plan counts as a content edit", async () => {
  const w = await primed();
  w.fake.checked = changedAfter("01-03");
  w.fake.body = null;
  const r = await plan(w, {}, {}, ROWS3);
  assert.deepEqual(checkedPlans(r), ["01-03"]);
  assert.deepEqual(r.result.recheck.bodyChanged, ["01-03"]);
});

test("P69 gsd.checker_recheck full (default) keeps the whole-set checker after any plan edit and never reads the body key", async () => {
  const w = await primed("full");
  w.fake.checked = changedAfter("01-02");
  w.fake.body = { code: 1, json: { same: false, changed: [] } };
  const r = await plan(w, {}, {}, ROWS3);
  assert.deepEqual(checkedPlans(r), ["01-01", "01-02", "01-03"]);
  assert.equal(r.result.recheck, undefined);
  assert.equal(w.gsd.calls.filter((c) => c.argv.includes("checkedbody")).length, 0);
});

test("P69 incremental: a plan the loop revises joins the agent scope of the next round", async () => {
  const w = await primed();
  w.fake.checked = changedAfter("01-03");
  w.fake.body = changedAfter("01-03");
  let n = 0;
  const bad = { plan: "01-03", dimension: "contract", severity: "blocker", required_property: "p", description: "wrong" };
  const r = await plan(w, {}, { "checker-": () => (++n === 1 ? { issues: [bad] } : { issues: [], resolved: [{ id: "open-1", evidence: "ok" }] }) }, ROWS3);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(labels(r).includes("revise-01-03-1"));
  const asked = r.calls.filter((c) => c.opts.label.startsWith("checker-")).map((c) => /read-only: ([^\n]*)\./.exec(c.prompt)[1]);
  assert.deepEqual(asked, [planFile("01-03"), planFile("01-03")], "the revised plan is judged again, the unchanged plans are not");
});

test("P69 incremental on the streams flow: the one join call judges the changed and linked plans, a write-set edit starts none", async () => {
  const w = await primed();
  const prime = await plan(recheckWorld(), { planFlow: "streams" }, {}, ROWS3);
  assert.equal(prime.result.status, "planned", JSON.stringify(prime.result));
  w.fake.checked = changedAfter("01-02");
  w.fake.body = { code: 1, json: { same: false, changed: [] } };
  const none = await plan(w, { planFlow: "streams" }, {}, ROWS3);
  assert.equal(none.result.status, "planned", JSON.stringify(none.result));
  assert.ok(!labels(none).some((l) => l.startsWith("checker-")));
  w.fake.body = changedAfter("01-02");
  const some = await plan(w, { planFlow: "streams" }, {}, ROWS3);
  assert.deepEqual(checkedPlans(some), ["01-01", "01-02"]);
});
