// Kit feedback 106. F1: a file git status lists as modified while both diffs are empty (autocrlf smudge, then the
// blob's LF written back) is unchanged: dropped from the transfer, reported and not committed. F2: a fix-round transfer
// refusal records the fixer worktree finished, and halt clear --resume transfers it once the stray file is gone. F3: the
// adapter writer seeds Flutter plugin-registrant globs and never replaces a list the project set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { unchangedAgainst, REGENERATED_BY_STACK, regeneratedSeed } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-execute.mjs")).href);
const { haltClear } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/gsd/halts.mjs")).href);
const { loadConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/config.mjs")).href);

const NODE = process.execPath;
const PD = ".planning/phases/03-api";
const OWNS = { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [], regenerated: [] };
const FLUTTER = [
  "windows/flutter/generated_plugin_registrant.*",
  "linux/flutter/generated_plugin*",
  "macos/Flutter/GeneratedPluginRegistrant.swift",
  "ios/Runner/GeneratedPluginRegistrant.*",
  "android/**/GeneratedPluginRegistrant.java",
];

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const gitAt = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

// Commit was LF (autocrlf off). Turn autocrlf on, check the file out so the worktree is CRLF, then write the blob's LF back.
function smudgeThenLf(cwd, rel, lf) {
  const abs = path.join(cwd, rel);
  fs.rmSync(abs, { force: true });
  const co = gitAt(cwd, ["checkout", "--", rel]);
  assert.equal(co.status, 0, co.stderr);
  assert.ok(fs.readFileSync(abs).includes(13), `${rel} did not check out as CRLF`);
  fs.writeFileSync(abs, lf);
  const st = gitAt(cwd, ["status", "--porcelain", "--", rel]);
  assert.match(st.stdout, /noise\.cc|real\.cc|gen\//, `status did not list ${rel}: ${JSON.stringify(st.stdout)}`);
  assert.equal(gitAt(cwd, ["diff", "--quiet", "--", rel]).status, 0, "plain diff was not empty");
  assert.equal(gitAt(cwd, ["diff", "--ignore-cr-at-eol", "--quiet", "--", rel]).status, 0, "cr diff was not empty");
}

function project() {
  const p = makeTempProject({
    files: { ".gitignore": ".claude/worktrees/\n", "src/a/keep.js": "k\n", "gen/noise.cc": "a\nb\n", "gen/real.cc": "r\n", [`${PD}/03-01-PLAN.md`]: "p\n" },
    overlay: { adapter: { ownership: OWNS } },
  });
  p.git("config", "core.autocrlf", "true");
  return p;
}

test("G106 F1 a status-modified file with an empty cr diff is dropped as unchanged; a real edit still refuses the transfer", async () => {
  const p = project();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  p.git("worktree", "add", "-q", "-b", "harness/r-1", ".claude/worktrees/r-1");
  const wt = path.join(p.root, ".claude/worktrees/r-1");
  smudgeThenLf(wt, "gen/noise.cc", "a\nb\n");
  assert.equal(unchangedAgainst(wt, "HEAD", "gen/noise.cc"), "unchanged");
  fs.writeFileSync(path.join(wt, "gen/real.cc"), "R\n");
  const refused = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: ".claude/worktrees/r-1", owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.json.refused.map((x) => x.path), ["gen/real.cc"]);

  p.git("worktree", "add", "-q", "-b", "harness/r-2", ".claude/worktrees/r-2");
  const wt2 = path.join(p.root, ".claude/worktrees/r-2");
  smudgeThenLf(wt2, "gen/noise.cc", "a\nb\n");
  fs.writeFileSync(path.join(wt2, "src/a/new.js"), "n\n");
  fs.writeFileSync(path.join(wt2, `${PD}/03-01-SUMMARY.md`), "---\nkey-files:\n  created: [src/a/new.js]\n---\n");
  const r = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: ".claude/worktrees/r-2", owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.dropped.map((d) => `${d.path} ${d.reason}`), ["gen/noise.cc unchanged"]);
  assert.equal(p.read("gen/noise.cc"), "a\nb\n");
  assert.equal(p.read("src/a/new.js"), "n\n");
});

