// The planning panel's bundled ladder against the kit's own `roadmap analyze` (PANL-15, CR-PNL-02..06).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PlanningService } from "../../plugins/planning-panel/server/service.ts";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { analyze } from "../../ship/.agents/harness/gsd/phases.mjs";
import { findPhase } from "../../ship/.agents/harness/gsd/planning.mjs";
import { fingerprint } from "../../ship/.agents/harness/gsd/status.mjs";
import { fakeWorkspaces, makeWorkspace, planText, summaryText, write } from "./planning-fixtures.mjs";

const section = (n, name) => `### Phase ${n}: ${name}\n**Goal**: g\n**Depends on**: None\n**Requirements**: None\n**Success Criteria**:\n1. ok\n`;

// Phase 1 complete (verified over src/app.ts), 2 an empty directory, 3 only in ROADMAP, 4 planned with retired
// copies under superseded/, 5 a directory ROADMAP does not list whose only SUMMARY cannot be parsed.
function fixture() {
  const { dir, root } = makeWorkspace();
  write(root, "ROADMAP.md", `# Roadmap\n\n${[section(1, "done"), section(2, "empty"), section(3, "future"), section(4, "planned")].join("\n")}`);
  write(dir, "src/app.ts", "export const a = 1;\n");
  write(root, "phases/01-done/01-01-PLAN.md", planText({ phase: "01-done" }));
  write(root, "phases/01-done/01-01-SUMMARY.md", summaryText("complete"));
  const digest = fingerprint(dir, findPhase(dir, "1"), ["src/app.ts"]).covered_digest;
  const verification = `---\nphase: 01-done\nstatus: passed\ncovered_files: [src/app.ts]\ncovered_digest: "${digest}"\n---\n# Verification\n`;
  write(root, "phases/01-done/01-VERIFICATION.md", verification);
  write(root, "phases/01-done/complete.json", JSON.stringify({ verification_sha: textDigest(verification) }));
  fs.mkdirSync(path.join(root, "phases", "02-empty"), { recursive: true });
  write(root, "phases/04-planned/04-01-PLAN.md", planText({ phase: "04-planned" }));
  write(root, "phases/04-planned/superseded/04-01-SUMMARY.md", summaryText("complete"));
  write(root, "phases/04-planned/superseded/04-02-PLAN.md", planText({ phase: "04-planned", plan: "02" }));
  write(root, "phases/04-planned/superseded/04-02-SUMMARY.md", summaryText("complete"));
  write(root, "phases/05-extra/05-01-PLAN.md", planText({ phase: "05-extra" }));
  write(root, "phases/05-extra/05-01-SUMMARY.md", "---\nstatus: [complete\n---\n");
  return { dir, root };
}

const kitStatuses = (dir) => Object.fromEntries(analyze({ codeRoot: dir, cfg: loadKitConfig() }).phases.map((p) => [p.number, p.status]));

async function board(service, dir) {
  const b = await service.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(b.ok, true, b.message);
  assert.equal(b.statusError, null);
  return Object.fromEntries(b.columns.flatMap((c) => c.phases).map((p) => [p.id, p]));
}

test("PANL-15 roster: roadmap-only and empty phases are on the board with the statuses of roadmap analyze (CR-PNL-04)", async () => {
  const { dir } = fixture();
  const phases = await board(new PlanningService(), dir);
  const kit = kitStatuses(dir);
  assert.deepEqual(Object.keys(kit), ["1", "2", "3", "4"]);
  for (const [id, status] of Object.entries(kit)) assert.equal(phases[id]?.status, status, `phase ${id}`);
  assert.deepEqual([kit["1"], kit["2"], kit["3"], kit["4"]], ["COMPLETE", "NOT_STARTED", "NOT_STARTED", "PLANNED"]);
  assert.deepEqual([phases["2"].dir, phases["3"].dir, phases["3"].name], ["phases/02-empty", null, "future"]);
  assert.equal(phases["05"].dir, "phases/05-extra", "a directory ROADMAP does not list is kept");
  const idx = await new PlanningService().index(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(idx.phases.length, 5, "stats count every phase, so 1 of 5 is never 100%");
});

test("PANL-15 a changed covered source file turns COMPLETE into NEEDS_REVIEW on the next poll (CR-PNL-03)", async () => {
  const { dir } = fixture();
  const service = new PlanningService();
  assert.equal((await board(service, dir))["1"].status, "COMPLETE");
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const a = 2; // changed\n", "utf8");
  assert.equal(kitStatuses(dir)["1"], "NEEDS_REVIEW");
  assert.equal((await board(service, dir))["1"].status, "NEEDS_REVIEW");
});

test("PANL-15 superseded plans and summaries are not live inventory (CR-PNL-05)", async () => {
  const { dir } = fixture();
  const service = new PlanningService();
  const p4 = (await board(service, dir))["4"];
  assert.deepEqual([p4.plans, p4.summaries, p4.done, p4.pct], [1, 0, 0, 0]);
  const plan = await service.plan(fakeWorkspaces({ w: dir }), { workspaceId: "w", planId: "04-01" });
  assert.equal(plan.summary, null, "a retired SUMMARY never attaches to the active plan");
  const idx = await service.index(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  const retired = idx.files.filter((f) => f.path.includes("/superseded/"));
  assert.equal(retired.length, 3, "still browsable in Files");
  assert.ok(retired.every((f) => f.planId === null));
});

test("PANL-15 an unparseable SUMMARY is neither done nor a percentage (CR-PNL-06)", async () => {
  const { dir } = fixture();
  const p5 = (await board(new PlanningService(), dir))["05"];
  assert.deepEqual([p5.plans, p5.done, p5.pct, p5.unparsed], [1, 0, null, ["phases/05-extra/05-01-SUMMARY.md"]]);
  assert.deepEqual(p5.waves, [{ wave: 1, total: 1, done: 0, pct: null }]);
});

test("PANL-05 polling never imports modules from the workspace (CR-PNL-02)", async () => {
  const { dir } = fixture();
  const sentinel = `__ui_planning_${process.pid}`;
  for (const name of ["status.mjs", "planning.mjs"]) write(dir, `.agents/harness/gsd/${name}`, `globalThis.${sentinel} = "${name}";\nexport const phaseStatus = () => ({ status: "COMPLETE" });\nexport const findPhase = () => null;\n`);
  const phases = await board(new PlanningService(), dir);
  assert.equal(globalThis[sentinel], undefined);
  assert.equal(phases["4"].status, "PLANNED");
});
