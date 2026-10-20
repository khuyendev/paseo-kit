// Per-agent context threshold (PANL-55): the default N of `ph context --rotate-pct`, i.e. `context_guard.start_pct`
// of the effective config of the project holding the agent's cwd, read through that project's own installed
// config loader (its defaults plus its overlay). An agent outside a kit project gets the kit defaults shipped
// beside this plugin. No threshold value lives in plugin code.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROTATE_TTL_MS } from "./limits.ts";
import { errorText } from "./text.ts";

interface ConfigModule {
  discoverConfigRoot(startDir: string, env: Record<string, string | undefined>): string;
  loadConfigLenient(root: string): { cfg: { context_guard: { start_pct: number } } };
  loadKitConfig(): { context_guard: { start_pct: number } };
}

const PROJECT_LOADER_REL = join(".agents", "harness", "config.mjs");
export const KIT_CONFIG_MODULE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ship/.agents/harness/config.mjs");

async function importConfig(file: string): Promise<ConfigModule> {
  return (await import(pathToFileURL(file).href)) as ConfigModule;
}

export class RotateResolver {
  private readonly kitModule: string;
  private readonly cache = new Map<string, { atMs: number; value: number | null }>();
  private kitValue: { atMs: number; value: number } | null = null;
  readonly errors: string[] = [];

  constructor(kitModule: string = KIT_CONFIG_MODULE) {
    this.kitModule = kitModule;
  }

  private async kit(nowMs: number): Promise<{ mod: ConfigModule; pct: number }> {
    const mod = await importConfig(this.kitModule);
    if (!this.kitValue || nowMs - this.kitValue.atMs >= ROTATE_TTL_MS) this.kitValue = { atMs: nowMs, value: mod.loadKitConfig().context_guard.start_pct };
    return { mod, pct: this.kitValue.value };
  }

  // Never throws: a failure is reported once in `errors` (drained by the snapshot) and gives null.
  async forCwd(cwd: string | null, nowMs: number): Promise<number | null> {
    const key = cwd ?? "";
    const hit = this.cache.get(key);
    if (hit && nowMs - hit.atMs < ROTATE_TTL_MS) return hit.value;
    let value: number | null = null;
    try {
      const kit = await this.kit(nowMs);
      value = kit.pct;
      if (cwd) {
        // An empty env: the daemon's own PASEO_HARNESS_ROOT (if any) says nothing about this agent.
        const root = kit.mod.discoverConfigRoot(cwd, {});
        const loader = join(root, PROJECT_LOADER_REL);
        if (existsSync(loader)) value = (await importConfig(loader)).loadConfigLenient(root).cfg.context_guard.start_pct;
      }
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
