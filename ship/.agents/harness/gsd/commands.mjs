// `ph gsd <verb>`: one JSON document as the last stdout line, `--pick`, `--root`, exit 0/1/66/69 (GSDC-02..04).
// Also the library entry `runGsd` for workflow scripts (same verbs, same exit codes).
import fs from "node:fs";
import path from "node:path";
import { configRoot, loadConfig } from "../config.mjs";
import { UsageError, errText, parseArgs } from "../lib/cli.mjs";
import { GsdError, fail, unavailable } from "./common.mjs";
import { hasGit } from "./git.mjs";
import { NOT_PORTED } from "./verb-table.mjs";
import { verbHandlers } from "./verbs.mjs";

export const GLOBAL_OPTIONS = ["pick", "root"];

// Every verb the kit knows: ported handlers plus the upstream verbs it declares unavailable (with a reason).
export const VERBS = Object.freeze({
  ...Object.fromEntries(Object.entries(NOT_PORTED).map(([verb, reason]) => [verb, { ported: false, reason }])),
  ...Object.fromEntries(Object.keys(verbHandlers).map((verb) => [verb, { ported: true }])),
});

// Split off --pick/--root (never after `--`) and resolve the verb name: `query x.y`, `x.y`, `x y` or `x`.
export function resolveVerb(argv) {
  const cut = argv.indexOf("--");
  const head = cut < 0 ? argv : argv.slice(0, cut);
  const tail = cut < 0 ? [] : argv.slice(cut);
  const global = {};
  const rest = [];
  for (let i = 0; i < head.length; i++) {
    const key = head[i].startsWith("--") ? head[i].slice(2) : null;
    if (GLOBAL_OPTIONS.includes(key)) {
      if (i + 1 >= head.length) throw new UsageError(`--${key} needs a value`);
      global[key] = head[++i];
    } else rest.push(head[i]);
  }
  let tokens = [...rest, ...tail];
  if (tokens[0] === "query") tokens = tokens.slice(1);
  if (!tokens.length) throw new UsageError("name a gsd verb (ph help gsd)");
  let verb;
  if (tokens[0].includes(".")) verb = tokens.shift();
  else if (tokens.length > 1 && Object.hasOwn(VERBS, `${tokens[0]}.${tokens[1]}`)) verb = `${tokens.shift()}.${tokens.shift()}`;
  else verb = tokens.shift();
  return { verb, args: tokens, global };
}

// `a.b[-1].c` against a JSON value: {found, value, keys}.
export function pickField(value, spec) {
  const steps = [];
  for (const part of String(spec).split(".")) {
    const m = /^([^[\]]*)((?:\[-?\d+\])*)$/.exec(part);
    if (!m) return { found: false, keys: [] };
    if (m[1]) steps.push(m[1]);
    for (const idx of m[2].matchAll(/\[(-?\d+)\]/g)) steps.push(Number(idx[1]));
  }
  let cur = value;
  for (const step of steps) {
    if (cur === null || typeof cur !== "object") return { found: false, keys: [] };
    const keys = Array.isArray(cur) ? cur.map((_, i) => String(i)) : Object.keys(cur);
    if (typeof step === "number") {
      if (!Array.isArray(cur)) return { found: false, keys };
      const i = step < 0 ? cur.length + step : step;
      if (i < 0 || i >= cur.length) return { found: false, keys };
      cur = cur[i];
    } else {
      if (Array.isArray(cur) || !Object.hasOwn(cur, step)) return { found: false, keys };
      cur = cur[step];
    }
  }
  return { found: true, value: cur };
}

const bare = (v) => (v === null || v === undefined || v === "" ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export async function runGsd(argv, { env = process.env, root = configRoot(env), stdin, out, err, write, errWrite } = {}) {
  const say = out ?? ((line) => process.stdout.write(`${line}\n`));
  const warn = err ?? ((line) => process.stderr.write(`${line}\n`));
  let pick;
  let result;
  try {
    const { verb, args, global } = resolveVerb(argv);
    pick = global.pick;
    const entry = VERBS[verb];
    if (!entry) throw unavailable(`not ported: unknown gsd verb ${verb}; continue without it`, { status: "unavailable", verb, reason: "unknown verb" });
    if (!entry.ported) throw unavailable(`${verb} is not ported: ${entry.reason}`, { status: "unavailable", verb, reason: entry.reason });
    const cfg = loadConfig(root);
    let codeRoot = root;
    if (global.root !== undefined) {
      codeRoot = path.resolve(root, global.root);
      if (!fs.existsSync(codeRoot) || !hasGit(codeRoot)) throw unavailable(`--root ${global.root} is not a git checkout (no .git)`);
    }
    const handler = verbHandlers[verb];
    const parsed = handler.options === null ? { opts: {}, args } : parseArgs(args, handler.options);
    const g = {
      verb,
      env,
      cfg,
      harnessRoot: root,
      codeRoot,
      out: say,
      err: warn,
      write: write ?? ((t) => process.stdout.write(t)),
      errWrite: errWrite ?? ((t) => process.stderr.write(t)),
      stdin: () => (stdin !== undefined ? String(stdin) : readStdin()),
    };
    result = await handler.run(g, parsed.args, parsed.opts);
  } catch (e) {
    if (e instanceof GsdError) result = { code: e.exitCode, json: { status: e.extra.status ?? "error", error: errText(e), ...e.extra } };
    else result = { code: 1, json: { status: "error", error: errText(e) } };
  }
  if (pick === undefined) {
    say(JSON.stringify(result.json));
    return result.code;
  }
  const p = pickField(result.json, pick);
  if (!p.found) {
    warn(`pick_field_absent: ${pick}; available keys: ${p.keys.join(", ") || "(none)"}`);
    return 1;
  }
  say(bare(p.value));
  return result.code;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    if (e.code === "EAGAIN" || e.code === "EOF") return "";
    throw fail(`could not read stdin: ${e.message}`);
  }
}

export const commands = [
  {
    name: "gsd",
    summary: "GSD planning verbs over .planning/ (JSON last line; exit 0 ok, 1 negative/error, 66 nothing in scope, 69 could not look)",
    usage: "ph gsd <verb> [args] [--pick a.b[-1].c] [--root <checkout>]   verbs: ph gsd verbs",
    options: null,
    config: "none",
    run: (ctx) => runGsd(ctx.argv, { env: ctx.env, root: ctx.root, out: ctx.out, err: ctx.err, write: ctx.write }),
  },
];
