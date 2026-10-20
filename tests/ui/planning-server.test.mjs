import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import contribute from "../../plugins/planning-panel/index.server.ts";
import { INDEX_FILE_CAP, PlanningIndexer } from "../../plugins/planning-panel/server/indexer.ts";
import { PlanningService } from "../../plugins/planning-panel/server/service.ts";
import { PLANNING_RPCS, planningBoardRpc, planningFileRpc, planningIndexRpc, planningPlanRpc } from "../../plugins/planning-panel/shared/planning.ts";
import { makeTempDir } from "../helpers/temp.mjs";
import { fakeServer } from "./fake-paseo.mjs";
import { countingLadder, fakeWorkspaces, makeWorkspace, planText, summaryText, write } from "./planning-fixtures.mjs";

function service(ladder = countingLadder, indexer) {
  return new PlanningService(ladder, indexer);
}

test("PANL-03 planning RPC names match the pattern; outputs parse with their schemas", async () => {
  assert.deepEqual(PLANNING_RPCS.map((r) => r.name), ["planning.index", "planning.board", "planning.plan", "planning.file"]);
  for (const r of PLANNING_RPCS) assert.match(r.name, /^[a-z][a-z0-9._-]*$/);
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-core/01-01-PLAN.md", planText());
  write(root, "ROADMAP.md", "# Roadmap\n");
  const paseo = fakeWorkspaces({ w: dir });
  const s = service();
  planningIndexRpc.output.parse(await s.index(paseo, { workspaceId: "w" }));
  planningBoardRpc.output.parse(await s.board(paseo, { workspaceId: "w" }));
  planningPlanRpc.output.parse(await s.plan(paseo, { workspaceId: "w", planId: "01-01" }));
  planningFileRpc.output.parse(await s.file(paseo, { workspaceId: "w", path: "ROADMAP.md" }));
});

test("PANL-02 planning server entry registers four handlers; disposer leaves zero subscriptions", () => {
  const server = fakeServer();
  const dispose = contribute(server);
  assert.deepEqual([...server.handlers.keys()].sort(), ["planning.board", "planning.file", "planning.index", "planning.plan"]);
  dispose();
  assert.equal(server.subscriptions(), 0);
});

test("PANL-04 no_planning, failed with the message, never throws", async () => {
  const dir = makeTempDir("ui no planning ");
  const s = service();
  const r = await s.index(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.deepEqual([r.ok, r.code, r.directory], [false, "no_planning", dir]);
  const { dir: d2, root } = makeWorkspace();
  write(root, "ROADMAP.md", "x");
  const boom = new PlanningService(countingLadder, { index: async () => { throw new Error("disk on fire\nmore"); } });
  const f = await boom.index(fakeWorkspaces({ w: d2 }), { workspaceId: "w" });
  assert.deepEqual([f.ok, f.code, f.message], [false, "failed", "disk on fire"]);
  planningIndexRpc.output.parse(f);
});

test("PANL-11 an unknown workspace id gives ok:false with the message", async () => {
  const r = await service().index(fakeWorkspaces({}), { workspaceId: "nope" });
  assert.deepEqual([r.ok, r.message, r.directory], [false, "Workspace nope has no directory", null]);
});

test("PANL-12 index: 200 plans with kinds, cache by mtime, add/delete, frontmatter past 4 KiB", async () => {
  const { dir, root } = makeWorkspace();
  for (let i = 1; i <= 200; i += 1) write(root, `phases/01-core/01-${String(i).padStart(3, "0")}-PLAN.md`, planText({ plan: String(i) }));
  write(root, "phases/01-core/01-001-SUMMARY.md", summaryText("complete"));
  write(root, "phases/01-core/01-PLAN-OUTLINE.md", "# outline\n");
  write(root, "STATE.md", `---\nstatus: Planning\nlong: "${"x".repeat(5000)}"\n---\n# State\n`);
  const indexer = new PlanningIndexer();
  const s = service(countingLadder, indexer);
  const paseo = fakeWorkspaces({ w: dir });
  const a = await s.index(paseo, { workspaceId: "w" });
  assert.equal(a.scope, "complete");
  assert.equal(a.files.filter((f) => f.kind === "plan").length, 200);
  assert.equal(a.files.find((f) => f.path.endsWith("PLAN-OUTLINE.md")).kind, "plan-outline");
  assert.equal(a.files.find((f) => f.path === "phases/01-core/01-001-SUMMARY.md").status, "complete");
  const state = a.files.find((f) => f.path === "STATE.md");
  assert.deepEqual([state.kind, state.title, state.error], ["state", "State", null]);
  const reads = indexer.reads;
  await s.index(paseo, { workspaceId: "w" });
  assert.equal(indexer.reads, reads, "unchanged mtimes read nothing");
  write(root, "phases/01-core/01-201-PLAN.md", planText());
  fs.rmSync(path.join(root, "phases/01-core/01-002-PLAN.md"));
  const c = await s.index(paseo, { workspaceId: "w" });
  assert.equal(indexer.reads, reads + 1);
  assert.ok(c.files.some((f) => f.planId === "01-201"));
  assert.ok(!c.files.some((f) => f.planId === "01-002"));
});

test("PANL-07 two planning.index calls with unchanged mtimes read no file body the second time", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "ROADMAP.md", "# R\n");
  write(root, "phases/01-a/01-01-PLAN.md", planText());
  const indexer = new PlanningIndexer();
  const s = service(countingLadder, indexer);
  await s.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  const n = indexer.reads;
  await s.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(indexer.reads, n);
});

