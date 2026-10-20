import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parseArgs, phCommand, PH_FILE, UsageError } from "../../ship/.agents/harness/lib/cli.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { assertErrLine, assertExit, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runNode, runPh, runPhProcess } from "../helpers/run.mjs";
import { KIT_DIR, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

// A command module placed in a temp project's runtime copy (never in the kit's own runtime/ tree).
const PROBE_COMMANDS = `
import { UsageError } from "../lib/cli.mjs";
export const commands = [
  { name: "probe", summary: "echo options", usage: "ph probe [--text T] [--flag]", options: { text: "string", flag: "bool" }, config: "required",
    run: (ctx) => { ctx.out("text=" + (ctx.opts.text ?? "") + " flag=" + Boolean(ctx.opts.flag) + " args=" + ctx.args.join(",")); return 0; } },
  { name: "probe-hidden", summary: "internal", options: {}, config: "none", hidden: true, run: () => 0 },
  { name: "probe-fail", summary: "throws", options: {}, config: "none", run: () => { throw new Error("boom\\nsecond line"); } },
  { name: "probe-usage", summary: "usage error", options: {}, config: "none", run: () => { throw new UsageError("bad call"); } },
  { name: "probe-code", summary: "returns 69", options: null, config: "none", run: (ctx) => { ctx.out("raw=" + ctx.argv.join(" ")); return 69; } },
  { name: "probe-lenient", summary: "doctor-like", options: {}, config: "lenient",
    run: (ctx) => { ctx.out(ctx.configError ? "problem " + ctx.configError.message : "ok config"); ctx.out("max_subagents " + ctx.cfg.max_subagents); return ctx.configError ? 2 : 0; } },
  { name: "probe-paseo", summary: "connects", options: {}, config: "required",
    run: async (ctx) => { const s = await ctx.paseo(); const again = await ctx.paseo(); ctx.out("same " + (s === again) + " version " + s.version); return 0; } },
];
`;

function probeProject(overlay) {
  const p = makeTempProject({ git: false, runtime: true, overlay });
  p.write(".agents/harness/runtime/commands.mjs", PROBE_COMMANDS);
  return p;
}

test("PHCL-01 help lists public commands, hides internal ones; unknown command exits 1", () => {
  const p = probeProject();
  const env = testEnv();
  const help = runPhProcess(p.root, [], { env });
  assertExit(help, 0);
  assertLine(help, /^ {2}probe {2,}echo options$/);
  assertLine(help, /^ {2}config /);
  assertNoLine(help, /probe-hidden/);
  assertExit(runPhProcess(p.root, ["--help"], { env }), 0);
  assertExit(runPhProcess(p.root, ["help"], { env }), 0);
  const one = runPhProcess(p.root, ["help", "probe"], { env });
  assertLine(one, "usage: ph probe [--text T] [--flag]");
  const bogus = runPhProcess(p.root, ["bogus"], { env });
  assertExit(bogus, 1);
  assertLine(bogus, /^ {2}probe /);
});

test("PHCL-01 error lines and exit codes: usage error, failed, verb codes passed through", () => {
  const p = probeProject();
  const env = testEnv();
  const failed = runPhProcess(p.root, ["probe-fail"], { env });
  assertExit(failed, 1);
  assertErrLine(failed, "failed: boom");
  const usage = runPhProcess(p.root, ["probe-usage"], { env });
  assertExit(usage, 1);
  assertErrLine(usage, "usage error: bad call");
  const code = runPhProcess(p.root, ["probe-code", "--pick", "a.b", "x"], { env });
  assertExit(code, 69);
  assertLine(code, "raw=--pick a.b x");
});

test("PHCL-01 a moved project copy runs help and config with no kit present; no manifest kit path in runtime code", () => {
  const p = probeProject();
  const moved = `${p.root} moved`;
  fs.renameSync(p.root, moved);
  const env = testEnv();
  assertExit(runNode(path.join(moved, ".agents", "harness", "ph.mjs"), ["help"], { cwd: moved, env }), 0);
  const config = runNode(path.join(moved, ".agents", "harness", "ph.mjs"), ["config"], { cwd: moved, env });
  assertExit(config, 0);
  assert.ok(!config.stdout.toLowerCase().includes(KIT_DIR.toLowerCase().replace(/[\\/]+$/, "")), "config output names the kit");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(mjs|js)$/.test(e.name) && /manifest\??\.kit\b|\)\??\.kit\b|\["kit"\]/.test(fs.readFileSync(abs, "utf8"))) offenders.push(abs);
    }
  };
  walk(path.join(SHIP_DIR, ".agents", "harness"));
  assert.deepEqual(offenders, []);
});

