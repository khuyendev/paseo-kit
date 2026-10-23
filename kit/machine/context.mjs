// Paths and inputs every machine verb shares: kit files, the live Paseo config, the machine record (MACH-17).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { readJson } from "../../ship/.agents/harness/lib/io.mjs";
import { homeDir, paseoConfigFile } from "../../ship/.agents/harness/platform.mjs";
import { Fail } from "./fail.mjs";
import { expandHome } from "./template.mjs";

export { Fail };

export const KIT_DIR = fileURLToPath(new URL("../../", import.meta.url));

// io.kitDir is a test seam: tests run against a temp copy of the kit files they need.
export function machineContext(io = {}) {
  const env = io.env ?? process.env;
  const kitDir = path.resolve(io.kitDir ?? KIT_DIR);
  const home = homeDir(env);
  return {
    env,
    home,
    kitDir,
    out: io.out ?? ((line) => process.stdout.write(`${line}\n`)),
    templateFile: path.join(kitDir, "paseo", "providers.json"),
    defaultsFile: path.join(kitDir, "ship", ".agents", "harness.defaults.json"),
    pluginsDir: path.join(kitDir, "plugins"),
    skillDir: path.join(kitDir, "user", "skills", "kit-init"),
    paseoConfig: paseoConfigFile(env),
    linksRecord: path.join(home, ".paseo-kit", "user-links.json"),
    reloadPending: path.join(home, ".paseo-kit", "paseo-reload-pending.json"),
  };
}

export function loadDefaults(ctx) {
  try {
    return loadKitConfig({ defaultsFile: ctx.defaultsFile });
  } catch (e) {
    throw new Fail(`cannot load the kit defaults: ${e.message}`);
  }
}

export function loadInputs(ctx) {
  const cfg = loadDefaults(ctx);
  let tpl;
  try {
    tpl = readJson(ctx.templateFile);
  } catch (e) {
    throw new Fail(`cannot read the provider template ${ctx.templateFile}: ${e.message}`);
  }
  if (!tpl || typeof tpl !== "object" || !tpl.providers || typeof tpl.providers !== "object") {
    throw new Fail(`the provider template ${ctx.templateFile} has no providers object`);
  }
  return { cfg, tpl };
}

export function readLive(ctx) {
  let live;
  try {
    live = readJson(ctx.paseoConfig);
  } catch (e) {
    throw new Fail(`cannot read the Paseo config ${ctx.paseoConfig}: ${e.code === "ENOENT" ? "missing" : e.message}`);
  }
  if (!live || typeof live !== "object" || Array.isArray(live)) throw new Fail(`the Paseo config ${ctx.paseoConfig} is not a JSON object`);
  return live;
}

// The Claude config dir of machine operations: the first template provider's, else $CLAUDE_CONFIG_DIR, else ~/.claude (MACH-17).
export function claudeConfigDir(ctx, tpl) {
  const dir = Object.values(tpl.providers).map((p) => p?.env?.CLAUDE_CONFIG_DIR).find((v) => typeof v === "string" && v);
  return dir ? expandHome(dir, ctx.home) : ctx.env.CLAUDE_CONFIG_DIR || path.join(ctx.home, ".claude");
}