test("G106 F1 the same file is eolOnly for the commit, and a real edit of another file is still unowned", async () => {
  const p = project();
  smudgeThenLf(p.root, "gen/noise.cc", "a\nb\n");
  fs.writeFileSync(p.path("gen/noise.cc"), "a\nb\n");
  // Baseline while the smudged tree is clean, then the tool writes LF.
  fs.rmSync(p.path("gen/noise.cc"), { force: true });
  p.git("checkout", "--", "gen/noise.cc");
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  fs.writeFileSync(p.path("gen/noise.cc"), "a\nb\n");
  fs.writeFileSync(p.path("gen/real.cc"), "R\n");
  const quiet = gitAt(p.root, ["diff", "--quiet", "--", "gen/noise.cc"]);
  assert.equal(quiet.status, 0);
  const r = await flow(p.root, ["owned-changes", PD], { plans: [{ id: "03-01", owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` }] });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.eolOnly, ["gen/noise.cc"]);
  assert.deepEqual(r.json.unowned, ["gen/real.cc"]);
  assert.equal(unchangedAgainst(p.root, "HEAD", "gen/noise.cc"), "unchanged");
  // A restored seed equals HEAD and status does not list it, so it is not unchanged.
  fs.rmSync(p.path("gen/noise.cc"), { force: true });
  p.git("checkout", "--", "gen/noise.cc");
  assert.equal(gitAt(p.root, ["status", "--porcelain", "--", "gen/noise.cc"]).stdout, "");
  assert.equal(unchangedAgainst(p.root, "HEAD", "gen/noise.cc"), null);
});

const RED = [NODE, "-e", "if (require('fs').existsSync('fail.flag')) { console.log('src/01-01/impl.js:1 fail'); process.exit(1); }"];
const COMMANDS = { build: [NODE, "-e", "process.exit(0)"], test: RED, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
const exec = (w, overrides, runId) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides), ...(runId ? { runId } : {}) });
const treeOf = (calls, n) => calls.find((c) => c.n === n)?.worktree ?? "";

test("G106 F2 a fix-round transfer refusal is a finished halt, and --resume transfers the fixer worktree after the stray file is removed", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" }, adapter: { commands: COMMANDS } } });
  const first = await exec(w, {
    "exec-01-01": async (p, o, n, calls) => {
      const v = await executor(w)(p, o, n, calls);
      w.write("fail.flag", "x");
      return v;
    },
    "fix-01-01-1": async (p, o, n, calls) => {
      const base = treeOf(calls, n);
      w.write(`${base}/src/01-01/impl.js`, "fixed\n");
      w.write(`${base}/notes/stray.txt`, "stray\n");
      fs.rmSync(path.join(w.root, "fail.flag"), { force: true });
      return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
    },
  });
  assert.equal(first.result.status, "needs-owner", JSON.stringify(first.result));
  assert.equal(first.result.stage, "Gate");
  assert.match(first.result.reason, /ph gsd halt clear 01 --plan <id> --resume --reason <answer>/);
  assert.match(first.result.answer.command, /ph gsd halt clear 01 --plan <id> --resume --reason <answer>/);
  assert.match(first.result.options[0], /--resume/);
  const halt = JSON.parse(w.read(`${PHASE_DIR}/01-01-HALT.json`));
  assert.equal(halt.finished, true);
  assert.ok(halt.worktree, "the fixer worktree is on the halt");
  assert.match(halt.reason, /notes\/stray\.txt \(outside owns\)/);
  assert.equal(fs.existsSync(path.join(w.root, halt.worktree, `${PHASE_DIR}/01-01-SUMMARY.md`)), true);
  fs.rmSync(path.join(w.root, halt.worktree, "notes/stray.txt"), { force: true });
  const cleared = haltClear({ codeRoot: w.root, cfg: loadConfig(w.root), env: {} }, { dir: path.join(w.root, PHASE_DIR), padded: "01" }, "01-01", "the stray file was removed", true);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  assert.equal(cleared.json.resume, true);
  assert.equal(fs.existsSync(path.join(w.root, PHASE_DIR, "01-01-HALT.json")), false);
  const second = await exec(w, {}, "wf_20261024-120000_g106");
  assert.equal(second.result.status, "executed", JSON.stringify(second.result));
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-01").length, 0, "no executor: the finished worktree was transferred");
  assert.ok(second.logs.some((l) => l.includes(`halt cleared with --resume; the finished worktree ${halt.worktree} is transferred`)), second.logs.join("\n"));
  assert.equal(w.read("src/01-01/impl.js"), "fixed\n");
});

test("G106 F2 an executor transfer refusal is not a finished halt and does not offer --resume", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  const r = await exec(w, {
    "exec-01-01": async (p, o, n, calls) => {
      const v = await executor(w)(p, o, n, calls);
      w.write(`${treeOf(calls, n)}/notes/stray.txt`, "stray\n");
      return v;
    },
  });
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Execute");
  assert.doesNotMatch(r.result.answer.command, /--resume/);
  const halt = JSON.parse(w.read(`${PHASE_DIR}/01-01-HALT.json`));
  assert.equal(halt.finished, undefined);
  assert.match(halt.reason, /transfer refused/);
  assert.throws(() => haltClear({ codeRoot: w.root, cfg: loadConfig(w.root), env: {} }, { dir: path.join(w.root, PHASE_DIR), padded: "01" }, "01-01", "try resume", true), /no finished executor worktree/);
  assert.equal(fs.existsSync(path.join(w.root, PHASE_DIR, "01-01-HALT.json")), true);
});

test("G106 F3 regeneratedSeed is the Flutter registrant globs, and a project's own list is kept", () => {
  assert.deepEqual(REGENERATED_BY_STACK.flutter, FLUTTER);
  assert.deepEqual(regeneratedSeed("flutter"), FLUTTER);
  assert.deepEqual(regeneratedSeed("Flutter"), FLUTTER);
  for (const stack of ["dart", "js", "python", "go", "rust", "jvm", ""]) assert.deepEqual(regeneratedSeed(stack), [], stack);
  assert.deepEqual(regeneratedSeed("flutter", []), []);
  assert.deepEqual(regeneratedSeed("flutter", ["gen/**"]), ["gen/**"]);
  const doc = fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/harness/references/kit-adapter.md"), "utf8");
  for (const glob of FLUTTER) assert.ok(doc.includes(glob), glob);
  assert.match(doc, /do not replace a list the project already set, including an empty one/);
  assert.match(doc, /shipped default stays `\[\]`/);
  const init = fs.readFileSync(path.join(SHIP_DIR, "..", "user/skills/kit-init/SKILL.md"), "utf8");
  assert.match(init, /adapter\.ownership\.regenerated/);
  assert.match(init, /keeps a list the project already set/);
});