test("PANL-12 5,001 files give truncated; an unreadable directory gives unreadable; symlink loops are not followed", async () => {
  const { root } = makeWorkspace();
  fs.mkdirSync(path.join(root, "bulk"), { recursive: true });
  for (let i = 0; i <= INDEX_FILE_CAP; i += 1) fs.writeFileSync(path.join(root, "bulk", `f${i}.txt`), "");
  const big = await new PlanningIndexer().index(root);
  assert.deepEqual([big.scope, big.total, big.files.length], ["truncated", 5001, 5000]);

  const { root: r2 } = makeWorkspace();
  write(r2, "phases/01-a/01-01-PLAN.md", planText());
  write(r2, "phases/02-b/02-01-PLAN.md", planText());
  fs.symlinkSync(r2, path.join(r2, "phases", "loop"), "junction");
  const real = (d) => fs.promises.readdir(d, { withFileTypes: true });
  const failing = async (d) => {
    if (d.endsWith("02-b")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    return real(d);
  };
  const res = await new PlanningIndexer(failing).index(r2);
  assert.deepEqual([res.scope, res.unreadable], ["unreadable", "phases/02-b"]);
  assert.ok(!res.files.some((f) => f.path.includes("loop")));
});

test("PANL-12 frontmatter over 64 KiB is that file's parse_error", async () => {
  const { root } = makeWorkspace();
  write(root, "huge.md", `---\nk: "${"y".repeat(70 * 1024)}"\n---\n`);
  write(root, "ok.md", "---\na: 1\n---\n# Fine\n");
  const res = await new PlanningIndexer().index(root);
  assert.equal(res.files.find((f) => f.path === "huge.md").error.message, "frontmatter over 64 KiB");
  assert.equal(res.files.find((f) => f.path === "ok.md").title, "Fine");
  assert.equal(res.scope, "complete");
});

test("PANL-13 planning.file refuses ../, absolute paths and symlinks escaping .planning", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "ok.md", "# ok\n");
  write(dir, "secret.md", "TOP SECRET");
  const outside = makeTempDir("ui outside ");
  write(outside, "leak.md", "LEAK");
  fs.symlinkSync(outside, path.join(root, "link"), "junction");
  const s = service();
  const paseo = fakeWorkspaces({ w: dir });
  for (const p of ["../secret.md", path.join(dir, "secret.md"), "link/leak.md", "a/../../secret.md"]) {
    const r = await s.file(paseo, { workspaceId: "w", path: p });
    assert.deepEqual([r.ok, r.code], [false, "not_found"], p);
    assert.ok(!JSON.stringify(r).includes("SECRET") && !JSON.stringify(r).includes("LEAK"));
  }
  const ok = await s.file(paseo, { workspaceId: "w", path: "ok.md" });
  assert.equal(ok.ok, true);
});

