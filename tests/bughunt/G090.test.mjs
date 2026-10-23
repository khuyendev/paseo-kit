// G090 (kit-feedback 26): a tool-regenerated path, or a tracked file that differs only in line endings, outside a plan's
// owns is dropped from the worktree transfer with a log line; any other path outside owns still refuses it. The executor
// brief makes scratch-file cleanup a plain rule.
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
const { loadConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/config.mjs")).href);
const PD = ".planning/phases/03-api";
const OWNS = { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [] };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const inWorktree = (p, wt, ...args) => spawnSync("git", args, { cwd: path.join(p.root, wt), encoding: "utf8", windowsHide: true });

// A committed project whose tracked files include a generated file; `wt(name)` adds an agent worktree of HEAD.
function worktreeFixture(regenerated = ["gen/**"]) {
  const p = makeTempProject({
    files: { ".gitignore": ".claude/worktrees/\n", "src/a/keep.js": "k\n", "src/b/eol.js": "x\ny\n", "src/b/ws.js": "x\ny\n", "src/b/real.js": "r\n", "gen/reg.cc": "a\nb\n", [`${PD}/03-01-PLAN.md`]: "p\n" },
    overlay: { adapter: { ownership: { ...OWNS, regenerated } } },
  });
  const wt = (name) => { p.git("worktree", "add", "-q", "-b", `harness/${name}`, `.claude/worktrees/${name}`); return `.claude/worktrees/${name}`; };
  return { p, wt };
}

test("G090 a regenerated path and a line-endings-only change outside owns are dropped; the main tree keeps its version", async () => {
  const { p, wt } = worktreeFixture();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  const w1 = wt("r-1");
  p.write(`${w1}/gen/reg.cc`, "a\r\nb\r\n");
  p.write(`${w1}/gen/new.cc`, "n\n");
  p.write(`${w1}/src/b/eol.js`, "x\r\ny\r\n");
  p.write(`${w1}/src/a/new.js`, "n1\n");
  p.write(`${w1}/${PD}/03-01-SUMMARY.md`, "---\nkey-files:\n  created: [src/a/new.js]\n---\n");
  const r = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: w1, owns: ["Path:src/a/"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.dropped.map((d) => `${d.path} ${d.reason}`).sort(), ["gen/new.cc regenerated", "gen/reg.cc regenerated", "src/b/eol.js line endings only"]);
  assert.equal(p.read("gen/reg.cc"), "a\nb\n");
  assert.equal(fs.existsSync(p.path("gen/new.cc")), false);
  assert.equal(p.read("src/b/eol.js"), "x\ny\n");
  assert.equal(p.read("src/a/new.js"), "n1\n");
  const record = p.readJson(`${PD}/transfers/03-01.json`);
  assert.deepEqual(record.dropped, r.json.dropped);
  assert.deepEqual(record.files.map((f) => f.path).sort(), [`${PD}/03-01-SUMMARY.md`, "src/a/new.js"]);
});

test("G090 a whitespace edit, a real edit, a scratch file and a staged empty file outside owns still refuse the transfer", async () => {
  const { p, wt } = worktreeFixture();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  const w2 = wt("r-2");
  p.write(`${w2}/src/b/ws.js`, "x  \ny\n");
  p.write(`${w2}/src/b/real.js`, "R\n");
  p.write(`${w2}/scratch.txt`, "s\n");
  p.write(`${w2}/staged-empty.txt`, "");
  assert.equal(inWorktree(p, w2, "add", "staged-empty.txt").status, 0);
  const r = await flow(p.root, ["transfer", PD], { plan: "03-02", worktree: w2, owns: ["Path:src/a/"], summary: `${PD}/03-02-SUMMARY.md` });
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.refused.map((x) => x.path).sort(), ["scratch.txt", "src/b/real.js", "src/b/ws.js", "staged-empty.txt"]);
  assert.ok(r.json.refused.every((x) => x.reason === "outside owns"));
  assert.equal(p.read("src/b/ws.js"), "x\ny\n");
  assert.equal(fs.existsSync(p.path("scratch.txt")), false);
  assert.equal(fs.existsSync(p.path("staged-empty.txt")), false);
  assert.equal(fs.existsSync(p.path(w2)), true);
});

test("G090 a regenerated path the plan owns is copied like any owned change", async () => {
  const { p, wt } = worktreeFixture();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  const w3 = wt("r-3");
  p.write(`${w3}/gen/reg.cc`, "a\r\nb\r\n");
  const r = await flow(p.root, ["transfer", PD], { plan: "03-03", worktree: w3, owns: ["Path:gen/"], summary: `${PD}/03-03-SUMMARY.md` });
  assert.deepEqual([r.code, r.json.dropped], [0, []]);
  assert.equal(p.read("gen/reg.cc"), "a\r\nb\r\n");
});

test("G090 adapter.ownership.regenerated defaults to no globs and must be a list of strings", () => {
  const p = makeTempProject();
  assert.deepEqual(loadConfig(p.root).adapter.ownership.regenerated, []);
  p.writeJson(".agents/harness.config.json", { adapter: { ownership: { ...OWNS, regenerated: "gen/**" } } });
  assert.throws(() => loadConfig(p.root), /adapter\.ownership\.regenerated/);
});

test("G090 the executor brief makes scratch-file cleanup a plain rule, not a Rule-4 decision", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.match(r.calls[0].prompt, /Before you return, delete every file you created outside owns \(your SUMMARY excepted\): scratch files are cleanup, not a Rule-4 decision\./);
});

test("G090 a worktree run logs each regenerated path it does not copy and still executes", async () => {
  const w = makeExecWorld({ overlay: { gsd: { isolation: "worktree" }, adapter: { ownership: { ...OWNS, regenerated: ["gen/**"] } } } });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, {
    "exec-01-01": (prompt, o, n, calls) => {
      const base = calls.find((c) => c.n === n)?.worktree ?? "";
      w.write(`${base}/gen/new.cc`, "n\n");
    },
  }) });
  assert.equal(r.result.status, "executed");
  assert.ok(r.logs.includes("log transfer 01-01: gen/new.cc not copied to the main tree (regenerated)"), r.logs.join("\n"));
  assert.equal(fs.existsSync(path.join(w.root, "gen/new.cc")), false);
});
