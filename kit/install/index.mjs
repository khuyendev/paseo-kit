// Kit project verbs: install | update | status | pull (INST-01, INST-02). Called by kit.mjs as run(argv, io).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errText, parseArgs, UsageError } from "../../ship/.agents/harness/lib/cli.mjs";
import { isInside, toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { fail, KitFailure } from "./failure.mjs";
import { loadKit } from "./units.mjs";
import { install, pull, status, update } from "./verbs.mjs";

export const KIT_DIR = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const USAGE = [
  "usage: node kit.mjs install|update|status <project> [--force] [--enable-plugin]",
  "       node kit.mjs pull <project> [<part>...] [--force] [--kit DIR]",
];

const VERBS = {
  install: { run: install, options: { force: "bool", "enable-plugin": "bool" } },
  update: { run: update, options: { force: "bool", "enable-plugin": "bool" } },
  status: { run: status, options: { force: "bool" } },
  pull: { run: pull, options: { force: "bool", kit: "string" } },
};

function parse(argv) {
  const [verb, ...rest] = argv;
  const spec = VERBS[verb];
  if (!spec) throw new UsageError(verb ? `unknown verb ${verb}` : "name a verb");
  const { opts, args } = parseArgs(rest, spec.options);
  if (!args.length) throw new UsageError(`${verb} needs a <project>`);
  if (verb !== "pull" && args.length > 1) throw new UsageError(`${verb} takes one <project>, got ${args.length} positional arguments`);
  return { verb, spec, opts, project: args[0], parts: args.slice(1) };
}

// Refuses a missing target, a file, and the kit itself or any folder inside it (segment-wise; a sibling prefix is fine).
export function resolveTarget(arg, kitDir) {
  const abs = path.resolve(arg);
  const st = fs.statSync(abs, { throwIfNoEntry: false });
  if (!st) fail(`${abs} does not exist`);
  if (!st.isDirectory()) fail(`${abs} is not a folder`);
  if (isInside(abs, kitDir) || isInside(fs.realpathSync(abs), fs.realpathSync(kitDir))) fail("the project cannot be the kit itself");
  return abs;
}

// io: {out, err, env}; tests may add kitDir (the running kit) and now() (manifest time).
export async function run(argv, io) {
  const env = io.env ?? process.env;
  let parsed;
  try {
    parsed = parse(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`usage error: ${errText(e)}`);
    for (const line of USAGE) io.err(line);
    return 1;
  }
  const { verb, spec, opts, project, parts } = parsed;
  try {
    if (verb !== "status") io.out(`platform ${process.platform} ${process.arch}, node ${process.version}`);
    const runningKit = io.kitDir ?? KIT_DIR;
    const kitDir = path.resolve(verb === "pull" ? (opts.kit ?? env.PASEO_KIT ?? runningKit) : runningKit);
    if (!fs.existsSync(kitDir)) fail(`${kitDir} does not exist`);
    const ctx = {
      project: resolveTarget(project, kitDir),
      kit: loadKit(kitDir),
      kitScript: toSlash(path.join(runningKit, "kit.mjs")),
      force: Boolean(opts.force),
      enablePlugin: Boolean(opts["enable-plugin"]),
      env,
      out: io.out,
      err: io.err,
      now: io.now ?? (() => new Date()),
    };
    return verb === "pull" ? spec.run(ctx, parts) : spec.run(ctx);
  } catch (e) {
    io.err(`${e instanceof KitFailure ? "failed" : "error"}: ${errText(e)}`);
    return 1;
  }
}
