// The one config loader (CONF-12): kit defaults + one project overlay, merged and closed-validated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, readJsonIf } from "./lib/io.mjs";
import { ConfigError, GSD_ROLES, THINKING_LEVELS, validateAgainstSchema } from "./lib/config-schema.mjs";

export { ConfigError, GSD_ROLES, THINKING_LEVELS };

export const DEFAULTS_FILE = fileURLToPath(new URL("../harness.defaults.json", import.meta.url));
export const OVERLAY_REL = ".agents/harness.config.json";
export const MANIFEST_REL = ".agents/harness-kit.json";
export const MACHINE_KEYS = Object.freeze(["agent_providers", "agent_provider_disallowed_tools", "agent_provider_env", "main_provider_disallowed_tools"]);
export const KIT_OWNED_KEYS = Object.freeze([...MACHINE_KEYS, "first_prompt_note"]);
export const MERGED_KEYS = Object.freeze(["tiers", "tier_aliases", "platform_notes", "context_guard", "io_guard", "read_limits", "adapter", "gsd"]);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function configRoot(env = process.env, cwd = process.cwd()) {
  return path.resolve(env.PASEO_HARNESS_ROOT || cwd);
}

// File backend rule (CONF-09): the nearest ancestor that is a kit project, else the start directory.
export function discoverConfigRoot(startDir, env = process.env) {
  if (env.PASEO_HARNESS_ROOT) return path.resolve(env.PASEO_HARNESS_ROOT);
  const start = path.resolve(startDir);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, MANIFEST_REL)) || fs.existsSync(path.join(dir, OVERLAY_REL))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

function rejectForbiddenKeys(value) {
  if (Array.isArray(value)) return value.forEach(rejectForbiddenKeys);
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new ConfigError(key, "forbidden key", `invalid harness key ${key}`);
    rejectForbiddenKeys(child);
  }
}

const stripNotes = (raw) => Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_")));

export function mergeOverlay(defaults, overlay) {
  if (!isObject(overlay)) throw new ConfigError("overlay", "expected an object");
  rejectForbiddenKeys(overlay);
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith("_") || KIT_OWNED_KEYS.includes(key)) continue;
    out[key] = MERGED_KEYS.includes(key) && isObject(value) && isObject(out[key])
      ? { ...out[key], ...structuredClone(value) }
      : structuredClone(value);
  }
  return out;
}

export const validateConfig = (cfg) => validateAgainstSchema(cfg);

function readDefaults(defaultsFile) {
  const raw = readJson(defaultsFile);
  if (!isObject(raw)) throw new ConfigError("defaults", "expected an object");
  rejectForbiddenKeys(raw);
  return stripNotes(raw);
}

export function loadKitConfig({ defaultsFile = DEFAULTS_FILE } = {}) {
  return validateConfig(readDefaults(defaultsFile));
}

function readOverlay(root) {
  const file = path.join(root, OVERLAY_REL);
  try {
    return readJsonIf(file, {});
  } catch (e) {
    if (e.code === "EJSON") throw new ConfigError("overlay", `invalid JSON (${e.cause.message})`);
    throw e;
  }
}

export function loadConfig(root = configRoot(), { defaultsFile = DEFAULTS_FILE } = {}) {
  const defaults = loadKitConfig({ defaultsFile });
  return validateConfig(mergeOverlay(defaults, readOverlay(path.resolve(root))));
}

// ph doctor (CONF-08): an overlay problem is reported and the kit defaults are used; a defaults problem still throws.
export function loadConfigLenient(root = configRoot(), opts = {}) {
  const defaults = loadKitConfig(opts);
  try {
    return { cfg: loadConfig(root, opts), error: null };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { cfg: defaults, error };
  }
}

export function configProvenance(root = configRoot(), { defaultsFile = DEFAULTS_FILE } = {}) {
  const abs = path.resolve(root);
  const overlay = path.join(abs, OVERLAY_REL);
  const manifest = readJsonIf(path.join(abs, MANIFEST_REL));
  return {
    defaults: path.resolve(defaultsFile),
    overlay: fs.existsSync(overlay) ? overlay : null,
    manifest: isObject(manifest)
      ? { version: manifest.version ?? null, installedAt: manifest.installedAt ?? null, updatedAt: manifest.updatedAt ?? null }
      : null,
    warnings: [],
  };
}
