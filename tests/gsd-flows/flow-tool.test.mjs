// Unit tests of the shell-side flow helper (.agents/workflows/lib/gsd-flow.mjs) on temp git projects.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const lines = (n, prefix = "line") => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n");
const sevenDocs = (extra = {}) => Object.fromEntries(["STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING", "CONCERNS"].map((d) => [`.planning/codebase/${d}.md`, extra[d] ?? `# ${d}\n${lines(25)}\n`]));

test("GSDF-05 map check needs 7 docs of 20+ lines; secrets scan names file, line and kind only", async () => {
  const p = makeTempProject({ files: sevenDocs({ TESTING: "# short\n", CONCERNS: `# C\n${lines(22)}\nkey AKIAABCDEFGHIJKLMNOP here\n` }) });
  const mc = await flow(p.root, ["map-check"]);
  assert.equal(mc.code, 1);
  assert.deepEqual(mc.json.problems, [".planning/codebase/TESTING.md: 2 lines < 20"]);
  const sc = await flow(p.root, ["secrets", ".planning/codebase/CONCERNS.md", ".planning/codebase/STACK.md"]);
  assert.equal(sc.code, 1);
  assert.deepEqual(sc.json.findings, [{ file: ".planning/codebase/CONCERNS.md", line: 24, kind: "aws-access-key" }]);
  assert.doesNotMatch(JSON.stringify(sc.json), /AKIA/);
  const jwt = makeTempProject({ files: { "a.md": "tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl\n-----BEGIN RSA PRIVATE KEY-----\n" } });
  assert.deepEqual((await flow(jwt.root, ["secrets", "a.md"])).json.findings.map((f) => f.kind), ["jwt", "private-key"]);
});

test("GSDF-06 stamp writes last_mapped_commit; drift warns at the threshold, skips without a baseline, never fails", async () => {
  const p = makeTempProject({ files: { ...sevenDocs(), "src/a.js": "a\n" } });
  assert.equal((await flow(p.root, ["drift", "3"])).json.status, "skipped");
  const st = await flow(p.root, ["stamp"]);
  assert.equal(st.json.stamped.length, 7);
  assert.match(p.read(".planning/codebase/STACK.md"), new RegExp(`^---\\nlast_mapped_commit: ${st.json.commit}\\nlast_mapped_at: `));
  p.git("add", "-A"); p.git("commit", "-qm", "map");
  for (const d of ["x", "y", "z"]) p.write(`${d}/f.txt`, "n\n");
  const dr = await flow(p.root, ["drift", "3"]);
  assert.equal(dr.json.status, "drift");
  assert.deepEqual(dr.json.newDirs, ["x", "y", "z"]);
  assert.equal((await flow(p.root, ["drift", "4"])).json.status, "ok");
  for (const f of Object.keys(sevenDocs())) p.write(f, "---\nlast_mapped_commit: 0000000000000000000000000000000000000000\n---\n");
  const gone = await flow(p.root, ["drift", "3"]);
  assert.equal(gone.json.status, "skipped");
  assert.equal(gone.code, 0);
});

