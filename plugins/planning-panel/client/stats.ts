// Stats tiles (PANL-19): pure over the index. No task-level count is derived (no artifact records task
// completion); every percentage is null when the index scope is not complete or a SUMMARY could not be parsed (INV-36).
import { type IndexFile, type PlanningIndex, planCompletion } from "../shared/planning.ts";

export const DAYS_SHOWN = 14;
const DAY_MS = 86_400_000;

export interface Stats {
  phases: { total: number; done: number; open: number; pct: number | null };
  plans: { total: number; done: number; pct: number | null };
  waves: { wave: number | null; total: number; done: number }[];
  summariesByStatus: { status: string; count: number }[];
  filesPerDay: { day: string; count: number }[];
  blocked: { planId: string; waitingOn: string[] }[];
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeStats(index: Pick<PlanningIndex, "files" | "phases" | "scope">, nowMs: number): Stats {
  const complete = index.scope === "complete";
  const pct = (done: number, total: number) => (complete && total > 0 ? Math.round((done / total) * 100) : null);
  // Plan ids exist only on live phase inventory (not superseded/ copies), see server/kinds.ts.
  const plans = index.files.filter((f) => f.kind === "plan" && f.planId);
  const summaries = new Map<string, IndexFile>(index.files.filter((f) => f.kind === "summary" && f.planId).map((f) => [f.planId!, f]));
  const isDone = (planId: string) => planCompletion(summaries.get(planId)) === "done";
  const unknown = plans.some((p) => planCompletion(summaries.get(p.planId!)) === "unknown");
  const donePhases = index.phases.filter((p) => p.status === "COMPLETE").length;
  const waves = new Map<number | null, { total: number; done: number }>();
  for (const p of plans) {
    const w = waves.get(p.wave) ?? { total: 0, done: 0 };
    w.total += 1;
    if (isDone(p.planId!)) w.done += 1;
    waves.set(p.wave, w);
  }
  const byStatus = new Map<string, number>();
  for (const s of summaries.values()) {
    const key = s.error ? "(unparsed)" : (s.status ?? "(no status)");
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  const today = new Date(nowMs);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => localDay(startOfToday - (DAYS_SHOWN - 1 - i) * DAY_MS + DAY_MS / 2));
  const perDay = new Map(days.map((d) => [d, 0]));
  for (const f of index.files) {
    const d = localDay(f.mtimeMs);
    if (perDay.has(d)) perDay.set(d, perDay.get(d)! + 1);
  }
  const donePlans = plans.filter((p) => isDone(p.planId!)).length;
  return {
    phases: { total: index.phases.length, done: donePhases, open: index.phases.length - donePhases, pct: pct(donePhases, index.phases.length) },
    plans: { total: plans.length, done: donePlans, pct: unknown ? null : pct(donePlans, plans.length) },
    waves: [...waves].sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity)).map(([wave, w]) => ({ wave, ...w })),
    summariesByStatus: [...byStatus].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
    filesPerDay: days.map((day) => ({ day, count: perDay.get(day)! })),
    blocked: plans
      .filter((p) => !isDone(p.planId!))
      .map((p) => ({ planId: p.planId!, waitingOn: p.dependsOn.filter((d) => !isDone(d)) }))
      .filter((b) => b.waitingOn.length > 0),
  };
}
