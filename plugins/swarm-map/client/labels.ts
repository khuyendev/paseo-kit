// Node texts and ring values (PANL-48), pure so they are unit-tested offline.
import type { SwarmAgent, SwarmGroup, WaveLink } from "../shared/swarm.ts";
import { clip } from "./format.ts";
import { ACTIVITY_VERB, STATE_LABEL, agentState } from "./palette.ts";

export function overThreshold(a: Pick<SwarmAgent, "contextPct" | "rotatePct">): boolean {
  return a.contextPct !== null && a.rotatePct !== null && a.contextPct >= a.rotatePct;
}

// "phase 02 wave 1 · 2/4 plans", "phase 02 · 3/7 plans", "phase 02 wave 1" (counts withheld), or "unlinked".
export function waveLine(wave: WaveLink | null): string {
  if (!wave) return "unlinked";
  const head = `phase ${wave.phase}${wave.wave !== null ? ` wave ${wave.wave}` : ""}`;
  return wave.plansDone !== null && wave.plansTotal !== null ? `${head} · ${wave.plansDone}/${wave.plansTotal} plans` : head;
}

// Hub ring: wave progress when linked, else the share of running agents.
export function hubProgress(group: SwarmGroup): number {
  const w = group.wave;
  if (w && w.plansDone !== null && w.plansTotal !== null) return w.plansTotal > 0 ? w.plansDone / w.plansTotal : 0;
  const n = group.agents.length;
  return n > 0 ? group.agents.filter((a) => agentState(a) === "working").length / n : 0;
}

export function activityLine(a: SwarmAgent): string {
  if (!a.activity) return STATE_LABEL[agentState(a)];
  const verb = ACTIVITY_VERB[a.activity.kind][a.activity.status === "running" ? 0 : 1];
  return clip(`${verb} ${a.activity.label}`, 40);
}

export function accessibilityLabel(a: SwarmAgent): string {
  return `${a.title}, ${STATE_LABEL[agentState(a)]}`;
}
