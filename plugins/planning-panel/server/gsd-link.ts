// Phase statuses by the GSD ladder (GSDC-13, PANL-15) bundled in this plugin (ladder.ts), recomputed on every poll
// so the board and `ph gsd roadmap analyze` agree; ROADMAP checkboxes carry no authority. Nothing is imported from
// the workspace: its files are read as data only (CR-PNL-02).
import { type PhaseStatus, phaseStatusSchema } from "../shared/planning.ts";
import { listPhaseDirs, phaseStatus } from "./ladder.ts";

export type PhaseStatusFn = (phaseDir: string) => PhaseStatus | Promise<PhaseStatus>;

export interface StatusSource {
  // Returns the ladder for a workspace, or throws with the reason it is unavailable.
  forWorkspace(directory: string): Promise<PhaseStatusFn>;
}

export class LadderStatusSource implements StatusSource {
  async forWorkspace(directory: string): Promise<PhaseStatusFn> {
    const dirs = listPhaseDirs(directory);
    return (phaseDir) => phaseStatusSchema.parse(phaseStatus(directory, dirs.find((d) => d.dir === phaseDir) ?? null));
  }
}
