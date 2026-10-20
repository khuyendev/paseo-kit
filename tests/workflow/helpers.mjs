// Shared fixtures of the workflow tests: projects with configured tiers, the fake daemon, fake engine hosts and a
// handler context like the one ph builds.
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { UsageError, errText, parseArgs, phCommand } from "../../ship/.agents/harness/lib/cli.mjs";
import { commands as workflowCommands } from "../../ship/.agents/harness/workflow/commands.mjs";
import { commands as runtimeCommands } from "../../ship/.agents/harness/runtime/commands.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake, runPh } from "../helpers/run.mjs";
import { makeTempProject } from "../helpers/temp.mjs";

export const CALLER = "caller-0000-0000-0000-000000000000";
export const TIERS = { tiers: { frontier: { provider: "circle/big" }, pro: { provider: "circle/mid" }, standard: { provider: "circle/m" } } };

export const meta = (name = "t", extra = "") => `export const meta = { name: "${name}", description: "test workflow"${extra} };\n`;

// A project with configured tiers, a fake daemon (caller registered in the project) and a fake clock.
export function setup({ overlay = {}, files = {}, git = false, clock = createFakeClock(), responder, capabilities } = {}) {
  const project = makeTempProject({ git, files, overlay: { ...TIERS, ...overlay } });
  const fake = createFakeDaemon({ clock, responder, capabilities });
  fake.addAgent({ id: CALLER, cwd: project.root, title: "caller" });
  const env = testEnv({ PASEO_AGENT_ID: CALLER });
  const ph = (argv, opts = {}) => runOwn(argv, { project, fake, clock, env, ...opts });
  const realPh = (argv) => runPh(argv, { root: project.root, env, daemon: fake, clock });
  return { project, fake, clock, env, ph, realPh };
}

// A ph handler context for calling a command function directly (deps injection).
export function makeCtx({ project, fake, clock, env, argv, options, name = "workflow" }) {
  const { opts, args } = parseArgs(argv, options);
  const lines = [];
  let session = null;
  const ctx = {
    name, argv, opts, args, env: { ...env, PASEO_HARNESS_ROOT: project.root }, root: project.root, cfg: loadConfig(project.root),
    out: (line) => lines.push(line), err: (line) => lines.push(line), write: (t) => lines.push(t), clock, ph: phCommand(),
    paseo: async () => (session ??= await connectFake(fake, { env, root: project.root, clock })),
  };
  return { ctx, lines, close: () => session?.close() };
}

// The workflow (and runtime) commands run like ph runs them (option parsing, config modes, exit mapping), without
// the rest of the registry. deps go to workflowCommand (tests: {runtime, spawn}).
export async function runOwn(argv, { project, fake, clock, env, deps }) {
  const def = [...workflowCommands, ...runtimeCommands].find((c) => c.name === argv[0]);
  const out = [];
  const err = [];
  let session = null;
  let code;
  try {
    const { opts, args } = parseArgs(argv.slice(1), def.options);
    const ctx = {
      name: def.name, argv: argv.slice(1), opts, args, env: { ...env, PASEO_HARNESS_ROOT: project.root }, root: project.root,
      cfg: def.config === "none" ? null : loadConfig(project.root), out: (l) => out.push(l), err: (l) => err.push(l), write: (t) => out.push(t),
      clock, ph: phCommand(), paseo: async () => (session ??= await connectFake(fake, { env, root: project.root, clock })),
    };
    code = (await (deps && def.name === "workflow" ? (await import("../../ship/.agents/harness/workflow/cmd-workflow.mjs")).workflowCommand(ctx, deps) : def.run(ctx))) ?? 0;
  } catch (e) {
    err.push(e instanceof UsageError ? `usage error: ${errText(e)}` : `failed: ${errText(e)}`);
    code = 1;
  } finally {
    await session?.close();
  }
  return { code, out, err, stdout: out.map((l) => `${l}\n`).join(""), stderr: err.map((l) => `${l}\n`).join("") };
}

// A pure-engine host: every call resolves at once unless `runner` is given.
export function fakeHost({ runner, identify, admit, adopt } = {}) {
  const calls = { runner: [], adopt: [], admit: 0 };
  return {
    calls,
    identify: identify ?? (({ opts }) => ({ roleHash: opts.agentType ? `h-${opts.agentType}` : "", model: opts.model ?? "p/m", effort: opts.effort ?? null, provider: "p" })),
    admit: async (spec) => {
      calls.admit++;
      return admit ? admit(spec) : { release() {} };
    },
    adopt: async (entry, spec) => {
      calls.adopt.push({ agentId: entry.agentId, session: spec.opts.session });
      await adopt?.(entry, spec);
    },
    runner: async (spec) => {
      calls.runner.push(spec);
      return runner ? runner(spec) : { status: "ok", result: `r:${spec.prompt}`, agentId: `a${spec.n}`, model: "p/m", tokens: 1, durationS: 0 };
    },
  };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));
