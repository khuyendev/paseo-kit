// Swarm hub -> `.planning` wave progress (PANL-61). A group whose agents carry `harness.run=<runId>` (stamped by
// `ph`, PCLI-08) is linked through `<project>/_workspace/_runs/<runId>/args.json`: `phaseDir` (inside the
// project's `.planning/phases/`) and optionally `wave`. Counts come from that phase's PLAN and SUMMARY files; no
// title parsing, no temp-dir scan. Files are reparsed only when their mtime changes.
import { promises as fs } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { WaveLink } from "../shared/swarm.ts";

export const RUN_LABEL = "harness.run";
const RUNS_REL = join("_workspace", "_runs");
const PLAN_FILE = /^(\d+(?:\.\d+)?)-(\d+)-PLAN\.md$/;

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

// Plan-level completion from a SUMMARY `status`: absent status counts as done; `halted`/`failed` do not (GSDC-13).
export function summaryDone(status: string | null): boolean {
  return status === null || !/^(halted|failed)$/i.test(status.trim());
}

// One top-level scalar of a frontmatter block (`wave: 2`, `status: halted`), quotes and comments stripped.
export function frontmatterScalar(text: string, key: string): string | null {
  const head = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!head.startsWith("---\n")) return null;
  const end = head.indexOf("\n---", 3);
  const block = end === -1 ? head : head.slice(0, end);
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(block);
  if (!m) return null;
  const value = m[1].replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
  return value === "" ? null : value;
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export class WaveLinker {
  private readonly files = new Map<string, Cached<unknown>>();

  // Reads and parses a file only when its mtime changed; null when it is missing or cannot be read or parsed.
  private async cachedRead<T>(file: string, parse: (text: string) => T): Promise<{ value: T } | null> {
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(file)).mtimeMs;
    } catch {
      this.files.delete(file);
      return null;
    }
    const hit = this.files.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return { value: hit.value as T };
    try {
      const value = parse(await fs.readFile(file, "utf8"));
      this.files.set(file, { mtimeMs, value });
      return { value };
    } catch {
      return null;
    }
  }

  async link(project: string | null, runId: string | null): Promise<WaveLink | null> {
    if (!project || !runId || /[\\/]|^\.\.?$/.test(runId)) return null;
    const runDir = join(project, RUNS_REL, runId);
    const parseJson = (t: string) => JSON.parse(t.replace(/^﻿/, "")) as unknown;
    const run = await this.cachedRead(join(runDir, "run.json"), parseJson);
    const args = await this.cachedRead(join(runDir, "args.json"), parseJson);
    if (run === null || args === null || !args.value || typeof args.value !== "object") return null;
    const { phaseDir, wave } = args.value as { phaseDir?: unknown; wave?: unknown };
    if (typeof phaseDir !== "string" || !phaseDir.trim()) return null;
    const phasesRoot = resolve(project, ".planning", "phases");
    const dir = resolve(project, phaseDir);
    if (!isInside(dir, phasesRoot)) return null;
    const phase = /^(\d+(?:\.\d+)?)/.exec(basename(dir))?.[1];
    if (!phase) return null;
    const waveNo = typeof wave === "number" && Number.isInteger(wave) ? wave : null;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return { phase, wave: waveNo, plansDone: null, plansTotal: null, scope: "unreadable" };
    }
    let total = 0;
    let done = 0;
    for (const name of names) {
      const m = PLAN_FILE.exec(name);
      if (!m) continue;
      const planWave = await this.cachedRead(join(dir, name), (t) => Number(frontmatterScalar(t, "wave") ?? NaN));
      if (planWave === null) return { phase, wave: waveNo, plansDone: null, plansTotal: null, scope: "unreadable" };
      if (waveNo !== null && planWave.value !== waveNo) continue;
      total += 1;
      const summary = await this.cachedRead(join(dir, `${m[1]}-${m[2]}-SUMMARY.md`), (t) => frontmatterScalar(t, "status"));
      if (summary !== null && summaryDone(summary.value)) done += 1;
    }
    return { phase, wave: waveNo, plansDone: done, plansTotal: total, scope: "complete" };
  }
}
