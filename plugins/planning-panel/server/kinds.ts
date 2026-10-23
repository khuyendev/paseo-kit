// Artifact kind and ids from a `.planning/`-relative path (GSDC-06 filenames, GSDC-01 tree).
import type { FileKind } from "../shared/planning.ts";

// Windows folds case, so `Phases/` is the phase directory there too; other platforms keep the spelling exact.
const FOLD = process.platform === "win32" ? "i" : "";
const PHASE_DIR = new RegExp(String.raw`^phases\/(\d+(?:\.\d+)*)(?:-([^/]*))?\/`, FOLD);
const PLAN_ARTIFACT = /^(\d+(?:\.\d+)*)-(\d+)-(PLAN|SUMMARY|CONTEXT|RESEARCH|VERIFICATION|UAT|WIRING|OUTLINE-REVIEW)\.md$/i;
const PHASE_ARTIFACT = /^(\d+(?:\.\d+)*)-(PLAN-OUTLINE|CONTEXT|RESEARCH|VERIFICATION|UAT|WIRING|OUTLINE-REVIEW)\.md$/i;
const TOP: Record<string, FileKind> = {
  "PROJECT.md": "project",
  "REQUIREMENTS.md": "requirements",
  "ROADMAP.md": "roadmap",
  "STATE.md": "state",
  ".continue-here.md": "continue-here",
};

export interface PathInfo {
  kind: FileKind;
  phase: string | null;
  planId: string | null;
}

export function phaseOf(rel: string): { id: string; dir: string; name: string } | null {
  const m = PHASE_DIR.exec(rel);
  return m ? { id: m[1], dir: rel.slice(0, m[0].length - 1), name: m[2] ?? "" } : null;
}

// Only a direct child of a phase directory is live phase inventory; `superseded/` and other nested copies keep
// their kind for the Files view but carry no plan id, so no board, stat or plan lookup counts them (CR-PNL-05).
const ACTIVE = new RegExp(String.raw`^phases\/[^/]+\/[^/]+$`, FOLD);

export function classify(rel: string): PathInfo {
  const name = rel.split("/").pop() ?? rel;
  const phase = phaseOf(rel)?.id ?? null;
  if (rel in TOP) return { kind: TOP[rel], phase: null, planId: null };
  const plan = PLAN_ARTIFACT.exec(name);
  if (plan) return { kind: plan[3].toLowerCase() as FileKind, phase: phase ?? plan[1], planId: ACTIVE.test(rel) ? `${plan[1]}-${plan[2]}` : null };
  const ph = PHASE_ARTIFACT.exec(name);
  if (ph) return { kind: ph[2].toLowerCase() as FileKind, phase: phase ?? ph[1], planId: null };
  const top = rel.split("/")[0];
  if (top === "debug") return { kind: "debug", phase: null, planId: null };
  if (top === "quick") return { kind: "quick", phase: null, planId: null };
  if (top === "codebase") return { kind: "codebase", phase: null, planId: null };
  if (top === "research") return { kind: "research", phase: null, planId: null };
  return { kind: "other", phase, planId: null };
}
