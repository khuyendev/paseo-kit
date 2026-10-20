// Whether a worker gets the harness-files mod directory (PCLI-09). Observes the owner's selection only: the kit never
// writes or toggles a plugin setting (INV-05).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf } from "../lib/io.mjs";
import { samePath } from "../lib/paths.mjs";
import { FILE_PLUGIN_ID, homeDir, paseoConfigFile, versionAtLeast } from "../platform.mjs";

const settings = (file) => readJsonIf(file, {}) ?? {};

// The worker provider's env from the Paseo config, following `extends`, over the invoking process env.
export function workerProviderEnv(provider, env = process.env) {
  const config = readJsonIf(paseoConfigFile(env), {}) ?? {};
  const providers = config.agents?.providers ?? {};
  const inherited = (id, seen = new Set()) => {
    if (!id || seen.has(id) || !providers[id]) return {};
    seen.add(id);
    return { ...inherited(providers[id].extends, seen), ...(providers[id].env ?? {}) };
  };
  return { ...env, ...inherited(provider) };
}

export function filePluginState(root, env = process.env, versionText = null) {
  const plugin = path.join(root, ".claude", "plugins", "harness-files");
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), ".claude");
  let selection;
  for (const file of [path.join(configDir, "settings.json"), path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json")]) {
    const enabled = settings(file).enabledPlugins ?? {};
    if (Object.hasOwn(enabled, FILE_PLUGIN_ID)) selection = enabled[FILE_PLUGIN_ID];
  }
  // The mod runs scripts/discover.mjs to find the backend (FTOL-05), so it counts as copied only with it.
  const copied = [[".claude-plugin", "plugin.json"], ["hooks", "hooks.json"], ["hooks", "register.ts"], ["scripts", "discover.mjs"]].every((parts) => fs.existsSync(path.join(plugin, ...parts)));
  const entries = settings(path.join(configDir, "plugins", "installed_plugins.json")).plugins?.[FILE_PLUGIN_ID];
  const registered = Array.isArray(entries) && entries.some((e) => e?.scope === "user" || (e?.projectPath && samePath(e.projectPath, root)));
  const dirs = String(env.CLAUDE_CODE_PLUGIN_DIRS ?? "").split(path.delimiter).filter(Boolean);
  const direct = dirs.some((d) => samePath(d, plugin));
  const enabled = selection === true;
  const disabled = selection === false;
  const supported = versionText === null ? null : versionAtLeast(versionText);
  return {
    plugin, configDir, copied, enabled, disabled, registered, direct, dirs, supported,
    launchReady: copied && !disabled && ((enabled && !registered) || direct),
  };
}

// `{CLAUDE_CODE_PLUGIN_DIRS}` only for a copied mod the owner selected that Claude Code does not already load natively
// (a second direct dir would register the tools twice), or one already in the worker's direct dirs.
export function pluginEnv(root, workerProvider, env = process.env) {
  const state = filePluginState(root, workerProviderEnv(workerProvider, env));
  if (!state.copied || state.disabled) return {};
  if (!(state.enabled && !state.registered) && !state.direct) return {};
  const dirs = state.direct ? state.dirs : [...state.dirs, state.plugin];
  return { CLAUDE_CODE_PLUGIN_DIRS: dirs.join(path.delimiter) };
}