test("GSDF-09 summary self-heal writes SUMMARY.md from a full inline reply, fails on a bare confirmation", async () => {
  const p = makeTempProject();
  const bare = await flow(p.root, ["summary-heal"], "done");
  assert.equal(bare.code, 1);
  assert.equal(fs.existsSync(p.path(".planning/research/SUMMARY.md")), false);
  const doc = "Here it is:\n# Project Research Summary\n## Executive Summary\nx\n## Key Findings\ny\n## Implications for Roadmap\nz\n";
  const healed = await flow(p.root, ["summary-heal"], doc);
  assert.deepEqual([healed.code, healed.json.healed], [0, true]);
  assert.match(p.read(".planning/research/SUMMARY.md"), /^# Project Research Summary/);
  p.write(".planning/research/SUMMARY.md", "part\n<!-- gsd:write-continue -->\n");
  assert.equal((await flow(p.root, ["summary-heal"], "no")).code, 1);
});

test("GSDF-11 blocking anti-pattern rows need three written answers", async () => {
  const p = makeTempProject({ files: { [`${PD}/.continue-here.md`]: "# h\n\n## Critical Anti-Patterns\n\n| Pattern | Description | Severity | Prevention Mechanism |\n|---|---|---|---|\n| silent retry | x | blocking | y |\n| style | x | advisory | y |\n\n## Next\n" } });
  const r = await flow(p.root, ["anti-patterns", PD]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.unanswered, ["silent retry"]);
  p.writeJson(`${PD}/.continue-here.answers.json`, { "silent retry": { what: "a", manifested: "b", prevention: "c" } });
  assert.equal((await flow(p.root, ["anti-patterns", PD])).code, 0);
  assert.equal((await flow(p.root, ["anti-patterns", ".planning/phases/04-none"])).code, 0);
});

test("GSDF-38 safe-resume gate names incomplete-plan edits and unauthorized paths; completed plans pass", async () => {
  const p = makeTempProject({ files: { "src/a/x.js": "x\n", "other.txt": "o\n", [`${PD}/03-01-PLAN.md`]: "p\n" } });
  assert.equal((await flow(p.root, ["baseline", PD])).json.kept, false);
  assert.equal((await flow(p.root, ["baseline", PD])).json.kept, true);
  p.write("src/a/x.js", "edited\n");
  p.write("src/a/new.js", "new\n");
  const plans = [{ id: "03-01", owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md`, complete: false }];
  const r = await flow(p.root, ["resume-gate", PD], { plans });
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((x) => `${x.kind} ${x.path}`).sort(), ["incomplete plan changed src/a/new.js", "incomplete plan changed src/a/x.js"]);
  assert.equal((await flow(p.root, ["resume-gate", PD], { plans: [{ ...plans[0], complete: true }] })).code, 0);
  p.write("other.txt", "changed\n");
  const u = await flow(p.root, ["resume-gate", PD], { plans: [{ ...plans[0], complete: true }] });
  assert.deepEqual(u.json.problems.map((x) => x.kind), ["unauthorized path"]);
  p.git("commit", "-qam", "foreign");
  const h = await flow(p.root, ["resume-gate", PD], { plans: [{ ...plans[0], complete: true }] });
  assert.ok(h.json.problems.some((x) => x.kind === "head-moved"));
});

test("GSDF-40 cwd guard refuses an agent worktree directory and harness/* branches", async () => {
  const p = makeTempProject();
  const guard = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-execute.mjs")).href);
  fs.mkdirSync(p.path(".claude/worktrees/x"), { recursive: true });
  const inside = guard.cwdGuard(p.root, ".claude/worktrees", p.path(".claude/worktrees/x"));
  assert.equal(inside.ok, false);
  assert.match(inside.problems[0], /inside a ph agent worktree/);
  assert.ok(Array.isArray(inside.dirty) && Array.isArray(inside.stranded));
  assert.equal(guard.cwdGuard(p.root, ".claude/worktrees", p.root).ok, true);
  p.git("switch", "-qc", "harness/wf-1");
  assert.match(guard.cwdGuard(p.root, ".claude/worktrees", p.root).problems[0], /agent branch harness\/wf-1/);
});

function worktreeFixture() {
  const p = makeTempProject({ files: { "src/a/keep.js": "k\n", "src/b/old.js": "o\n", "dirty.txt": "d\n", [`${PD}/03-01-PLAN.md`]: "p\n" } });
  p.write("dirty.txt", "local edit\n");
  const wt = (name) => { p.git("worktree", "add", "-q", "-b", `harness/${name}`, `.claude/worktrees/${name}`); return `.claude/worktrees/${name}`; };
  return { p, wt };
}

test("GSDF-41 an undeclared deletion is refused while another plan's transfer lands", async () => {
  const { p, wt } = worktreeFixture();
  await flow(p.root, ["baseline", PD]);
  const w1 = wt("r-1"), w2 = wt("r-2");
  fs.writeFileSync(path.join(p.root, w1, "src/a/keep.js"), "plan1\n");
  fs.rmSync(path.join(p.root, w2, "src/b/old.js"));
  const ok = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: w1, owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` });
  const bad = await flow(p.root, ["transfer", PD], { plan: "03-02", worktree: w2, owns: ["Path:src/b/"], summary: `${PD}/03-02-SUMMARY.md`, files_deleted: [] });
  assert.equal(ok.code, 0);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.refused[0].reason, "deletion not declared in files_deleted");
  assert.equal(p.read("src/b/old.js"), "o\n");
  assert.equal(fs.existsSync(path.join(p.root, w2)), true);
});

test("GSDF-94 transfers copy owned files and SUMMARY in plan order, refuse out-of-owns files and leave unrelated dirty files alone", async () => {
  const { p, wt } = worktreeFixture();
  await flow(p.root, ["baseline", PD]);
  const w1 = wt("r-1"), w2 = wt("r-2");
  fs.writeFileSync(path.join(p.root, w1, "src/a/new.js"), "n1\n");
  fs.mkdirSync(path.join(p.root, w1, PD), { recursive: true });
  fs.writeFileSync(path.join(p.root, w1, `${PD}/03-01-SUMMARY.md`), "---\nkey-files:\n  created: [src/a/new.js]\n---\n");
  fs.writeFileSync(path.join(p.root, w2, "src/a/intruder.js"), "x\n");
  const r1 = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: w1, owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(r1.code, 0);
  assert.equal(p.read("src/a/new.js"), "n1\n");
  assert.deepEqual(p.readJson(`${PD}/transfers/03-01.json`).files.map((f) => f.path).sort(), [`${PD}/03-01-SUMMARY.md`, "src/a/new.js"]);
  const r2 = await flow(p.root, ["transfer", PD], { plan: "03-02", worktree: w2, owns: ["Path:src/b/"], summary: `${PD}/03-02-SUMMARY.md` });
  assert.equal(r2.json.refused[0].reason, "outside owns");
  assert.equal(fs.existsSync(p.path("src/a/intruder.js")), false);
  assert.equal(p.read("dirty.txt"), "local edit\n");
  assert.equal((await flow(p.root, ["spot-check", `${PD}/03-01-SUMMARY.md`])).code, 0);
});

test("GSDF-43 SUMMARY spot-check fails on a missing key file", async () => {
  const p = makeTempProject({ files: { [`${PD}/03-01-SUMMARY.md`]: "---\nkey-files:\n  created:\n    - src/missing.js\n  modified: [README.md]\n---\n", "README.md": "r\n" } });
  const r = await flow(p.root, ["spot-check", `${PD}/03-01-SUMMARY.md`]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.missing, ["src/missing.js"]);
});
