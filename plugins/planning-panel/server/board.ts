// Phases and their plans per wave (PANL-15, PANL-19 input). A plan is done when its SUMMARY exists and its
// `status` is not halted/failed; percentages are null unless the index scope is complete (INV-36).
import type { BoardPhase, IndexFile, IndexPhase, Scope } from "../shared/planning.ts";
import { PHASE_STATUSES, summaryDone } from "../shared/planning.ts";
import { phaseOf } from "./kinds.ts";

export function phasesOf(files: readonly IndexFile[]): Omit<IndexPhase, "status">[] {
  const byDir = new Map<string, Omit<IndexPhase, "status">>();
  for (const f of files) {
    const p = phaseOf(f.path);
    if (p && !byDir.has(p.dir)) byDir.set(p.dir, p);
  }
  const num = (id: string) => id.split(".").map(Number);
  return [...byDir.values()].sort((a, b) => {
    const x = num(a.id);
    const y = num(b.id);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return a.dir.localeCompare(b.dir);
  });
}

// Signature of a phase directory for the status cache: its files and mtimes.
export function phaseSignature(files: readonly IndexFile[], dir: string): string {
  return files
    .filter((f) => f.path.startsWith(`${dir}/`))
    .map((f) => `${f.path}:${f.mtimeMs}`)
    .join("|");
}

const pct = (done: number, total: number, scope: Scope) => (scope === "complete" && total > 0 ? Math.round((done / total) * 100) : null);

export function boardPhase(phase: IndexPhase, files: readonly IndexFile[], scope: Scope): BoardPhase {
  const inDir = files.filter((f) => f.path.startsWith(`${phase.dir}/`));
  const plans = inDir.filter((f) => f.kind === "plan" && f.planId);
  const summaries = new Map(inDir.filter((f) => f.kind === "summary" && f.planId).map((f) => [f.planId!, f]));
  const waves = new Map<number | null, { total: number; done: number }>();
  let done = 0;
  for (const p of plans) {
    const s = summaries.get(p.planId!);
    const isDone = s !== undefined && summaryDone(s.status);
    if (isDone) done += 1;
    const w = waves.get(p.wave) ?? { total: 0, done: 0 };
    w.total += 1;
    if (isDone) w.done += 1;
    waves.set(p.wave, w);
  }
  return {
    id: phase.id,
    name: phase.name,
    dir: phase.dir,
    status: phase.status,
    plans: plans.length,
    summaries: plans.filter((p) => summaries.has(p.planId!)).length,
    done,
    pct: pct(done, plans.length, scope),
    waves: [...waves]
      .sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
      .map(([wave, w]) => ({ wave, total: w.total, done: w.done, pct: pct(w.done, w.total, scope) })),
  };
}

// Columns follow the ladder order; empty columns are kept.
export function boardColumns(phases: readonly BoardPhase[]) {
  return {
    columns: PHASE_STATUSES.map((status) => ({ status, phases: phases.filter((p) => p.status === status) })),
    unsorted: phases.filter((p) => p.status === null),
  };
}
