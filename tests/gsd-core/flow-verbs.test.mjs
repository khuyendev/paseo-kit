// Verb shapes the GSD workflow scripts rely on (integration requests of code-gsd-flows), run on the real verbs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gsd, P1, plan, project } from "./fixture.mjs";

const DRAFT = `# Roadmap: Fixture

## Phases

- [ ] **Phase 1: Core** - the core
- [ ] **Phase 2: Api** - the api

## Phase Details

### Phase 1: Core
**Goal**: Core works
**Depends on**: Nothing (first phase)
**Requirements**: [CORE-01, CORE-02]
**Success Criteria** (what must be TRUE):
  1. Core runs
  2. Core is tested
**Plans**: TBD

### Phase 2: Api
**Goal**: Api works
**Depends on**: Phase 1
**Requirements**: API-01
**Success Criteria** (what must be TRUE):
  1. Api answers
  2. Api is tested
**Plans**: TBD
`;

test("GSDC-12 roadmap install-draft installs ROADMAP, traceability and STATE through the single writer (GSDF-95)", async () => {
  const p = project({ files: { ".planning/ROADMAP.md": null } });
  const before = p.read(".planning/REQUIREMENTS.md");
  assert.equal((await gsd(p, ["roadmap", "install-draft"])).code, 1, "no draft yet");
  assert.equal(p.read(".planning/REQUIREMENTS.md"), before);
  p.write(".planning/drafts/ROADMAP.md", DRAFT);
  p.write(".planning/drafts/traceability.json", JSON.stringify({ "CORE-01": 1, "CORE-02": 1, "API-01": "Phase 2" }));
  const r = await gsd(p, ["roadmap", "install-draft"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.phases, r.json.traced, r.json.state], [2, 3, "initialised"]);
  assert.equal(p.read(".planning/ROADMAP.md"), DRAFT);
  assert.match(p.read(".planning/REQUIREMENTS.md"), /\| API-01 \| Phase 2 \| Pending \|/);
  assert.equal((p.read(".planning/REQUIREMENTS.md").match(/^## Traceability/gm) ?? []).length, 1);
  assert.equal((await gsd(p, ["state", "load"])).code, 0);
  assert.equal((await gsd(p, ["roadmap", "get-phase", "2"])).json.goal, "Api works");
  p.write(".planning/drafts/traceability.json", JSON.stringify({ "CORE-01": 7 }));
  assert.equal((await gsd(p, ["roadmap", "install-draft"])).code, 1, "a phase missing from the draft is refused");
});

test("GSDC-43 debug budget accumulates turns and minutes; checkpoints set and clear pending_checkpoint (GSDF-65/67)", async () => {
  const p = project();
  const input = { signature: { kind: "test", key: "k", label: "Boom" }, symptoms: { expected: "a", actual: "b", errors: "E", reproduction: "r", started: "s" }, owns: ["Path:src/"] };
  const slug = (await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) })).json.slug;
  await gsd(p, ["debug", "budget", slug], { stdin: JSON.stringify({ turns: 1, minutes: 3 }) });
  const b = await gsd(p, ["debug", "budget", slug], { stdin: JSON.stringify({ turns: 1, minutes: 2 }) });
  assert.deepEqual(b.json.budget_used, { turns: 2, minutes: 5 });
  await gsd(p, ["debug", "checkpoint", slug], { stdin: JSON.stringify({ id: "c1", type: "decision", question: "Which env?", options: ["a", "b"] }) });
  let st = (await gsd(p, ["debug", "status", slug])).json;
  assert.deepEqual(st.frontmatter.budget_used, { turns: 2, minutes: 5 });
  assert.deepEqual(st.frontmatter.pending_checkpoint, { id: "c1", type: "decision", question: "Which env?", options: ["a", "b"] });
  assert.equal((await gsd(p, ["debug", "checkpoint", slug], { stdin: JSON.stringify({ answered: "c9", response: "x" }) })).code, 1);
  await gsd(p, ["debug", "checkpoint", slug], { stdin: JSON.stringify({ answered: "c1", response: "staging\n## injected" }) });
  st = (await gsd(p, ["debug", "status", slug])).json;
  assert.equal(st.frontmatter.pending_checkpoint, null);
  assert.ok(!st.sections.includes("injected"));
});

test("GSDC-18 verify plan-structure takes one PLAN file path (upstream form) as well as a phase", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), ".planning/quick/1-x/1-PLAN.md": plan({ phase: "q", id: "1" }) } });
  const one = await gsd(p, ["verify", "plan-structure", `${P1}/01-01-PLAN.md`]);
  assert.equal(one.code, 0, JSON.stringify(one.json));
  assert.equal(one.json.valid, true);
  assert.equal((await gsd(p, ["verify", "plan-structure", ".planning/quick/1-x/1-PLAN.md"])).json.valid, true);
  p.write(`${P1}/01-02-PLAN.md`, "---\nphase: 1\n---\nno tasks\n");
  const bad = await gsd(p, ["verify", "plan-structure", `${P1}/01-02-PLAN.md`]);
  assert.equal(bad.code, 1);
  assert.ok(bad.json.errors.includes("No <task> elements found"));
  assert.equal((await gsd(p, ["verify", "plan-structure", `${P1}/01-09-PLAN.md`])).code, 66);
});

test("GSDC-27 handoff --no-tracer-split keeps a wave whole; tasks carry the plan id and its path", async () => {
  const tracer = '<task type="tracer">\n<name>Slice</name><files>src/t.js</files><action>a</action><verify><automated>cmd: node src/t.js</automated><fails_when>x</fails_when></verify><done>d</done>\n</task>';
  const p = project({ files: {
    [`${P1}/01-01-PLAN.md`]: plan({ files: "[src/t.js]", owns: '["Path:src/t.js"]', tasks: tracer }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: '["Path:src/b.js"]' }),
  } });
  assert.deepEqual((await gsd(p, ["handoff", "1"])).json.waves.map((w) => w.tasks), [["01-01"], ["01-02"]]);
  const whole = await gsd(p, ["handoff", "1", "--prefix", "gap", "--no-tracer-split"]);
  assert.deepEqual(whole.json.waves.map((w) => w.tasks), [["01-01", "01-02"]]);
  const t = p.readJson(`${P1}/handoff/gap-w1.args.json`).tasks[1];
  assert.deepEqual([t.plan, t.planPath], ["01-02", `${P1}/01-02-PLAN.md`]);
});
