// The GSD phase status ladder (GSDC-13, PANL-15), read-only and bundled in the plugin. Paseo compiles a plugin from
// its own folder into one CommonJS bundle, so nothing can be imported from the kit at run time, and importing a
// workspace's own modules would run project code in the daemon (CR-PNL-01, CR-PNL-02). This mirrors
// `ship/.agents/harness/gsd/status.mjs` (`phaseStatus`, `readVerification`, `fingerprint`) and the roster of
// `roadmap analyze`; tests/ui compare it with the kit on every ladder state.
import { createHash } from "node:crypto";
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PhaseStatus } from "../shared/planning.ts";
import { parseFrontmatter, type Yaml } from "./frontmatter.ts";

export const DIGEST_PREFIX = "gsdkit1:sha256:";
const PHASE_ID = /^\d+(?:\.\d+)*$/;
const PHASE_DIR = /^(\d+(?:\.\d+)*)(-|$)/;
const ROADMAP_HEADING = /^(#{2,4})\s+Phase\s+(\d+(?:\.\d+)*)\s*[:\-–—]\s*(.+?)\s*$/;
const KINDS = {
  plan: /^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md$/,
  summary: /^(\d+(?:\.\d+)*)-(\d+)-SUMMARY\.md$/,
  halt: /^(\d+(?:\.\d+)*)-(\d+)-HALT\.json$/,
} as const;
const PLAN_OR_SUMMARY = /-\d+-(PLAN|SUMMARY)\.md$/;
const VERIFICATION_STATUSES = new Set(["passed", "gaps_found", "human_needed"]);

export interface PhaseDir {
  name: string;
  number: string;
  padded: string;
  dir: string;
}

export interface RosterPhase {
  id: string;
  name: string;
  // `.planning/`-relative directory with `/`, null for a ROADMAP phase without one (NOT_STARTED).
  dir: string | null;
}

export function padPhase(id: string): string | null {
  const s = String(id ?? "").trim();
  if (!PHASE_ID.test(s)) return null;
  const [head, ...rest] = s.split(".");
  return [String(Number(head)).padStart(2, "0"), ...rest.map((p) => String(Number(p)))].join(".");
}

export function comparePhase(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

const fold = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
const isInside = (child: string, parent: string) => {
  const rel = relative(fold(parent), fold(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const toSlash = (p: string) => p.split(sep).join("/");
const rel = (root: string, abs: string) => toSlash(relative(root, abs));
const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
const textDigest = (text: string) => sha256(text.replace(/\r\n/g, "\n"));
const asArray = (v: Yaml | undefined): Yaml[] => (v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);

function readIf(file: string): string | null {
  try {
    return readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw e;
  }
}

function readJsonIf(file: string): unknown {
  const text = readIf(file);
  return text === null ? null : (JSON.parse(text) as unknown);
}

// A missing directory has no entries; any other listing failure (EACCES, EPERM) propagates, as the kit's listFiles
// does, so the phase reads as unknown and never as NOT_STARTED (G197).
function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw e;
  }
}

// Phase directories `<NN>[.<M>]-<slug>` of `.planning/phases`, by phase number; links are not followed.
export function listPhaseDirs(codeRoot: string): PhaseDir[] {
  const phases = join(codeRoot, ".planning", "phases");
  return entries(phases)
    .filter((e) => e.isDirectory() && PHASE_DIR.test(e.name))
    .map((e) => {
      const number = PHASE_DIR.exec(e.name)![1];
      return { name: e.name, number, padded: padPhase(number)!, dir: join(phases, e.name) };
    })
    .sort((a, b) => comparePhase(a.number, b.number));
}

const planSort = (a: string, b: string) => {
  const ma = /^(\d+(?:\.\d+)*)-(\d+)/.exec(a);
  const mb = /^(\d+(?:\.\d+)*)-(\d+)/.exec(b);
  if (ma && mb) return comparePhase(ma[1], mb[1]) || Number(ma[2]) - Number(mb[2]);
  return a.localeCompare(b);
};

function listFiles(phase: PhaseDir, kind: keyof typeof KINDS): string[] {
  return entries(phase.dir)
    .map((e) => e.name)
    .filter((n) => KINDS[kind].test(n))
    .sort(planSort);
}

const idOf = (name: string) => name.replace(/-(PLAN\.md|SUMMARY\.md|HALT\.json)$/, "");
const phaseFile = (phase: PhaseDir, suffix: string) => join(phase.dir, `${phase.padded}-${suffix}`);

// Covered files are read on every poll, as the kit's fingerprint reads them (CR-PNL-03): an unchanged mtime and size
// do not prove unchanged content, since a same-size rewrite with its mtime restored would keep a stale COMPLETE (G197).
function fingerprint(codeRoot: string, phase: PhaseDir, extraFiles: string[]): string {
  const own = [...listFiles(phase, "plan"), ...listFiles(phase, "summary")].map((name) => rel(codeRoot, join(phase.dir, name)));
  const verification = rel(codeRoot, phaseFile(phase, "VERIFICATION.md"));
  const files = [...new Set([...extraFiles.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")), ...own])].filter((f) => f !== verification).sort();
  const lines = files.map((f) => {
    const abs = resolve(codeRoot, f);
    if (!isInside(abs, codeRoot)) throw new Error(`covered file outside the code root: ${f}`);
    return `${f}\0${textDigest(readFileSync(abs, "utf8"))}\n`;
  });
  return `${DIGEST_PREFIX}${sha256(lines.join(""))}`;
}

const behaviorCount = (fm: Record<string, Yaml>) => {
  const v = fm.behavior_unverified;
  if (Array.isArray(v)) return v.length;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// The verification report read back: valid only when its frontmatter is consistent; stale when a covered file changed.
function readVerification(codeRoot: string, phase: PhaseDir): { exists: boolean; valid: boolean; status: string; sha: string | null } {
  const text = readIf(phaseFile(phase, "VERIFICATION.md"));
  if (text === null) return { exists: false, valid: false, status: "missing", sha: null };
  const parsed = parseFrontmatter(text);
  const sha = textDigest(text);
  if ("error" in parsed) return { exists: true, valid: false, status: "invalid", sha };
  const fm = parsed.data ?? {};
  const status = fm.status;
  const gaps = asArray(fm.gaps);
  const human = asArray(fm.human_verification);
  const behavior = behaviorCount(fm);
  const invalid =
    typeof status !== "string" ||
    !VERIFICATION_STATUSES.has(status) ||
    (status === "passed" && (gaps.length > 0 || human.length > 0 || behavior > 0)) ||
    (status === "gaps_found" && !gaps.length) ||
    (status === "human_needed" && !human.length && behavior <= 0) ||
    !Array.isArray(fm.covered_files) ||
    !fm.covered_files.length ||
    typeof fm.covered_digest !== "string" ||
    !fm.covered_digest;
  if (invalid) return { exists: true, valid: false, status: "invalid", sha };
  let stale: boolean;
  try {
    const extra = (fm.covered_files as Yaml[]).map(String).filter((f) => !PLAN_OR_SUMMARY.test(f));
    stale = fingerprint(codeRoot, phase, extra) !== fm.covered_digest;
  } catch {
    stale = true;
  }
  return { exists: true, valid: true, status: stale ? "stale" : (status as string), sha };
}

// GSDC-13: first matching row wins; a ROADMAP checkbox never changes the answer.
export function phaseStatus(codeRoot: string, phase: PhaseDir | null): PhaseStatus {
  if (!phase) return "NOT_STARTED";
  const plans = listFiles(phase, "plan").map(idOf);
  const planSet = new Set(plans);
  const summaries = listFiles(phase, "summary").map(idOf).filter((id) => planSet.has(id));
  const halted = listFiles(phase, "halt").map(idOf).filter((id) => planSet.has(id));
  const v = plans.length && summaries.length === plans.length ? readVerification(codeRoot, phase) : null;
  const completion = readJsonIf(join(phase.dir, "complete.json")) as { verification_sha?: unknown } | null;
  if (v && v.valid && v.status === "passed" && completion && completion.verification_sha === v.sha) return "COMPLETE";
  if (plans.length === 0) return "NOT_STARTED";
  if ((summaries.length > 0 && summaries.length < plans.length) || halted.length) return "IN_PROGRESS";
  if (summaries.length === 0) return "PLANNED";
  if (["stale", "gaps_found", "human_needed"].includes(v!.status)) return "NEEDS_REVIEW";
  return "EXECUTED";
}

// ROADMAP phase sections (GSDC-07 headings) in file order.
export function roadmapPhases(text: string | null): { number: string; padded: string; name: string }[] {
  if (text === null) return [];
  const out: { number: string; padded: string; name: string }[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = ROADMAP_HEADING.exec(line);
    if (m) out.push({ number: m[2], padded: padPhase(m[2])!, name: m[3].replace(/\s*\(INSERTED\)\s*$/i, "").trim() });
  }
  return out;
}

// The phases `roadmap analyze` reports (every ROADMAP phase, resolved to its directory or none), then the phase
// directories ROADMAP does not list, so an empty or roadmap-only phase is never dropped (CR-PNL-04).
export function phaseRoster(codeRoot: string): (RosterPhase & { phase: PhaseDir | null })[] {
  const dirs = listPhaseDirs(codeRoot);
  const planning = join(codeRoot, ".planning");
  const roadmap = roadmapPhases(readIf(join(planning, "ROADMAP.md")));
  const fromRoadmap = roadmap.map((rp) => {
    const phase = dirs.find((d) => d.padded === rp.padded) ?? null;
    return { id: rp.number, name: rp.name, dir: phase ? rel(planning, phase.dir) : null, phase };
  });
  const listed = new Set(roadmap.map((p) => p.padded));
  const extra = dirs
    .filter((d) => !listed.has(d.padded))
    .map((d) => ({ id: d.number, name: d.name.slice(d.number.length + 1), dir: rel(planning, d.dir), phase: d }));
  return [...fromRoadmap, ...extra].sort((a, b) => comparePhase(a.id, b.id));
}