test("PANL-14 nested values reach detail responses; a malformed file fails only itself", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-core/01-01-PLAN.md", planText());
  write(root, "phases/01-core/01-01-SUMMARY.md", summaryText("complete", ["src/a.ts", "src/b.ts"]));
  write(root, "phases/01-core/01-02-PLAN.md", "---\nphase: 01-core\nplan: 02\n---\n<objective>\nMinimal.\n</objective>\n");
  write(root, "phases/01-core/01-03-PLAN.md", "---\nwave: [1\nphase: x\n---\n");
  write(root, "phases/01-core/01-VERIFICATION.md", "---\nstatus: gaps_found\ngaps:\n  - truth: \"t\"\n    missing:\n      - m1\n---\n");
  const s = service();
  const paseo = fakeWorkspaces({ w: dir });
  const idx = await s.index(paseo, { workspaceId: "w" });
  assert.equal(idx.ok, true);
  assert.match(idx.files.find((f) => f.planId === "01-03" && f.kind === "plan").error.message, /flow/);
  const minimal = idx.files.find((f) => f.planId === "01-02");
  assert.deepEqual([minimal.wave, minimal.dependsOn, minimal.error], [null, [], null]);
  const p = await s.plan(paseo, { workspaceId: "w", planId: "01-01" });
  assert.deepEqual(p.mustHaves.artifacts, [{ path: "src/a.ts", provides: "the thing" }]);
  assert.deepEqual(p.summary.keyFiles.created, ["src/a.ts", "src/b.ts"]);
  const v = await s.file(paseo, { workspaceId: "w", path: "phases/01-core/01-VERIFICATION.md" });
  assert.deepEqual(v.frontmatter.gaps, [{ truth: "t", missing: ["m1"] }]);
  const bad = await s.plan(paseo, { workspaceId: "w", planId: "01-03" });
  assert.deepEqual([bad.ok, bad.code], [false, "parse_error"]);
  assert.match(bad.message, /01-03-PLAN\.md:2:/);
});

test("PANL-15 board: ladder column order with empty columns, wave counts, no percentages unless complete", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-done/01-01-PLAN.md", planText());
  write(root, "phases/01-done/01-01-SUMMARY.md", summaryText("complete"));
  write(root, "phases/01-done/complete.json", "{}");
  for (let i = 1; i <= 4; i += 1) write(root, `phases/02-api/02-0${i}-PLAN.md`, planText({ phase: "02-api", plan: `0${i}`, wave: 1 }));
  write(root, "phases/02-api/02-01-SUMMARY.md", summaryText("complete"));
  write(root, "phases/02-api/02-02-SUMMARY.md", summaryText(null));
  write(root, "phases/02-api/02-03-SUMMARY.md", summaryText("halted"));
  write(root, "phases/03-later/03-CONTEXT.md", "# ctx\n");
  const s = service();
  const b = await s.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.deepEqual(b.columns.map((c) => c.status), ["NOT_STARTED", "PLANNED", "IN_PROGRESS", "EXECUTED", "NEEDS_REVIEW", "COMPLETE"]);
  const byStatus = Object.fromEntries(b.columns.map((c) => [c.status, c.phases.map((p) => p.id)]));
  assert.deepEqual(byStatus, { NOT_STARTED: ["03"], PLANNED: [], IN_PROGRESS: ["02"], EXECUTED: [], NEEDS_REVIEW: [], COMPLETE: ["01"] });
  const api = b.columns[2].phases[0];
  assert.deepEqual(api.waves, [{ wave: 1, total: 4, done: 2, pct: 50 }]);
  assert.equal(api.summaries, 3);

  const capped = new PlanningService(countingLadder, { index: async (r) => ({ ...(await new PlanningIndexer().index(r)), scope: "truncated" }) });
  const t = await capped.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  const all = t.columns.flatMap((c) => c.phases);
  assert.ok(all.every((p) => p.pct === null && p.waves.every((w) => w.pct === null)));
  const none = await new PlanningService({ forWorkspace: async () => { throw new Error("GSD status module not found (x)"); } }).board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(none.unsorted.length, 3);
  assert.match(none.statusError, /not found/);
});

test("PANL-16 plan detail: tasks in order without done state; SUMMARY absent, complete or halted", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-core/01-01-PLAN.md", planText());
  write(root, "phases/01-core/01-02-PLAN.md", planText({ plan: "02", depends: ["01-01"] }));
  write(root, "phases/01-core/01-02-SUMMARY.md", summaryText("halted"));
  const s = service();
  const paseo = fakeWorkspaces({ w: dir });
  const a = await s.plan(paseo, { workspaceId: "w", planId: "01-01" });
  assert.equal(a.summary, null);
  assert.equal(a.goal, "Build the thing.");
  assert.deepEqual(a.tasks, [
    { name: "Task 1: write a", type: "auto", files: ["src/a.ts", "src/b.ts"] },
    { name: "Pick a db", type: "checkpoint:decision", files: [] },
  ]);
  assert.ok(a.tasks.every((t) => !("done" in t)));
  assert.ok(!JSON.stringify(a).includes("pct"));
  const b = await s.plan(paseo, { workspaceId: "w", planId: "01-02" });
  assert.deepEqual([b.summary.status, b.summary.done, b.dependsOn], ["halted", false, ["01-01"]]);
  const nf = await s.plan(paseo, { workspaceId: "w", planId: "09-09" });
  assert.deepEqual([nf.ok, nf.code], [false, "not_found"]);
});
