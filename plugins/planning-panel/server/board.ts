// Phases and their plans per wave (PANL-15, PANL-19 input). A plan is done when its SUMMARY exists and its
// `status` is not halted/failed; a SUMMARY that cannot be parsed leaves the plan unknown. Percentages are null
// unless the index scope is complete and no plan is unknown (INV-36).
import type { BoardPhase, IndexFile, IndexPhase, Scope } from "../shared/planning.ts";
import { isUnderDir, PHASE_STATUSES, planCompletion } from "../shared/planning.ts";

const pct = (done: number, total: number, known: boolean) => (known && total > 0 ? Math.round((done / total) * 100) : null);

export function boardPhase(phase: IndexPhase, files: readonly IndexFile[], scope: Scope): BoardPhase {
  // Plan ids are set only on direct children of a phase directory (kinds.ts), so this is the live inventory.
  const dir = phase.dir;
  const inDir = dir === null ? [] : files.filter((f) => f.planId && isUnderDir(f.path, dir));
  const plans = inDir.filter((f) => f.kind === "plan");
  const summaries = new Map(inDir.filter((f) => f.kind === "summary").map((f) => [f.planId!, f]));
  const waves = new Map<number | null, { total: number; done: number; unknown: number }>();
  const unparsed: string[] = [];
  let done = 0;
  for (const p of plans) {
    const s = summaries.get(p.planId!);
    const state = planCompletion(s);
    if (state === "unknown") unparsed.push(s!.path);
    const w = waves.get(p.wave) ?? { total: 0, done: 0, unknown: 0 };
    w.total += 1;
    if (state === "done") {
      done += 1;
      w.done += 1;
    }
    if (state === "unknown") w.unknown += 1;
    waves.set(p.wave, w);
  }
  const complete = scope === "complete";
  return {
    id: phase.id,
    name: phase.name,
    dir: phase.dir,
    status: phase.status,
    plans: plans.length,
    summaries: plans.filter((p) => summaries.has(p.planId!)).length,
    done,
    pct: pct(done, plans.length, complete && unparsed.length === 0),
    waves: [...waves]
      .sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
      .map(([wave, w]) => ({ wave, total: w.total, done: w.done, pct: pct(w.done, w.total, complete && w.unknown === 0) })),
    unparsed,
  };
}

// Columns follow the ladder order; empty columns are kept.
export function boardColumns(phases: readonly BoardPhase[]) {
  return {
    columns: PHASE_STATUSES.map((status) => ({ status, phases: phases.filter((p) => p.status === status) })),
    unsorted: phases.filter((p) => p.status === null),
  };
}
