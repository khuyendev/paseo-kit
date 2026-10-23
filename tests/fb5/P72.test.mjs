// Kit feedback #72 (P72): with gsd.plan_review_check "resolve" the staged plan review judges convergence by the identity of
// its open issues. After the first pass an edit is followed by a resolution check of the open issues and a finder limited to
// the lines the edit changed; the check counts fixed, still open and new in edited text apart and stops as not converging
// only when the edit fixed nothing. The "fresh" cycle, the streams flow and the metrics record keep working.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const RUN = "wf_20261020-120000_ab12";
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const labels = (r) => r.calls.map((c) => c.opts.label);
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const high = (description, plan) => ({ severity: "high", actionable: true, description, ...(plan ? { plan } : {}) });

// first[plan]: issues the first-pass finder of that plan reports. bounded[check][plan]: issues the bounded finder reports
// after the edit that leads to check number `check` (label find-<plan>-<lens>-c<check>); a fresh-mode finder reads the same
// table by its cycle. edits[k]: the plans edit k (editor-<k+1>) rewrites. resolves(description): what the resolution check
// confirms. Every kept issue is also given a medium note so the notes can be seen.
function scenario(w, { first = {}, bounded = {}, edits = [], resolves = () => true, fresh = {} } = {}) {
  let editor = 0;
  return (p, o) => {
    const l = o.label;
    const find = /^find-(\d+-\d+)-.+?(?:-c(\d+))?$/.exec(l);
    if (find) return { issues: find[2] ? bounded[find[2]]?.[find[1]] ?? [] : fresh[find[1]] ?? first[find[1]] ?? [] };
    if (l.startsWith("verify-")) return { verdicts: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, valid: true })) };
    if (l.startsWith("judge-")) return { decisions: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, keep: true })) };
    if (/^editor-\d+$/.test(l)) {
      for (const id of edits[editor++] ?? []) w.write(planPath(id), `${w.read(planPath(id)) || planText(id)}<!-- revised ${l} -->\nline added by ${l}\n`);
      return { marker: "REVISION COMPLETE" };
    }
    if (l.startsWith("resolve-")) {
      const open = JSON.parse(/Open issues \(JSON\): (.*)/.exec(p)[1]);
      return { resolved: open.filter((x) => resolves(x.description)).map((x) => ({ id: x.id, evidence: "fixed" })) };
    }
    return null;
  };
}
const review = (w, agent, args = {}) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01", "01-02"], ...args }, agent });
const world = (mode = "resolve", extra = {}) => {
  const w = makeWorld({ overlay: { gsd: { plan_review_check: mode, ...extra } } });
  w.write(planPath("01-01"), planText("01-01"));
  w.write(planPath("01-02"), planText("01-02", { wave: 2, depends: ["01-01"] }));
  return w;
};