test("PHCL-02 argument parsing", () => {
  assert.deepEqual(parseArgs(["--prompt", "--x", "a"], { prompt: "string" }), { opts: { prompt: "--x" }, args: ["a"] });
  assert.deepEqual(parseArgs(["a", "--now", "b"], { now: "bool" }), { opts: { now: true }, args: ["a", "b"] });
  assert.throws(() => parseArgs(["--bogus"], {}), (e) => e instanceof UsageError && e.message === "unknown option --bogus");
  assert.throws(() => parseArgs(["--name"], { name: "string" }), (e) => e instanceof UsageError && e.message === "--name needs a value");
  const p = probeProject();
  const env = testEnv();
  const ok = runPhProcess(p.root, ["probe", "--text", "--x", "pos", "--flag"], { env });
  assertExit(ok, 0);
  assertLine(ok, "text=--x flag=true args=pos");
  const unknown = runPhProcess(p.root, ["probe", "--bogus"], { env });
  assertExit(unknown, 1);
  assertErrLine(unknown, "usage error: unknown option --bogus");
  assertErrLine(runPhProcess(p.root, ["probe", "--text"], { env }), "usage error: --text needs a value");
});

test("CONF-08 invalid overlay: required commands fail with exit 1, lenient commands report and continue", () => {
  for (const write of [(p) => p.writeJson(".agents/harness.config.json", { typo_key: 1 }), (p) => p.write(".agents/harness.config.json", "{")]) {
    const p = probeProject();
    write(p);
    const env = testEnv();
    const config = runPhProcess(p.root, ["config"], { env });
    assertExit(config, 1);
    assertErrLine(config, /^failed: invalid harness config (typo_key: unknown key|overlay: invalid JSON)/);
    assertExit(runPhProcess(p.root, ["probe"], { env }), 1);
    const lenient = runPhProcess(p.root, ["probe-lenient"], { env });
    assertExit(lenient, 2);
    assertLine(lenient, /^problem invalid harness config /);
    assertLine(lenient, "max_subagents 20");
    assertExit(runPhProcess(p.root, ["help"], { env }), 0);
  }
});

test("CONF-10 ph config prints the effective config with provenance", async () => {
  const p = makeTempProject({ git: false });
  const res = await runPh(["config"], { root: p.root });
  assertExit(res, 0);
  const doc = JSON.parse(res.stdout);
  assert.equal(doc._provenance.overlay, null);
  assert.equal(doc._provenance.manifest, null);
  assert.deepEqual(doc._provenance.warnings, []);
  assert.equal(doc.max_subagents, 20);
  p.writeJson(".agents/harness.config.json", { max_subagents: 4, max_live_subagents: 4 });
  p.writeJson(".agents/harness-kit.json", { version: "0.0.1", installedAt: "i", updatedAt: "u", files: {} });
  const doc2 = JSON.parse((await runPh(["config"], { root: p.root })).stdout);
  assert.equal(doc2.max_subagents, 4);
  assert.equal(doc2._provenance.overlay, p.path(".agents/harness.config.json"));
  assert.deepEqual(doc2._provenance.manifest, { version: "0.0.1", installedAt: "i", updatedAt: "u" });
});

test("PHCL-01 ctx.paseo connects once and the session is closed after the command", async () => {
  const p = probeProject();
  const { main } = await import(pathToFileURL(path.join(p.root, ".agents", "harness", "ph.mjs")).href);
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, version: "9.9.9" });
  let stdout = "";
  const code = await main(["probe-paseo"], { env: testEnv({ PASEO_HARNESS_ROOT: p.root }), clock, daemon: fake.daemon, write: (t) => (stdout += t), err: () => {} });
  assert.equal(code, 0);
  assert.equal(stdout, "same true version 9.9.9\n");
  assert.equal(fake.callsOf("close").length, 1);
  const down = createFakeDaemon({ clock, down: "refused" });
  const errors = [];
  const failed = await main(["probe-paseo"], { env: testEnv({ PASEO_HARNESS_ROOT: p.root }), clock, daemon: down.daemon, write: () => {}, err: (l) => errors.push(l) });
  assert.equal(failed, 1);
  assert.deepEqual(errors, ["failed: Cannot connect to daemon at fake: refused"]);
});

test("PHCL-01 a duplicate command name stops ph with a named error", () => {
  const p = probeProject();
  p.write(".agents/harness/workflow/commands.mjs", 'export const commands = [{ name: "probe", options: {}, config: "none", run: () => 0 }];\n');
  const res = runPhProcess(p.root, ["help"], { env: testEnv() });
  assertExit(res, 1);
  assertErrLine(res, "failed: duplicate ph command probe (./workflow/commands.mjs)");
});

test("PHCL-07 one ph command renderer with forward slashes", () => {
  assert.equal(phCommand(), `node "${PH_FILE.split(path.sep).join("/")}"`);
  assert.ok(!phCommand().includes("\\"));
});
