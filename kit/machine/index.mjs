// `kit.mjs machine check | apply [...] | export` (MACH-01). Provider policy check and apply are part of check and
// apply; there is no separate sync script.
import { runApply } from "./apply.mjs";
import { runCheck } from "./check.mjs";
import { Fail, machineContext } from "./context.mjs";
import { runExport } from "./export.mjs";

const USAGE = "usage: node kit.mjs machine check | apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills] [--unlink-user-skills] | export";
const APPLY_FLAGS = { "--no-reload": "noReload", "--enable-paseo-plugins": "enablePlugins", "--link-user-skills": "link", "--unlink-user-skills": "unlink" };

function parse(argv) {
  const [verb, ...rest] = argv;
  if (verb === "check" || verb === "export") return rest.length ? null : { verb, opts: {} };
  if (verb !== "apply") return null;
  const opts = {};
  for (const arg of rest) {
    if (!Object.hasOwn(APPLY_FLAGS, arg)) return null;
    opts[APPLY_FLAGS[arg]] = true;
  }
  return opts.link && opts.unlink ? null : { verb, opts };
}

// io = {out, err, env}; io.kitDir (tests only) points at a kit copy. Unexpected errors propagate to kit.mjs (`error: ...`).
export async function run(argv, io = {}) {
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const parsed = parse(argv);
  if (!parsed) {
    err(USAGE);
    return 1;
  }
  const ctx = machineContext(io);
  try {
    if (parsed.verb === "check") return runCheck(ctx);
    if (parsed.verb === "export") return runExport(ctx);
    return await runApply(ctx, parsed.opts);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    err(`failed: ${e.message}`);
    return 1;
  }
}
