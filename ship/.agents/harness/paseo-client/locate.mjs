// Finding and loading the npm-installed Paseo CLI's own daemon client (PCLI-02, PCLI-03, D-17).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UsageError } from "../lib/cli.mjs";
import { readJson, readJsonIf } from "../lib/io.mjs";
import { paseoConfigFile } from "../platform.mjs";

const CLIENT_JS = path.join("dist", "utils", "client.js");
const CLI_PACKAGE = path.join("@getpaseo", "cli");

export function findCliDir(env = process.env) {
  const candidates = [env.PASEO_CLI_DIR];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    if (!dir || !(fs.existsSync(path.join(dir, "paseo")) || fs.existsSync(path.join(dir, "paseo.cmd")))) continue;
    candidates.push(path.join(dir, "node_modules", CLI_PACKAGE), path.join(dir, "..", "lib", "node_modules", CLI_PACKAGE));
  }
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, "npm", "node_modules", CLI_PACKAGE));
  candidates.push(path.join("/usr/local/lib/node_modules", CLI_PACKAGE), path.join("/usr/lib/node_modules", CLI_PACKAGE));
  const found = candidates.find((dir) => dir && fs.existsSync(path.join(dir, CLIENT_JS)));
  if (!found) throw new UsageError("the npm-installed Paseo CLI was not found (npm i -g @getpaseo/cli, or set PASEO_CLI_DIR)");
  return path.resolve(found);
}

// $PASEO_HOST, else daemon.listen of the Paseo config; never paseo.pid, which goes stale under a Desktop-managed
// daemon (HIS-29).
export function daemonTarget(env = process.env) {
  if (env.PASEO_HOST) return { kind: "endpoint", host: env.PASEO_HOST };
  const file = paseoConfigFile(env);
  const listen = readJsonIf(file)?.daemon?.listen;
  if (typeof listen !== "string" || !listen.trim()) {
    throw new UsageError(`no daemon address: set PASEO_HOST or daemon.listen in ${file}`);
  }
  return { kind: "endpoint", host: listen.trim() };
}

// Per-agent disallowedTools are not accepted by the Paseo 0.11 client (MC-03 re-checks on a Paseo bump).
const REAL_CAPABILITIES = Object.freeze({ agentDisallowedTools: false });

export async function loadRealDaemon(env) {
  const cliDir = findCliDir(env);
  const url = (rel) => pathToFileURL(path.join(cliDir, rel)).href;
  const { connectToDaemon } = await import(url(CLIENT_JS));
  const run = await import(url(path.join("dist", "commands", "agent", "run.js")));
  const client = await connectToDaemon({ target: daemonTarget(env) });
  return {
    client,
    cliDir,
    version: readJson(path.join(cliDir, "package.json")).version ?? null,
    reply: (args) => run.resolveStructuredResponseMessage(args),
    capabilities: REAL_CAPABILITIES,
  };
}