test("P72 the item-72 case: every open issue fixed and one new issue in the edited text does not read as not converging", async () => {
  const w = world();
  const r = await review(w, scenario(w, {
    first: { "01-01": [high("A reads a removed file")] },
    bounded: { 2: { "01-01": [high("B: 01-02 still reads what the edit removed", "01-02")] } },
    edits: [["01-01"], ["01-02"]],
  }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  // cycle 1 finds; cycle 2 fixed A and found B; cycle 3 fixed B and found nothing.
  assert.deepEqual(r.result.counts, [
    { cycle: 1, high: 1, mediumOrLow: 0 },
    { cycle: 2, high: 1, mediumOrLow: 0, fixed: 1, stillOpen: 0, new: 1 },
    { cycle: 3, high: 0, mediumOrLow: 0, fixed: 1, stillOpen: 0, new: 0 },
  ]);
  assert.equal(r.result.cycles, 3);
  assert.deepEqual(r.result.resolved.map((x) => x.description), ["A reads a removed file", "B: 01-02 still reads what the edit removed"]);
  // B was named for 01-02 by the finder of 01-01: 01-02's verifier judged it and 01-02's editor pass followed.
  assert.ok(labels(r).includes("verify-01-02"));
  assert.match(r.calls.find((c) => c.opts.label === "editor-2").prompt, /B: 01-02 still reads/);
  // The fresh finder ran once per plan and lens; later passes read only the edited plans.
  assert.deepEqual(labels(r).filter((l) => l.startsWith("find-")), ["find-01-01-source-grounding", "find-01-02-source-grounding", "find-01-01-source-grounding-c2", "find-01-02-source-grounding-c3"]);
  assert.deepEqual(labels(r).filter((l) => l.startsWith("resolve-")), ["resolve-01-01-1", "resolve-01-02-2"]);
  assert.equal(w.recorded.has("plan:01-01") && w.recorded.has("plan:01-02"), true);
});

test("P72 the bounded finder gets only the lines the edit changed, with their numbers, and the issues already known", async () => {
  const w = world();
  const r = await review(w, scenario(w, { first: { "01-01": [high("A")] }, edits: [["01-01"]] }));
  assert.equal(r.result.status, "converged");
  const p = r.calls.find((c) => c.opts.label === "find-01-01-source-grounding-c2").prompt;
  assert.match(p, /\n9: line added by editor-1/);
  assert.match(p, /\n8: <!-- revised editor-1 -->/);
  assert.equal(p.includes("<tasks>"), false);
  assert.match(p, /Known open issues \(JSON\): \[\{"id":"C1-1-1","plan":"01-01","description":"A"\}\]/);
  assert.equal(r.calls.find((c) => c.opts.label === "find-01-01-source-grounding-c2").opts.readOnly, true);
  // A plan the edit left alone is not read by a bounded finder.
  assert.equal(labels(r).some((l) => l.startsWith("find-01-02") && l.endsWith("-c2")), false);
});

test("P72 an edit that fixes nothing stops as not converging, with its still-open issues and no finder over unchanged text", async () => {
  const w = world();
  const r = await review(w, scenario(w, { first: { "01-01": [high("A")] }, edits: [[]], resolves: () => false }));
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not converging: 1 high issues still open after the edit, not below 1/);
  assert.deepEqual(r.result.issues.map((x) => x.description), ["A"]);
  assert.deepEqual(r.result.counts.at(-1), { cycle: 2, high: 1, mediumOrLow: 0, fixed: 0, stillOpen: 1, new: 0 });
  // The editor changed nothing: no bounded finder ran, and no fresh review of the plans.
  assert.deepEqual(labels(r).filter((l) => l.startsWith("find-")), ["find-01-01-source-grounding", "find-01-02-source-grounding"]);
});

test("P72 an edit that fixes some issues goes on even when a new one appears; the count of still-open issues is what must fall", async () => {
  const w = world();
  const r = await review(w, scenario(w, {
    first: { "01-01": [high("A"), high("B")] },
    bounded: { 2: { "01-01": [high("C")] } },
    edits: [["01-01"], ["01-01"]],
    resolves: (d) => d !== "B" || w.read(planPath("01-01")).includes("editor-2"),
  }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.deepEqual(r.result.counts.map((c) => [c.cycle, c.fixed, c.stillOpen, c.new]), [[1, undefined, undefined, undefined], [2, 1, 1, 1], [3, 2, 0, 0]]);
  // The second edit gets the still-open issue and the new one, nothing else.
  assert.deepEqual(JSON.parse(/Issues \(JSON\): (.*)/.exec(r.calls.find((c) => c.opts.label === "editor-2").prompt)[1]).map((x) => x.description), ["B", "C"]);
});

test("P72 edits that keep introducing new high issues stop after the bounded rounds for new issues", async () => {
  const w = world();
  const r = await review(w, scenario(w, {
    first: { "01-01": [high("A")] },
    bounded: { 2: { "01-01": [high("N1")] }, 3: { "01-01": [high("N2")] }, 4: { "01-01": [high("N3")] } },
    edits: [["01-01"], ["01-01"], ["01-01"]],
  }));
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /keep introducing new high issues/);
  assert.deepEqual(r.result.issues.map((x) => x.description), ["N3"]);
  assert.equal(labels(r).filter((l) => /^editor-\d+$/.test(l)).length, 3);
  assert.deepEqual(r.result.counts.map((c) => c.new), [undefined, 1, 1, 1]);
});

test("P72 the notes of every pass are kept once; the first pass's note and a later pass's note both reach plan-review-notes.json", async () => {
  const w = world();
  const note = (description, plan) => ({ severity: "medium", actionable: false, description, ...(plan ? { plan } : {}) });
  const r = await review(w, scenario(w, {
    first: { "01-01": [high("A"), note("first note")] },
    bounded: { 2: { "01-01": [note("later note"), note("first note")] } },
    edits: [["01-01"]],
  }));
  assert.equal(r.result.status, "converged");
  assert.deepEqual(r.result.issues.map((x) => x.description), ["first note", "later note"]);
  assert.deepEqual(JSON.parse(w.read(`${PD}/plan-review-notes.json`)).map((x) => x.description), ["first note", "later note"]);
});

test("P72 a resolution check or bounded finder that answers nothing fails the review instead of converging", async () => {
  const w = world();
  const base = scenario(w, { first: { "01-01": [high("A")] }, edits: [["01-01"]] });
  const r = await review(w, (p, o) => (o.label.startsWith("resolve-") ? null : base(p, o)));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /plan resolution 01-01 returned nothing/);
  assert.deepEqual(r.result.issues.map((x) => x.description), ["A"]);
  const w2 = world();
  const base2 = scenario(w2, { first: { "01-01": [high("A")] }, edits: [["01-01"]] });
  const r2 = await review(w2, (p, o) => (o.label.endsWith("-c2") ? null : base2(p, o)));
  assert.equal(r2.result.status, "failed");
  assert.match(r2.result.reason, /plan finder 01-01 \(source-grounding\) returned nothing/);
});

test("P72 REVISION_CONFLICT still goes to the owner", async () => {
  const w = world();
  const base = scenario(w, { first: { "01-01": [high("A")] }, edits: [["01-01"]] });
  const r = await review(w, (p, o) => (o.label === "editor-1" ? { marker: "REVISION_CONFLICT", conflict: { why: "contradicts D-01" } } : base(p, o)));
  assert.equal(r.result.status, "needs-owner");
  assert.deepEqual(r.result.conflict, { why: "contradicts D-01" });
  assert.deepEqual(r.result.issues.map((x) => x.description), ["A"]);
});

test("P72 the metrics ledger records each issue: fixed ones applied, new ones with their lens, still-open ones open", async () => {
  const w = world();
  const r = await review(w, scenario(w, {
    first: { "01-01": [high("A")] },
    bounded: { 2: { "01-01": [high("B", "01-02")] } },
    edits: [["01-01"], ["01-02"]],
    resolves: (d) => d === "A" || w.read(planPath("01-02")).includes("editor-2"),
  }));
  assert.equal(r.result.status, "converged");
  const rec = JSON.parse(w.read(`${PD}/prereview/plan-${RUN}.json`));
  assert.deepEqual(rec.findings.map((f) => [f.description, f.plan, f.lens, f.fate, f.confirmed]), [["A", "01-01", "source-grounding", "applied", true], ["B", "01-02", "source-grounding", "applied", true]]);
  // A stop leaves the unfixed issue open in the record.
  const w2 = world();
  const r2 = await review(w2, scenario(w2, { first: { "01-01": [high("A")] }, edits: [[]], resolves: () => false }));
  assert.equal(r2.result.status, "needs-owner");
  assert.deepEqual(JSON.parse(w2.read(`${PD}/prereview/plan-${RUN}.json`)).findings.map((f) => f.fate), ["open"]);
});

test("P72 plan_review_check fresh keeps the cycle that compares fresh counts: the same fixed-then-new case stops", async () => {
  const w = world("fresh");
  const r = await review(w, scenario(w, {
    fresh: { "01-01": [high("new issue")] },
    edits: [["01-01"], ["01-01"]],
  }));
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not converging: 1 high issues, not below 1/);
  assert.equal(labels(r).some((l) => l.startsWith("resolve-") || /-c\d+$/.test(l)), false);
  assert.deepEqual(r.result.counts, [{ cycle: 1, high: 1, mediumOrLow: 0 }, { cycle: 2, high: 1, mediumOrLow: 0 }]);
});

