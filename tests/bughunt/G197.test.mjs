// G197: the planning panel reports an unreadable phase as not started, a plan hidden by an unreadable directory as
// not found, a same-size rewrite with its mtime restored as still COMPLETE, a 1 MiB cut plan as complete, and a failed
// board request as nothing at all.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { PlanningIndexer } from "../../plugins/planning-panel/server/indexer.ts";
import { PlanningService } from "../../plugins/planning-panel/server/service.ts";
import { planningPlanRpc } from "../../plugins/planning-panel/shared/planning.ts";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { analyze } from "../../ship/.agents/harness/gsd/phases.mjs";
import { findPhase } from "../../ship/.agents/harness/gsd/planning.mjs";
import { fingerprint } from "../../ship/.agents/harness/gsd/status.mjs";
import { KIT_DIR } from "../helpers/temp.mjs";
import { fakeWorkspaces, makeWorkspace, planText, summaryText, write } from "../ui/planning-fixtures.mjs";

const PANEL = path.join(KIT_DIR, "plugins", "planning-panel");

const kitStatuses = (dir) => Object.fromEntries(analyze({ codeRoot: dir, cfg: loadKitConfig() }).phases.map((p) => [p.number, p.status]));

async function board(service, dir) {
  const b = await service.board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(b.ok, true, b.message);
  return Object.fromEntries([...b.columns.flatMap((c) => c.phases), ...b.unsorted].map((p) => [p.id, p]));
}

// Phase 1 COMPLETE over src/app.ts (20 bytes); phase 2 is a ROADMAP phase whose directory has one plan.
function fixture() {
  const { dir, root } = makeWorkspace();
  write(root, "ROADMAP.md", "# Roadmap\n\n### Phase 1: done\n\n### Phase 2: hidden\n");
  write(dir, "src/app.ts", "export const a = 1;\n");
  write(root, "phases/01-done/01-01-PLAN.md", planText({ phase: "01-done" }));
  write(root, "phases/01-done/01-01-SUMMARY.md", summaryText("complete"));
  const digest = fingerprint(dir, findPhase(dir, "1"), ["src/app.ts"]).covered_digest;
  const verification = `---\nphase: 01-done\nstatus: passed\ncovered_files: [src/app.ts]\ncovered_digest: "${digest}"\n---\n# Verification\n`;
  write(root, "phases/01-done/01-VERIFICATION.md", verification);
  write(root, "phases/01-done/complete.json", JSON.stringify({ verification_sha: textDigest(verification) }));
  write(root, "phases/02-hidden/02-01-PLAN.md", planText({ phase: "02-hidden", plan: "01" }));
  return { dir, root };
}

// Makes listing one directory fail with EACCES, as a denied read-list does; the node:fs named export the ladder
// imports is resynced so the patch is seen. Returns the restore function.
function denyListing(dir) {
  const real = fs.readdirSync;
  fs.readdirSync = (p, ...rest) => {
    if (String(p) === dir) throw Object.assign(new Error(`EACCES: permission denied, scandir '${dir}'`), { code: "EACCES" });
    return real(p, ...rest);
  };
  syncBuiltinESMExports();
  return () => {
    fs.readdirSync = real;
    syncBuiltinESMExports();
  };
}

test("G197 a phase whose directory cannot be listed has an unknown status, not NOT_STARTED", async () => {
  const { dir, root } = fixture();
  const restore = denyListing(path.join(root, "phases", "02-hidden"));
  try {
    const phases = await board(new PlanningService(), dir);
    assert.equal(phases["2"].status, null, "unknown, so the board puts it in the unsorted column");
    assert.match(phases["2"].name, /hidden/);
    const b = await new PlanningService().board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
    assert.match(b.statusError, /^phase 2: EACCES/);
  } finally {
    restore();
  }
});

test("G197 a plan in a directory that cannot be listed is unreadable, not not_found", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-a/01-01-PLAN.md", planText());
  write(root, "phases/02-b/02-01-PLAN.md", planText({ phase: "02-b", plan: "01" }));
  const real = (d) => fs.promises.readdir(d, { withFileTypes: true });
  const failing = async (d) => {
    if (d.endsWith("02-b")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    return real(d);
  };
  const service = new PlanningService(undefined, new PlanningIndexer(failing));
  const r = await service.plan(fakeWorkspaces({ w: dir }), { workspaceId: "w", planId: "02-01" });
  assert.deepEqual([r.ok, r.code], [false, "unreadable"]);
  assert.match(r.message, /phases\/02-b/);
  const found = await service.plan(fakeWorkspaces({ w: dir }), { workspaceId: "w", planId: "01-01" });
  assert.equal(found.ok, true, "a plan the partial listing has is still shown");
});

test("G197 a same-size rewrite with its mtime restored does not keep a phase COMPLETE", async () => {
  const { dir } = fixture();
  // A whole-second mtime survives a utimes round trip exactly on every platform, so the restore below matches.
  const file = path.join(dir, "src", "app.ts");
  const stamp = new Date("2026-01-01T00:00:00Z");
  fs.utimesSync(file, stamp, stamp);
  const service = new PlanningService();
  assert.equal((await board(service, dir))["1"].status, "COMPLETE");
  fs.writeFileSync(file, "export const a = 2;\n", "utf8");
  fs.utimesSync(file, stamp, stamp);
  assert.equal(fs.statSync(file).size, 20);
  assert.equal(fs.statSync(file).mtimeMs, stamp.getTime());
  assert.equal(kitStatuses(dir)["1"], "NEEDS_REVIEW");
  assert.equal((await board(service, dir))["1"].status, "NEEDS_REVIEW");
});

test("G197 plan detail says when the 1 MiB read cap cut the plan or its summary", async () => {
  const { dir, root } = makeWorkspace();
  write(root, "phases/01-core/01-01-PLAN.md", planText());
  write(root, "phases/01-core/01-02-PLAN.md", planText({ plan: "02", body: "x".repeat(1024 * 1024 + 10) }));
  const paseo = fakeWorkspaces({ w: dir });
  const s = new PlanningService();
  const whole = await s.plan(paseo, { workspaceId: "w", planId: "01-01" });
  assert.equal(whole.truncated, false);
  const cut = await s.plan(paseo, { workspaceId: "w", planId: "01-02" });
  assert.equal(cut.ok, true);
  assert.equal(cut.truncated, true);
  planningPlanRpc.output.parse(cut);
});

test("G197 the Roadmap shows a board request that fails, with or without earlier data", () => {
  const panel = fs.readFileSync(path.join(PANEL, "client", "panel.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(panel, /boardQ\.isError \?/);
});
