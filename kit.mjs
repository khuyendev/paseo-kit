#!/usr/bin/env node
// Kit CLI entry: dispatches project verbs to kit/install and machine verbs to kit/machine (INST-01, MACH-01).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const USAGE = [
  "usage: node kit.mjs install|update|status <project> [--force] [--enable-plugin]",
  "       node kit.mjs pull <project> [<part>...] [--force] [--kit DIR]",
  "       node kit.mjs machine check | apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills] [--unlink-user-skills] | export",
];
const PROJECT_VERBS = new Set(["install", "update", "status", "pull"]);

export async function main(argv, io = {}) {
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const env = io.env ?? process.env;
  const [verb, ...rest] = argv;
  let modulePath, args;
  if (PROJECT_VERBS.has(verb)) [modulePath, args] = ["./kit/install/index.mjs", argv];
  else if (verb === "machine") [modulePath, args] = ["./kit/machine/index.mjs", rest];
  else {
    for (const line of USAGE) err(line);
    return 1;
  }
  try {
    const { run } = await import(modulePath);
    return (await run(args, { out, err, env })) ?? 0;
  } catch (e) {
    err(`error: ${String(e?.message ?? e).split("\n")[0]}`);
    return 1;
  }
}

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const startedAs = process.argv[1] && fs.existsSync(process.argv[1]) ? fold(fs.realpathSync(process.argv[1])) : null;
if (startedAs === fold(fs.realpathSync(fileURLToPath(import.meta.url)))) {
  process.exitCode = await main(process.argv.slice(2));
}
