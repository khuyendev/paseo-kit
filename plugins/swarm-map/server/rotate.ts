// Per-agent context threshold (PANL-55): the default N of `ph context --rotate-pct`, i.e. `context_guard.start_pct`
// of the effective config of the project holding the agent's cwd (its installed defaults plus its overlay). The
// files are read as JSON only: Paseo bundles the plugin on its own, and importing a project's config.mjs would run
// project code in the daemon (CR-PNL-01, CR-PNL-02). This mirrors config.mjs (discoverConfigRoot, mergeOverlay,
// the lenient overlay fallback) for this one key. An agent outside a kit project gets the kit defaults bundled as
// kit-defaults.json, a copy of ship/.agents/harness.defaults.json that tests/ui keep equal. No threshold value
// lives in plugin code.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import kitDefaults from "./kit-defaults.json" with { type: "json" };
import { ROTATE_TTL_MS } from "./limits.ts";
import { errorText } from "./text.ts";

const MANIFEST_REL = join(".agents", "harness-kit.json");
const OVERLAY_REL = join(".agents", "harness.config.json");
const DEFAULTS_REL = join(".agents", "harness.defaults.json");
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const validPct = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100;

// config.mjs discoverConfigRoot with an empty env: the daemon's PASEO_HARNESS_ROOT says nothing about this agent.
export function configRoot(startDir: string): string {
  const start = resolve(startDir);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, MANIFEST_REL)) || existsSync(join(dir, OVERLAY_REL))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

function hasForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbidden);
  return isObject(value) && Object.entries(value).some(([k, v]) => FORBIDDEN_KEYS.has(k) || hasForbidden(v));
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));

// The defaults' start_pct; a defaults problem is an error (config.mjs throws on it too).
export function defaultsPct(defaults: unknown, source: string): number {
  const pct = isObject(defaults) && isObject(defaults.context_guard) ? defaults.context_guard.start_pct : undefined;
  if (!validPct(pct)) throw new Error(`${source}: context_guard.start_pct is not an integer 1..100`);
  return pct;
}

// The overlay's start_pct when the overlay is usable, else null (loadConfigLenient falls back to the defaults).
function overlayPct(root: string): number | null {
  let overlay: unknown;
  try {
    overlay = readJson(join(root, OVERLAY_REL));
  } catch {
    return null;
  }
  if (!isObject(overlay) || hasForbidden(overlay)) return null;
  const guard = overlay.context_guard;
  if (!isObject(guard)) return null;
  return validPct(guard.start_pct) ? guard.start_pct : null;
}

export function projectPct(root: string): number | null {
  const defaultsFile = join(root, DEFAULTS_REL);
  if (!existsSync(defaultsFile)) return null;
  return overlayPct(root) ?? defaultsPct(readJson(defaultsFile), defaultsFile);
}

export class RotateResolver {
  private readonly kitDefaults: unknown;
  private readonly cache = new Map<string, { atMs: number; value: number | null }>();
  readonly errors: string[] = [];

  constructor(defaults: unknown = kitDefaults) {
    this.kitDefaults = defaults;
  }

  // Never throws: a failure is reported once in `errors` (drained by the snapshot) and gives null.
  async forCwd(cwd: string | null, nowMs: number): Promise<number | null> {
    const key = cwd ?? "";
    const hit = this.cache.get(key);
    if (hit && nowMs - hit.atMs < ROTATE_TTL_MS) return hit.value;
    let value: number | null = null;
    try {
      value = (cwd ? projectPct(configRoot(cwd)) : null) ?? defaultsPct(this.kitDefaults, "kit defaults");
    } catch (err) {
      this.errors.push(`rotate ${cwd ?? "(no cwd)"}: ${errorText(err)}`);
    }
    this.cache.set(key, { atMs: nowMs, value });
    return value;
  }

  drainErrors(): string[] {
    return this.errors.splice(0, this.errors.length);
  }
}
