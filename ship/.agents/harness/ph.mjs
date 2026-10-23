#!/usr/bin/env node
// ph: the single entry of the harness runtime (PHCL-01). Commands come from the owners' command modules.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { configProvenance, configRoot, loadConfig, loadConfigLenient } from "./config.mjs";
import { UsageError, errText, helpAsked, isMain, parseArgs, phCommand } from "./lib/cli.mjs";
import { realClock } from "./lib/proc.mjs";
import { connect } from "./paseo-client/index.mjs";

export const COMMAND_MODULES = Object.freeze([
  "./runtime/commands.mjs",
  "./workflow/commands.mjs",
  "./gsd/commands.mjs",
  "./adapter/commands.mjs",
]);

const CONFIG_MODES = new Set(["required", "lenient", "none"]);

const BUILTINS = [
  {
    name: "help",
    summary: "list the commands, or show one command's usage (ph help <command>)",
    usage: "ph help [command]",
    options: {},
    config: "none",
    run: (ctx) => printHelp(ctx, ctx.args[0]),
  },
  {
    name: "config",
    summary: "print the effective harness config with its file provenance",
    usage: "ph config",
    options: {},
    config: "required",
    run: (ctx) => {
      ctx.out(JSON.stringify({ ...ctx.cfg, _provenance: configProvenance(ctx.root) }, null, 2));
      return 0;
    },
  },
];

function checkDefinition(def, source) {
  const where = `ph command ${def?.name ?? "?"} (${source})`;
  if (typeof def?.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(def.name)) throw new Error(`${where}: invalid name`);
  if (typeof def.run !== "function") throw new Error(`${where}: run is not a function`);
  if (!CONFIG_MODES.has(def.config)) throw new Error(`${where}: config must be required, lenient or none`);
  if (def.options !== null && (typeof def.options !== "object" || Array.isArray(def.options))) throw new Error(`${where}: options must be an object or null`);
}

let registry = null;

export async function loadCommands() {
  if (registry) return registry;
  const map = new Map();
  const add = (def, source) => {
    checkDefinition(def, source);
    if (map.has(def.name)) throw new Error(`duplicate ph command ${def.name} (${source})`);
    map.set(def.name, def);
  };
  for (const def of BUILTINS) add(def, "ph.mjs");
  for (const rel of COMMAND_MODULES) {
    // A module not yet present is skipped; any other import failure stops ph.
    if (!fs.existsSync(fileURLToPath(new URL(rel, import.meta.url)))) continue;
    const mod = await import(rel);
    if (!Array.isArray(mod.commands)) throw new Error(`${rel} does not export a commands array`);
    for (const def of mod.commands) add(def, rel);
  }
  registry = map;
  return map;
}

function printHelp(ctx, name) {
  const commands = ctx.commands;
  if (name && commands.has(name)) {
    const def = commands.get(name);
    ctx.out(`usage: ${def.usage ?? `ph ${def.name}`}`);
    ctx.out(def.summary ?? "");
    return 0;
  }
  ctx.out("usage: node .agents/harness/ph.mjs <command> [options]   (ph help <command> for its usage)");
  const visible = [...commands.values()].filter((def) => !def.hidden);
  const width = Math.max(...visible.map((def) => def.name.length));
  for (const def of visible) ctx.out(`  ${def.name.padEnd(width)}  ${def.summary ?? ""}`);
  return name ? 1 : 0;
}

export async function main(argv, { env = process.env, cwd = process.cwd(), out, err, write, clock = realClock, daemon } = {}) {
  const writeOut = write ?? ((text) => process.stdout.write(text));
  const ctx = {
    env,
    clock,
    root: configRoot(env, cwd),
    out: out ?? ((line) => writeOut(`${line}\n`)),
    err: err ?? ((line) => process.stderr.write(`${line}\n`)),
    write: writeOut,
    ph: phCommand(),
  };
  let session = null;
  try {
    ctx.commands = await loadCommands();
    const [name, ...rest] = argv;
    if (name === undefined || name === "--help" || name === "-h") return printHelp(ctx);
    const def = ctx.commands.get(name);
    if (!def) return printHelp(ctx, name);
    // Options null: the command gets raw argv and answers -h and --help itself (ph gsd, G153).
    if (def.options && helpAsked(rest, def.options)) return printHelp(ctx, name);
    Object.assign(ctx, { name, argv: rest, opts: {}, args: rest, cfg: null, configError: null });
    if (def.options) Object.assign(ctx, parseArgs(rest, def.options));
    if (def.config === "required") ctx.cfg = loadConfig(ctx.root);
    if (def.config === "lenient") ({ cfg: ctx.cfg, error: ctx.configError } = loadConfigLenient(ctx.root));
    ctx.paseo = () => (session ??= connect({ env, root: ctx.root, cfg: ctx.cfg ?? loadConfig(ctx.root), clock, daemon }));
    return (await def.run(ctx)) ?? 0;
  } catch (e) {
    if (e instanceof UsageError) ctx.err(`usage error: ${errText(e)}`);
    else ctx.err(`failed: ${errText(e)}`);
    return 1;
  } finally {
    if (session) await session.then((s) => s.close(), () => {});
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
