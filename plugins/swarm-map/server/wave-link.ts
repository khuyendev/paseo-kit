// Swarm hub -> `.planning` wave progress (PANL-61). A group whose agents carry `harness.run=<runId>` (stamped by
// `ph`, PCLI-08) is linked through `<project>/_workspace/_runs/<runId>/args.json`: `phaseDir` (inside the
// project's `.planning/phases/`) and optionally `wave`. Counts come from that phase's PLAN and SUMMARY files, read
// with the planning panel's conformant frontmatter parser (frontmatter.ts is a byte copy, kept equal by tests/ui);
// no title parsing, no temp-dir scan. Files are reparsed only when their mtime changes.
// Every path is checked after resolving links: a junction or symlink leading out of the project is never read
// (PANL-13 discipline, CR-PNL-11). A SUMMARY that cannot be read or parsed withholds the counts (INV-36).
import { promises as fs } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { WaveLink } from "../shared/swarm.ts";
import { parseFrontmatter } from "./frontmatter.ts";

export const RUN_LABEL = "harness.run";
const RUNS_REL = join("_workspace", "_runs");
const PLAN_FILE = /^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md$/;

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

type Read<T> = { value: T } | "missing" | "failed";

// Plan-level completion from a SUMMARY `status`: absent status counts as done; `halted`/`failed` do not (GSDC-13).
export function summaryDone(status: string | null): boolean {
  return status === null || !/^(halted|failed)$/i.test(status.trim());
}

// The frontmatter map of a GSD artifact; throws on a parse error, so the caller sees "failed".
function frontmatter(text: string): Record<string, unknown> {
  const fm = parseFrontmatter(text);
  if ("error" in fm) throw new Error(`line ${fm.line}: ${fm.error}`);
  return fm.data ?? {};
}

function isInside(child: string, parent: string, allowSame: boolean): boolean {
  const rel = relative(parent, child);
  return (allowSame && rel === "") || (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
}

// The real path of `target` when it exists and stays inside the real `root`; "missing" when absent; else "failed".
async function realInside(target: string, root: string, allowSame = false): Promise<string | "missing" | "failed"> {
  try {
    const [real, realRoot] = await Promise.all([fs.realpath(target), fs.realpath(root)]);
    return isInside(real, realRoot, allowSame) ? real : "failed";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed";
  }
}

export class WaveLinker {
  private readonly files = new Map<string, Cached<unknown>>();

  // Reads and parses `file` (contained in `root` after links) only when its mtime changed.
  private async cachedRead<T>(file: string, root: string, parse: (text: string) => T): Promise<Read<T>> {
    const real = await realInside(file, root);
    if (real === "missing" || real === "failed") {
      this.files.delete(file);
      return real;
    }
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(real)).mtimeMs;
    } catch {
      return "failed";
    }
    const hit = this.files.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return { value: hit.value as T };
    try {
      const value = parse(await fs.readFile(real, "utf8"));
      this.files.set(file, { mtimeMs, value });
      return { value };
    } catch {
      return "failed";
    }
  }

  async link(project: string | null, runId: string | null): Promise<WaveLink | null> {
    if (!project || !runId || /[\\/]|^\.\.?$/.test(runId)) return null;
    const runsRoot = join(project, RUNS_REL);
    const runDir = join(runsRoot, runId);
    const realRun = await realInside(runDir, runsRoot);
    if (realRun === "missing" || realRun === "failed" || (await realInside(runsRoot, project)) === "failed") return null;
    const parseJson = (t: string) => JSON.parse(t.replace(/^﻿/, "")) as unknown;
    const run = await this.cachedRead(join(runDir, "run.json"), runDir, parseJson);
    const args = await this.cachedRead(join(runDir, "args.json"), runDir, parseJson);
    if (typeof run === "string" || typeof args === "string" || !args.value || typeof args.value !== "object") return null;
    const { phaseDir, wave } = args.value as { phaseDir?: unknown; wave?: unknown };
    if (typeof phaseDir !== "string" || !phaseDir.trim()) return null;
    const phasesRoot = resolve(project, ".planning", "phases");
    const dir = resolve(project, phaseDir);
    if (!isInside(dir, phasesRoot, false)) return null;
    const realDir = await realInside(dir, phasesRoot);
    if (realDir === "failed" || (await realInside(phasesRoot, project)) === "failed") return null;
    const phase = /^(\d+(?:\.\d+)*)/.exec(basename(dir))?.[1];
    if (!phase) return null;
    const waveNo = typeof wave === "number" && Number.isInteger(wave) ? wave : null;
    const unreadable: WaveLink = { phase, wave: waveNo, plansDone: null, plansTotal: null, scope: "unreadable" };
    if (realDir === "missing") return unreadable;
    let names: string[];
    try {
      names = await fs.readdir(realDir);
    } catch {
      return unreadable;
    }
    let total = 0;
    let done = 0;
    for (const name of names) {
      const m = PLAN_FILE.exec(name);
      if (!m) continue;
      const planWave = await this.cachedRead(join(dir, name), realDir, (t) => {
        const w = frontmatter(t).wave;
        return typeof w === "number" ? w : Number(w ?? NaN);
      });
      if (typeof planWave === "string") return unreadable;
      if (waveNo !== null && planWave.value !== waveNo) continue;
      total += 1;
      const summary = await this.cachedRead(join(dir, `${m[1]}-${m[2]}-SUMMARY.md`), realDir, (t) => {
        const s = frontmatter(t).status;
        return s === null || s === undefined ? null : String(s);
      });
      if (summary === "failed") return unreadable;
      if (summary !== "missing" && summaryDone(summary.value)) done += 1;
    }
    return { phase, wave: waveNo, plansDone: done, plansTotal: total, scope: "complete" };
  }
}
