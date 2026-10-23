// Kit feedback #90 (fb7 V1A): a halt record of an older kit names no worktree, so `ph gsd halt clear --resume` looks the halted
// executor's tree up: the run journal's executor call (worktree.path), else the one harness worktree of the run holding the plan's
// SUMMARY; it accepts the tree when the SUMMARY is there. `kit.mjs update` lists the open halts --resume will not take.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { createWorktree } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { gsd as runGsdIn, project as gsdProject } from "../gsd-core/fixture.mjs";
import { defaultKitFiles, makeKit, makeProject, runKit } from "../install/helpers.mjs";

const PD = ".planning/phases/01-core";
const RUN = "wf_20261023-231612_750d";
const OLD = { plan: "01-02", reason: "owner decision needed: contradictory inherited assertions", runId: RUN };

function oldHaltProject() {
  const p = gsdProject({ files: { [`${PD}/01-02-HALT.json`]: JSON.stringify(OLD), ".gitignore": ".claude/worktrees/\n_workspace/\n" } });
  return p;
}
// A harness worktree of the run, with the plan's SUMMARY in it when `summary`.
async function tree(p, n, { summary = true } = {}) {
  const wt = await createWorktree(p.root, loadConfig(p.root), `${RUN}-${n}`);
  if (summary) {
    fs.mkdirSync(path.join(wt.path, PD), { recursive: true });
    fs.writeFileSync(path.join(wt.path, PD, "01-02-SUMMARY.md"), "done\n");
  }
  return wt.path;
}
// The journal line the engine writes for the executor call (an absolute worktree path, as the runtime records it).
function journal(p, wtPath, label = "exec-01-02") {
  const entry = { n: 1, kind: "agent", label, status: "ok", reason: null, worktree: { top: p.root, path: wtPath, branch: `harness/${path.basename(wtPath)}`, name: path.basename(wtPath), lease: null } };
  p.write(`_workspace/_runs/${RUN}/journal.jsonl`, `${JSON.stringify({ n: 1, kind: "agent", label, status: "start" })}\n${JSON.stringify(entry)}\n`);
}
const resume = (p) => runGsdIn(p, ["halt", "clear", "1", "--plan", "01-02", "--reason", "the work stands", "--resume"]);
const answers = (p) => p.readJson(`${PD}/halt-answers.json`);

test("V1A 90 an older halt record without a worktree is resumed from the tree the run journal names", async () => {
  const p = oldHaltProject();
  await tree(p, 1, { summary: false }); // another executor of the run, without this plan's SUMMARY
  const wt = await tree(p, 2);
  journal(p, wt);
  const r = await resume(p);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.resume, r.json.worktree, r.json.found], [true, `.claude/worktrees/${RUN}-2`, "journal"]);
  assert.deepEqual(answers(p).map((a) => [a.plan, a.resume, a.haltWorktree, a.haltRunId]), [["01-02", true, `.claude/worktrees/${RUN}-2`, RUN]]);
  assert.equal(fs.existsSync(p.path(`${PD}/01-02-HALT.json`)), false);
});

test("V1A 90 without a journal the one harness worktree of the run that holds the SUMMARY is taken", async () => {
  const p = oldHaltProject();
  await tree(p, 1, { summary: false });
  await tree(p, 3);
  const r = await resume(p);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.worktree, r.json.found], [`.claude/worktrees/${RUN}-3`, "worktrees"]);
});

test("V1A 90 refused, record kept: no tree holds the SUMMARY, two trees of the run do, or the journal's tree is gone", async () => {
  const none = oldHaltProject();
  await tree(none, 1, { summary: false });
  const r1 = await resume(none);
  assert.notEqual(r1.code, 0);
  assert.match(r1.json.error, /no finished executor worktree .*no single tree of run wf_20261023-231612_750d holds \.planning\/phases\/01-core\/01-02-SUMMARY\.md/);
  assert.ok(fs.existsSync(none.path(`${PD}/01-02-HALT.json`)), "a refused clear keeps the record");

  const two = oldHaltProject();
  await tree(two, 1);
  await tree(two, 2);
  const r2 = await resume(two);
  assert.notEqual(r2.code, 0);
  assert.match(r2.json.error, /no single tree of run/);

  const gone = oldHaltProject();
  journal(gone, path.join(gone.root, ".claude", "worktrees", `${RUN}-9`));
  const r3 = await resume(gone);
  assert.notEqual(r3.code, 0);
  assert.match(r3.json.error, /no finished executor worktree/);

  const nothing = oldHaltProject();
  const r4 = await resume(nothing);
  assert.match(r4.json.error, /neither the journal of run wf_20261023-231612_750d nor the harness worktrees name one/);
  // Without --resume the older record is cleared as before.
  const plain = await runGsdIn(nothing, ["halt", "clear", "1", "--plan", "01-02", "--reason", "redo"]);
  assert.equal(plain.code, 0, JSON.stringify(plain.json));
});

test("V1A 90 a record marked finished: false is refused as before, with or without a worktree field", async () => {
  const p = gsdProject({ files: { [`${PD}/01-02-HALT.json`]: JSON.stringify({ ...OLD, finished: false }) } });
  const r = await resume(p);
  assert.notEqual(r.code, 0);
  assert.match(r.json.error, /halt clear --resume: the halt of 01-02 has no finished executor worktree \(owner decision needed/);
});

test("V1A 90 kit.mjs update lists the open halts that halt clear --resume will not take, and only those", async () => {
  const kit = makeKit({ files: defaultKitFiles() });
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const wt = ".claude/worktrees/wf_x-2";
  fs.mkdirSync(path.join(p.root, wt), { recursive: true });
  p.write(".planning/phases/03-shell/03-08-HALT.json", JSON.stringify({ plan: "03-08", reason: "pick one", runId: RUN }));
  p.write(".planning/phases/03-shell/03-09-HALT.json", JSON.stringify({ plan: "03-09", reason: "pick", runId: "wf_x", worktree: wt, finished: true }));
  p.write(".planning/phases/03-shell/03-10-HALT.json", JSON.stringify({ plan: "03-10", reason: "executor ended abnormally", runId: "wf_x", worktree: wt }));
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 0, r.stdout);
  const notes = r.out.filter((l) => l.startsWith("note open halt"));
  assert.equal(notes.length, 2, r.stdout);
  assert.match(notes[0], /^note open halt 03-08 \(\.planning\/phases\/03-shell\): ph gsd halt clear --resume will not take it: the halt of 03-08 has no finished executor worktree .*; answer it without --resume and the plan runs again$/);
  assert.match(notes[1], /^note open halt 03-10 .*has no finished executor worktree \(executor ended abnormally\)/);
});
