import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setup, meta } from "../workflow/helpers.mjs";
import { connectFake } from "../helpers/run.mjs";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { createWorktree, discardWorktree } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { sha256 } from "../../ship/.agents/harness/lib/hash.mjs";
import { recordBaseline, transfer } from "../../ship/.agents/workflows/lib/flow-execute.mjs";

for (const command of ["spawn", "workflow"]) test(`PCLI-11 ${command} preserves a live worker's worktree after tracking and archive fail`, async () => {
  const s = setup({ git: true, overlay: { max_subagents: 1, max_live_subagents: 1 } });
  const observe = s.fake.client.observeTimeline.bind(s.fake.client);
  s.fake.client.observeTimeline = (ids) => {
    if (ids.some((id) => id !== s.env.PASEO_AGENT_ID)) throw new Error("subscription lost");
    return observe(ids);
  };
  s.fake.client.archiveAgent = async () => { throw new Error("archive unavailable"); };
  const argv = command === "spawn" ? ["spawn", "--name", "worker", "--worktree", "--prompt", "test"] : ["workflow", "--script", "wf.js", "--run-id", "wf_cleanup"];
  if (command === "workflow") s.project.write("wf.js", `${meta()}const first = await agent("test", {isolation:"worktree", detail:true}); const second = await agent("next", {detail:true}); return {first, second};`);
  const r = await s.ph(argv);
  const created = s.fake.callsOf("createAgent");
  assert.equal(created.length, 1, JSON.stringify(r));
  const cwd = created[0].args[0].cwd;
  assert.ok(fs.existsSync(cwd));
  assert.match(s.project.git("worktree", "list", "--porcelain"), /harness\//);
  if (command === "workflow") {
    const result = s.project.readJson("_workspace/_runs/wf_cleanup/result.json");
    assert.ok(result.first.agentId);
    assert.match(result.first.reason, /archive failed/);
    assert.match(result.second.reason, /live agent cap reached/);
  } else assert.match(r.stdout, /archive failed, agent may still be live/);
});

test("PCLI-15 shared listings exhaust pages and reject incomplete listings", async () => {
  const s = setup();
  const session = await connectFake(s.fake, { env: s.env, root: s.project.root, clock: s.clock });
  const label = "paseo.parent-agent-id";
  const a = { id: "worker-first", title: "first", labels: { [label]: session.caller } };
  const b = { id: "worker-later", title: "later", labels: { [label]: session.caller } };
  const pages = [];
  s.fake.client.fetchAgents = async (q) => {
    pages.push(q);
    return q.page ? { entries: [{ agent: b }], pageInfo: { hasMore: false } } : { entries: [{ agent: a }], pageInfo: { hasMore: true, nextCursor: "next" } };
  };
  assert.deepEqual((await session.listAgents()).map((x) => x.id), [a.id, b.id]);
  assert.deepEqual(pages[1].page, { cursor: "next" });
  assert.equal((await session.resolveTargets(["later"]))[0].id, b.id);
  s.fake.client.fetchAgents = async () => ({ entries: [], pageInfo: { hasMore: true, nextCursor: "repeated" } });
  await assert.rejects(session.findAgents(), /incomplete/);
  s.fake.client.fetchAgents = async (q) => { if (q.page) throw new Error("lost page"); return { entries: [{ agent: a }], pageInfo: { hasMore: true, nextCursor: "next" } }; };
  await assert.rejects(session.listAgents(), /lost page/);
  await session.close();
});

const draft = (req = "A-01, B-01", criteria = "1. Works\n2. Tested") => `# Roadmap\n## Phase 1: Core\n**Goal**: Works\n**Depends on**: None\n**Requirements**: ${req}\n**Success Criteria**:\n${criteria}\n`;
test("GSDF-95 install-draft enforces categorized exact coverage before any shared file write", async () => {
  const p = project();
  const req = "# Requirements\n## v1 Requirements\n### Alpha\n- [ ] **A-01**: A\n### Beta\n| ID | Rule |\n| B-01 | B |\n## v2\n- [ ] **C-01**: Later\n";
  p.write(".planning/REQUIREMENTS.md", req);
  const before = p.read(".planning/ROADMAP.md");
  const cases = [
    [draft(), {}],
    [draft("A-01"), { "A-01": 1 }],
    [draft("A-01, A-01, B-01"), { "A-01": 1, "B-01": 1 }],
    [draft(), { "A-01": 1, "B-01": 2 }],
    [draft("A-01, B-01", "1. Only one"), { "A-01": 1, "B-01": 1 }],
    [draft(), { "A-01": 1, "B-01": 1, "C-01": 1 }],
  ];
  for (const [roadmap, trace] of cases) {
    p.write(".planning/drafts/ROADMAP.md", roadmap);
    p.writeJson(".planning/drafts/traceability.json", trace);
    const r = await gsd(p, ["roadmap", "install-draft"]);
    assert.equal(r.code, 1, JSON.stringify(r));
    assert.equal(p.read(".planning/ROADMAP.md"), before);
    assert.equal(p.read(".planning/REQUIREMENTS.md"), req);
  }
  p.write(".planning/drafts/ROADMAP.md", draft());
  p.writeJson(".planning/drafts/traceability.json", { "A-01": 1, "B-01": 1 });
  assert.equal((await gsd(p, ["roadmap", "install-draft"])).code, 0);
});

test("FLOW-27 the real workflow runner seeds a new worktree before fake worker dispatch", async () => {
  const s = setup({ git: true, files: { "src/dependency": "old" }, responder: (agent) => {
    assert.equal(fs.readFileSync(path.join(agent.cwd, "src/dependency"), "utf8"), "accepted");
    return [{ reply: "seed observed" }];
  } });
  s.project.write("src/dependency", "accepted");
  const seed = { head: s.project.git("rev-parse", "HEAD").trim(), files: [{ path: "src/dependency", sha256: sha256("accepted") }] };
  s.project.write("wf.js", `${meta()}return await agent("test", {isolation:"worktree", worktreeSeed: ${JSON.stringify(seed)}, detail:true});`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_seed"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.project.readJson("_workspace/_runs/wf_seed/result.json").result, "seed observed");
});

test("GSDF-94 seeded worktrees exclude unchanged dependencies but reject their edits or restoration", async () => {
  const s = setup({ git: true, files: { "src/dependency": "old", "src/deleted": "old" } });
  const p = s.project;
  const pd = ".planning/phases/01-core";
  recordBaseline(p.root, pd);
  p.write("src/dependency", "accepted");
  fs.rmSync(p.path("src/deleted"));
  const seed = { head: p.git("rev-parse", "HEAD").trim(), files: [{ path: "src/dependency", sha256: sha256("accepted") }, { path: "src/deleted", deleted: true }] };
  const wt = await createWorktree(p.root, loadConfig(p.root), "seeded", { seed });
  try {
    assert.equal(fs.readFileSync(path.join(wt.path, "src/dependency"), "utf8"), "accepted");
    assert.equal(fs.existsSync(path.join(wt.path, "src/deleted")), false);
    const input = { plan: "01-02", worktree: wt.path, owns: ["Path:src/own"] };
    assert.deepEqual(transfer(p.root, pd, input).files, []);
    fs.writeFileSync(path.join(wt.path, "src/dependency"), "old", "utf8");
    const r = transfer(p.root, pd, input);
    assert.equal(r.ok, false);
    assert.ok(r.refused.some((f) => f.path === "src/dependency"));
    assert.equal(p.read("src/dependency"), "accepted");
  } finally { discardWorktree(wt); }
  p.write("src/dependency", "changed after approval");
  await assert.rejects(createWorktree(p.root, loadConfig(p.root), "bad-seed", { seed }), /seed changed/);
  assert.doesNotMatch(p.git("worktree", "list", "--porcelain"), /bad-seed/);
});
