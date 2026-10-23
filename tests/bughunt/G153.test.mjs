// Bug-hunt fix G153 (kit-feedback 10): `--help` and `-h` print a verb's usage and run nothing, for ph and for gsd verbs;
// `--` ends the options so a literal `-h` value can still be passed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { helpAsked, parseArgs } from "../../ship/.agents/harness/lib/cli.mjs";
import { verbHandlers } from "../../ship/.agents/harness/gsd/verbs.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { runPh } from "../helpers/run.mjs";
import { makeTempProject } from "../helpers/temp.mjs";

const commitCount = (p) => Number(spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: p.root, encoding: "utf8" }).stdout.trim());

test("G153 helpAsked: -h and --help count unless after -- or given as a string option's value", () => {
  assert.equal(helpAsked(["-h"], null), true);
  assert.equal(helpAsked(["Auth", "--help"], { goal: "string" }), true);
  assert.equal(helpAsked(["--now", "-h"], { now: "bool" }), true);
  assert.equal(helpAsked(["--goal", "-h"], { goal: "string" }), false);
  assert.equal(helpAsked(["--", "-h"], null), false);
  assert.equal(helpAsked(["--files", "a", "--", "-h"], null), false);
  assert.equal(helpAsked(["Auth"], { goal: "string" }), false);
});

test("G153 -- ends the options: the tokens after it are data, for parsed and raw verbs", () => {
  assert.deepEqual(parseArgs(["--", "--x", "-h"], { goal: "string" }), { opts: {}, args: ["--x", "-h"] });
  assert.deepEqual(parseArgs(["--goal", "g", "--", "-h"], { goal: "string" }), { opts: { goal: "g" }, args: ["-h"] });
});

test("G153 every ported gsd verb has usage text that names the verb", () => {
  for (const [verb, handler] of Object.entries(verbHandlers)) {
    assert.equal(typeof handler.usage, "string", verb);
    assert.ok(handler.usage.startsWith(`ph gsd ${verb}`), `${verb}: ${handler.usage}`);
  }
});

test("G153 ph <command> -h and --help print the command usage with exit 0 and do not run the command", async () => {
  const p = makeTempProject({ git: false });
  for (const argv of [["spawn", "-h"], ["spawn", "--help"], ["config", "-h"], ["runs", "-h"], ["workflow", "--help"]]) {
    const r = await runPh(argv, { root: p.root });
    assert.equal(r.code, 0, `${argv.join(" ")}: ${r.stderr}`);
    assert.match(r.out[0], /^usage: /, argv.join(" "));
    assert.ok(!r.out.some((line) => line.startsWith("{")), `${argv.join(" ")} ran the command`);
  }
  const top = await runPh(["-h"], { root: p.root });
  assert.equal(top.code, 0);
  assert.match(top.out[0], /^usage: node /);
});

test("G153 ph watch-run -h prints the usage and waits for no run", async () => {
  const p = makeTempProject({ git: false });
  const clock = createFakeClock();
  const r = await runPh(["watch-run", "-h"], { root: p.root, clock });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out[0], /^usage: ph watch-run /);
  assert.deepEqual(clock.sleeps, []);
});

test("G153 ph gsd verbs: -h and --help reach the gsd help, not the gsd command usage", async () => {
  const p = project();
  const verbHelp = await runPh(["gsd", "phase.add", "-h"], { root: p.root });
  assert.equal(verbHelp.code, 0, verbHelp.stderr);
  assert.equal(JSON.parse(verbHelp.out.at(-1)).verb, "phase.add");
  const gsdHelp = await runPh(["gsd", "--help"], { root: p.root });
  assert.equal(gsdHelp.code, 0, gsdHelp.stderr);
  assert.equal(JSON.parse(gsdHelp.out.at(-1)).status, "help");
});

test("G153 gsd -h and --help print the gsd usage with exit 0", async () => {
  const p = project();
  for (const argv of [["-h"], ["--help"]]) {
    const r = await gsd(p, argv);
    assert.equal(r.code, 0, argv.join(" "));
    assert.equal(r.json.status, "help");
    assert.match(r.json.usage, /^ph gsd <verb>/);
  }
});

test("G153 gsd phase.add --help prints the verb usage and writes nothing", async () => {
  const p = project();
  const roadmap = p.read(".planning/ROADMAP.md");
  const r = await gsd(p, ["phase.add", "--help"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.equal(r.json.status, "help");
  assert.equal(r.json.verb, "phase.add");
  assert.match(r.json.usage, /^ph gsd phase\.add <name\.\.\.>/);
  assert.equal(p.read(".planning/ROADMAP.md"), roadmap);
});

test("G153 -h is never a phase goal or name: phase.add and phase.insert print the usage and change no planning file", async () => {
  const p = project();
  const roadmap = p.read(".planning/ROADMAP.md");
  for (const argv of [["phase.add", "Auth", "-h"], ["phase.add", "-h"], ["phase.insert", "1", "-h"], ["phase.insert", "1", "Auth", "-h"]]) {
    const r = await gsd(p, argv);
    assert.equal(r.code, 0, `${argv.join(" ")}: ${r.err.join("\n")}`);
    assert.equal(r.json.status, "help", argv.join(" "));
  }
  assert.equal(p.read(".planning/ROADMAP.md"), roadmap);
  assert.equal(fs.existsSync(p.path(".planning/phases/02-h")), false);
  assert.equal(fs.existsSync(p.path(".planning/phases/02-auth-h")), false);
  assert.equal(fs.existsSync(p.path(".planning/phases/01.1-h")), false);
});

test("G153 gsd commit -h writes no commit; the --files list is still read", async () => {
  const p = project();
  p.write("feature.txt", "x\n");
  const before = commitCount(p);
  const r = await gsd(p, ["commit", "-h", "--files", "feature.txt"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.equal(r.json.status, "help");
  assert.equal(commitCount(p), before);
  assert.match(r.json.usage, /^ph gsd commit <message\.\.\.> --files/);
});

test("G153 gsd upstream.check --help prints the upstream usage instead of rejecting the flag", async () => {
  const p = project();
  const r = await gsd(p, ["upstream.check", "--help"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.equal(r.json.status, "help");
  assert.match(r.json.usage, /--target <checkout>/);
});

test("G153 a wrapped command keeps its own -h: run-with-timeout runs it and normalize-test-command returns it", async () => {
  const p = project();
  p.write("probe.mjs", "console.log(process.argv.at(-1));\n");
  const ran = await gsd(p, ["run-with-timeout", "5", process.execPath, p.path("probe.mjs"), "-h"]);
  assert.equal(ran.code, 0, ran.err.join("\n"));
  assert.ok(ran.stdout.split(/\r?\n/).includes("-h"), ran.stdout);
  const norm = await gsd(p, ["normalize-test-command", "node", "x.js", "--help"]);
  assert.equal(norm.code, 0, norm.err.join("\n"));
  assert.notEqual(norm.json.status, "help");
});

test("G153 -- is the escape: phase.add -- -h names a phase -h", async () => {
  const p = project();
  const r = await gsd(p, ["phase.add", "--", "-h"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.match(p.read(".planning/ROADMAP.md"), /### Phase \d+: -h\n/);
});
