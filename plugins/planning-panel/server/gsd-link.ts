// Phase statuses come from the kit's own GSD ladder (GSDC-13, PANL-15), never a copy: `phaseStatus` of the
// workspace's installed `.agents/harness/gsd/` when it has one, else of the kit's `ship/` beside this plugin. So
// the board and `ph gsd roadmap analyze` agree by construction; ROADMAP checkboxes carry no authority.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type PhaseStatus, phaseStatusSchema } from "../shared/planning.ts";

const GSD_REL = join(".agents", "harness", "gsd");
export const KIT_GSD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ship", GSD_REL);

export type PhaseStatusFn = (phaseDir: string) => PhaseStatus | Promise<PhaseStatus>;

export interface StatusSource {
  // Returns the ladder for a workspace, or throws with the reason it is unavailable.
  forWorkspace(directory: string): Promise<PhaseStatusFn>;
}

interface GsdModules {
  phaseStatus(codeRoot: string, phase: unknown): { status: string };
  findPhase(root: string, ref: string): unknown;
}

async function load(gsdDir: string): Promise<GsdModules> {
  const file = (name: string) => join(gsdDir, name);
  if (!existsSync(file("status.mjs")) || !existsSync(file("planning.mjs"))) throw new Error(`GSD status module not found (${gsdDir})`);
  const status = (await import(pathToFileURL(file("status.mjs")).href)) as Partial<GsdModules>;
  const planning = (await import(pathToFileURL(file("planning.mjs")).href)) as Partial<GsdModules>;
  if (typeof status.phaseStatus !== "function" || typeof planning.findPhase !== "function") throw new Error(`${gsdDir} lacks phaseStatus/findPhase`);
  return { phaseStatus: status.phaseStatus, findPhase: planning.findPhase };
}

export class ModuleStatusSource implements StatusSource {
  private readonly kitDir: string;

  constructor(kitDir: string = KIT_GSD_DIR) {
    this.kitDir = kitDir;
  }

  async forWorkspace(directory: string): Promise<PhaseStatusFn> {
    const local = join(directory, GSD_REL);
    const gsd = await load(existsSync(join(local, "status.mjs")) ? local : this.kitDir);
    return (phaseDir) => phaseStatusSchema.parse(gsd.phaseStatus(directory, gsd.findPhase(directory, phaseDir)).status);
  }
}

// Statuses cached per phase directory by the mtimes of its files (PANL-07: cheap repeated polls).
export class PhaseStatusCache {
  private readonly cache = new Map<string, { signature: string; status: PhaseStatus }>();

  async get(fn: PhaseStatusFn, phaseDir: string, signature: string): Promise<PhaseStatus> {
    const hit = this.cache.get(phaseDir);
    if (hit && hit.signature === signature) return hit.status;
    const status = await fn(phaseDir);
    this.cache.set(phaseDir, { signature, status });
    return status;
  }
}
