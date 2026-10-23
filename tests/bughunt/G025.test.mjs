// Bug-hunt fix of the gsd-plan skeleton review (group G025 of the 2026-10-23 hunt): a skeleton issue keeps its
// required_property through the outline reviser, the architect, the resolution check, the owner report and OUTLINE-REVIEW.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}, rows) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides, ...(rows ? { rows } : {}) }) });
const INVARIANT = "RP-MARKER: every plan owns a disjoint path";
const issue = { plan: "01-01", severity: "blocker", required_property: INVARIANT, description: "owns overlap", evidence: "outline row 1", fix_hint: "split the owns", target: "outline" };

test("G025 the outline reviser, the owner report and OUTLINE-REVIEW keep the required_property of a skeleton issue", async () => {
  const w = makeWorld();
  const r = await plan(w, {}, {
    "skeleton-L1": () => ({ issues: [issue] }),
    "resolve-L1": () => ({ resolved: [] }),
    "outline-revise": () => ({ marker: "## REVISION COMPLETE" }),
  });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Skeleton review"]);
  const reviser = r.calls.find((c) => c.opts.label === "outline-revise-2");
  assert.match(reviser.prompt, /RP-MARKER: every plan owns a disjoint path/);
  assert.equal(r.result.issues[0].required_property, INVARIANT);
  assert.match(w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /\| id \| lane \| plan \| severity \| target \| required_property \| description \| evidence \|/);
  assert.match(w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /RP-MARKER: every plan owns a disjoint path/);
});

test("G025 the resolution check and the architect see the required_property of a wiring-targeted skeleton issue", async () => {
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "Api" }] }];
  const archAgent = { ".agents/agents/arch.md": "---\nname: arch\n---\nbody\n" };
  const w = makeWorld({ files: archAgent, overlay: { adapter: { agents: { architect: "arch" } } } });
  const wiringIssue = { ...issue, target: "wiring" };
  const r = await plan(w, {}, {
    "skeleton-L1": () => ({ issues: [wiringIssue] }),
    "resolve-L1": () => ({ resolved: [] }),
    architect: () => {
      w.write(`${PHASE_DIR}/01-WIRING.md`, "Api: 01-01 -> 01-02\n");
      return { status: "complete", sharedChanges: [], outlineChanges: [] };
    },
  }, rows);
  assert.equal(r.result.status, "needs-owner");
  const resolve = r.calls.find((c) => c.opts.label === "resolve-L1");
  assert.match(resolve.prompt, /RP-MARKER: every plan owns a disjoint path/);
  const architectPass2 = r.calls.find((c) => c.opts.label === "architect" && /Resolve these skeleton issues/.test(c.prompt));
  assert.ok(architectPass2);
  assert.match(architectPass2.prompt, /RP-MARKER: every plan owns a disjoint path/);
});