test("P72 the streams flow ignores the setting and a plan that converges at once costs the same calls in the resolve check", async () => {
  const w = world();
  const clean = await review(w, scenario(w, {}));
  assert.equal(clean.result.status, "converged");
  assert.deepEqual(labels(clean).filter((l) => !l.startsWith("find-")), []);
  assert.deepEqual(clean.result.counts, [{ cycle: 1, high: 0, mediumOrLow: 0 }]);
  // Streams: the single-plan stream still ends on its own resolution check, unchanged by the shared helper.
  const w2 = world();
  w2.write(planPath("01-01"), planText("01-01"));
  const base = scenario(w2, { first: { "01-01": [high("A")] } });
  const s = await runScript("gsd-plan-review", { root: w2.root, gsd: w2.gsd, args: { phaseDir: PD, plans: ["01-01"], stream: true }, agent: (p, o) => {
    if (/^editor-01-01-\d+$/.test(o.label)) { w2.write(planPath("01-01"), `${planText("01-01")}<!-- edited -->\n`); return { marker: "REVISION COMPLETE" }; }
    if (o.label.startsWith("resolve-")) return { resolved: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id })) };
    return base(p, o);
  } });
  assert.equal(s.result.status, "converged", JSON.stringify(s.result));
  assert.deepEqual(labels(s).filter((l) => l.startsWith("resolve-")), ["resolve-01-01-1"]);
});
