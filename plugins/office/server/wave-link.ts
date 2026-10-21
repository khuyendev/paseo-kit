// Kit run -> `.planning` wave progress for the office wave effect (OFFC-18, D-05). The one module of the plugin that reads files:
// the single named, read-only exception to OFFC-05 (D-03, D-09). It reads run.json, args.json and one phase's PLAN and SUMMARY files
// under `<project>/_workspace/_runs/<runId>` and `<project>/.planning/phases`, and nothing is ever changed on disk.
// Every path is checked after resolving links: a junction or symlink leading out of the project is never read.
// A SUMMARY that cannot be read or parsed withholds the counts; files are reparsed only when their mtime changes.
// Carried from plugins/swarm-map/server/wave-link.ts; frontmatter.ts is a byte copy of the planning panel's parser.
import { promises as fs } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  WAVE_RUN_ID_MAX_CHARS,
  WAVE_RUN_ID_PATTERN,
  WAVE_WORKSPACE_ID_MAX_CHARS,
  type WaveLink,
  type WaveOutput,
} from "../shared/wave-rpc.ts";
import { parseFrontmatter } from "./frontmatter.ts";

export const WAVE_CACHE_MAX_ENTRIES = 256;
export const WAVE_PLANS_MAX = 64;

const RUNS_REL = join("_workspace", "_runs");
const PLAN_FILE = /^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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

export interface WaveLinkerOptions {
  cacheMaxEntries?: number;
}

export class WaveLinker {
  private readonly files = new Map<string, Cached<unknown>>();
  private readonly maxEntries: number;

  constructor(options: WaveLinkerOptions = {}) {
    const max = options.cacheMaxEntries ?? WAVE_CACHE_MAX_ENTRIES;
    if (!Number.isInteger(max) || max < 1) throw new RangeError("cacheMaxEntries must be a positive integer");
    this.maxEntries = max;
  }

  get size(): number {
    return this.files.size;
  }

  clear(): void {
    this.files.clear();
  }

  // Stores a parsed file as the newest entry; the oldest inserted entry goes first when the cache is full.
  private store(file: string, entry: Cached<unknown>): void {
    this.files.delete(file);
    while (this.files.size >= this.maxEntries) {
      const oldest = this.files.keys().next();
      if (oldest.done) break;
      this.files.delete(oldest.value);
    }
    this.files.set(file, entry);
  }

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
      this.store(file, { mtimeMs, value });
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
    if (names.filter((name) => PLAN_FILE.test(name)).length > WAVE_PLANS_MAX) return unreadable;
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

type Paseo = PluginHandlerContext["paseo"];

export interface WaveDeps {
  linker?: Pick<WaveLinker, "link">;
}

function fail(code: Extract<WaveOutput, { ok: false }>["code"], message: string): WaveOutput {
  return { ok: false, code, message };
}

// Never throws: two bounded ids in, a typed envelope out. The directory comes from the workspace record, never from the input
// and never from an agent's working directory.
export function createWaveHandler(deps: WaveDeps = {}): (input: unknown, ctx: { paseo: Paseo }) => Promise<WaveOutput> {
  const linker = deps.linker ?? new WaveLinker();
  return async (input, ctx) => {
    try {
      const raw = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
      const workspaceId = raw?.workspaceId;
      const runId = raw?.runId;
      if (
        typeof workspaceId !== "string" ||
        workspaceId.length < 1 ||
        workspaceId.length > WAVE_WORKSPACE_ID_MAX_CHARS ||
        CONTROL_CHARS.test(workspaceId)
      ) {
        return fail("bad_input", `workspaceId must be 1 to ${WAVE_WORKSPACE_ID_MAX_CHARS} characters without control characters.`);
      }
      if (typeof runId !== "string" || runId.length < 1 || runId.length > WAVE_RUN_ID_MAX_CHARS || !WAVE_RUN_ID_PATTERN.test(runId)) {
        return fail("bad_input", `runId must be 1 to ${WAVE_RUN_ID_MAX_CHARS} characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit.`);
      }
      let directory: string | null;
      let known: boolean;
      try {
        const ref = ctx.paseo.workspaces.ref(workspaceId);
        const record = ref.current() ?? (await ref.refresh());
        directory = record?.workspaceDirectory ?? ref.directory ?? null;
        known = Boolean(record) || directory !== null;
      } catch {
        return fail("failed", "workspace lookup failed");
      }
      // No record and no directory is an unknown workspace; a record without a directory simply has no link.
      if (typeof directory !== "string" || directory === "") return known ? { ok: true, link: null } : fail("not_found", "workspace not found");
      try {
        return { ok: true, link: await linker.link(directory, runId) };
      } catch {
        return fail("failed", "wave link failed");
      }
    } catch {
      return fail("failed", "internal error");
    }
  };
}
