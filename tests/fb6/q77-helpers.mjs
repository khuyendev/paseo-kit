// Fixtures of the Q77 tests: a two-plan phase whose first plan declares a shared change, runs that die at a chosen call.
import { spawnSync } from "node:child_process";
import { Killed, runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const NODE = process.execPath;
export const NODE_FLAG_COMMANDS = {
  build: [NODE, "-e", "process.exit(0)"],
  test: [NODE, "-e", "const fs=require('fs');if(fs.existsSync('fail.flag')){console.log('error '+fs.readFileSync('fail.flag','utf8').trim());process.exit(1)}"],
  build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {},
};

// A responder that dies (the run's process is killed) the first time it is called.
export const died = (what) => { let armed = true; return () => { if (armed) { armed = false; throw new Killed(`killed ${what}`); } }; };

// Phase with plan 01-01 in one wave (one plan, so a killed call leaves nothing else running); its <shared_changes> name config/app.json.
export function world({ isolation = "shared", commands, ownership, gsd = {}, waves } = {}) {
  const w = makeExecWorld({
    waves: waves ?? [[task("01-01")]],
    overlay: { gsd: { isolation, ...gsd }, adapter: { ...(commands ? { commands } : {}), ...(ownership ? { ownership } : {}) } },
  });
  const file = `${PHASE_DIR}/handoff/w1.args.json`;
  const h = JSON.parse(w.read(file));
  w.write(file, JSON.stringify({ ...h, sharedChanges: [{ source: "01-01", text: "register app config", paths: ["config/app.json"] }] }));
  return w;
}

// The shared-change fixer writes its file.
export const shared = (w) => ({ "shared-": () => { w.write("config/app.json", "{\"x\":1}\n"); return { status: "fixed", attempts: 1, remaining_failures: 0 }; } });

// A run: {result, calls} or {error} when the run was killed.
export async function exec(w, args = {}, overrides = {}, runId) {
  try {
    return await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides), ...(runId ? { runId } : {}) });
  } catch (error) {
    return { error };
  }
}

// The files of the commit whose subject starts with `subject`.
export function committedFiles(w, subject) {
  const sha = spawnSync("git", ["log", "--format=%H %s"], { cwd: w.root, encoding: "utf8" }).stdout.split("\n").find((l) => l.slice(41).startsWith(subject))?.slice(0, 40);
  return sha ? spawnSync("git", ["show", "--name-only", "--format=", sha], { cwd: w.root, encoding: "utf8" }).stdout.split("\n").filter(Boolean) : [];
}
