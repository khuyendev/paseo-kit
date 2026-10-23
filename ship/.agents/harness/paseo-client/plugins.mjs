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

// Kit feedback 84: the hooks name the mod's tools, so a mod that is not selected leaves them to whatever batch writer
// the owner still has registered. Selected = Claude Code loads it for this project, or this process loads it directly.
export const modSelected = (state) => state.enabled || state.direct;

const BATCH_SERVER_RE = /fsbatch|fs_batch|fs_proxy|server-filesystem|multiple_files/i;
const BATCH_SERVER_NAMES = new Set(["fsbatch", "filesystem"]);

function looksLikeBatchWriter(name, def) {
  if (name === "harness-files" || name.startsWith("plugin:")) return false;
  const text = [def?.command, ...(Array.isArray(def?.args) ? def.args : []), def?.url].filter((v) => typeof v === "string").join(" ");
  return BATCH_SERVER_NAMES.has(name.toLowerCase()) || BATCH_SERVER_RE.test(`${name} ${text}`);
}

// Registered MCP servers that look like a file writer with `*_multiple_files` tools, read statically (no server is
// started): user and local scope from Claude's global config, project scope from `.mcp.json`. `warnings` names a file
// that cannot be read.
export function batchWriterServers(root, env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), ".claude");
  const globals = env.CLAUDE_CONFIG_DIR ? [path.join(configDir, ".claude.json")] : [path.join(homeDir(env), ".claude.json"), path.join(configDir, ".claude.json")];
  const found = [];
  const warnings = [];
  const read = (file) => {
    try {
      return readJsonIf(file, {}) ?? {};
    } catch (e) {
      warnings.push(`${file} not read: ${String(e?.message ?? e).split(/\r?\n/)[0]}`);
      return {};
    }
  };
  const collect = (servers, scope, file) => {
    for (const [name, def] of Object.entries(servers && typeof servers === "object" ? servers : {})) {
      if (looksLikeBatchWriter(name, def)) found.push({ name, scope, file });
    }
  };
  for (const file of globals) {
    const config = read(file);
    collect(config.mcpServers, "user", file);
    for (const [project, entry] of Object.entries(config.projects ?? {})) if (samePath(project, root)) collect(entry?.mcpServers, "local", file);
  }
  const projectFile = path.join(root, ".mcp.json");
  collect(read(projectFile).mcpServers, "project", projectFile);
  return { servers: found, warnings };
}

export const batchWriterProblem = ({ name, scope, file }) =>
  `MCP server ${name} (${scope} scope, ${file}) exposes file writers while the file mod is not selected: the kit hooks name the mod's tools and the *_multiple_files writers only; remove it with: claude mcp remove --scope ${scope} ${name}, or select the mod with kit.mjs update <project> --enable-plugin`;

export const MOD_OFF_HOOK_CONSEQUENCE = "while it is not selected the harness-files tools do not exist, the io_guard reminders do not run, and syntax_check covers only Edit, Write and tools named mcp__<server>__(edit|write)_multiple_files";
