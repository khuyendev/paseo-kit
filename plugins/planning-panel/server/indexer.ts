// `.planning/` index (PANL-12): the listing is redone on every poll (no symlink is followed, at most
// INDEX_FILE_CAP files), and only files whose mtime or size changed are reread, in batches of READ_BATCH.
// Frontmatter comes from the first HEAD_BYTES, read on up to FRONTMATTER_MAX when the closing `---` is later.
// `scope` says whether the listing is complete (INV-36: percentages are withheld otherwise).
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { type IndexFile, planFrontmatterSchema, type Scope } from "../shared/planning.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { classify } from "./kinds.ts";

export const INDEX_FILE_CAP = 5000;
export const HEAD_BYTES = 4096;
export const FRONTMATTER_MAX = 64 * 1024;
export const READ_BATCH = 48;

interface Cached {
  mtimeMs: number;
  size: number;
  entry: IndexFile;
}

export interface IndexResult {
  scope: Scope;
  total: number;
  unreadable: string | null;
  files: IndexFile[];
}

async function readPrefix(file: string, bytes: number): Promise<{ text: string; size: number }> {
  const handle = await fs.open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const buffer = Buffer.alloc(Math.min(bytes, size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.toString("utf8", 0, bytesRead), size };
  } finally {
    await handle.close();
  }
}

const hasClosing = (text: string) => /\n(---|\.\.\.)[ \t]*(\r?\n|$)/.test(text.replace(/^﻿/, "").slice(3));

export async function readHead(file: string): Promise<{ text: string; overLimit: boolean }> {
  let { text, size } = await readPrefix(file, HEAD_BYTES);
  const opens = /^﻿?---[ \t]*\r?\n/.test(text);
  if (!opens || hasClosing(text) || size <= HEAD_BYTES) return { text, overLimit: false };
  ({ text, size } = await readPrefix(file, FRONTMATTER_MAX));
  return { text, overLimit: !hasClosing(text) && size > FRONTMATTER_MAX };
}

function entryFor(rel: string, mtimeMs: number, head: { text: string; overLimit: boolean } | null): IndexFile {
  const info = classify(rel);
  const name = rel.split("/").pop() ?? rel;
  const entry: IndexFile = { path: rel, kind: info.kind, mtimeMs, title: name, phase: info.phase, planId: info.planId, wave: null, dependsOn: [], requirements: [], status: null, error: null };
  if (!head) return entry;
  if (head.overLimit) return { ...entry, error: { message: "frontmatter over 64 KiB", line: 1 } };
  const fm = parseFrontmatter(head.text);
  if ("error" in fm) return { ...entry, error: { message: fm.error, line: fm.line } };
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(fm.body);
  const data = fm.data ?? {};
  entry.title = heading?.[1] ?? (typeof data.title === "string" ? data.title : name);
  if (info.kind === "plan") {
    const plan = planFrontmatterSchema.safeParse(data);
    if (!plan.success) return { ...entry, error: { message: `invalid plan frontmatter: ${plan.error.issues[0]?.path.join(".")}`, line: 1 } };
    entry.wave = plan.data.wave;
    entry.dependsOn = plan.data.depends_on;
    entry.requirements = plan.data.requirements;
  }
  if (info.kind === "summary" && data.status !== null && data.status !== undefined) entry.status = String(data.status);
  return entry;
}

type ReadDir = (dir: string) => Promise<import("node:fs").Dirent[]>;
const realReadDir: ReadDir = (dir) => fs.readdir(dir, { withFileTypes: true });

export class PlanningIndexer {
  private readonly cache = new Map<string, Map<string, Cached>>();
  private readonly readdir: ReadDir;
  // Files whose content was read, for the PANL-07 cache test.
  reads = 0;

  constructor(readdir: ReadDir = realReadDir) {
    this.readdir = readdir;
  }

  async index(root: string): Promise<IndexResult> {
    const listed: string[] = [];
    let unreadable: string | null = null;
    const pending = [""];
    while (pending.length > 0) {
      const dir = pending.pop()!;
      let entries;
      try {
        entries = await this.readdir(join(root, dir));
      } catch {
        unreadable ??= dir || ".";
        continue;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) pending.push(rel);
        else if (e.isFile()) listed.push(rel);
      }
    }
    listed.sort();
    const total = listed.length;
    const kept = listed.slice(0, INDEX_FILE_CAP);
    const prev = this.cache.get(root) ?? new Map<string, Cached>();
    const next = new Map<string, Cached>();
    for (let start = 0; start < kept.length; start += READ_BATCH) {
      const batch = kept.slice(start, start + READ_BATCH);
      await Promise.all(
        batch.map(async (rel) => {
          const abs = join(root, rel);
          try {
            const st = await fs.stat(abs);
            const hit = prev.get(rel);
            if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
              next.set(rel, hit);
              return;
            }
            const md = rel.toLowerCase().endsWith(".md");
            if (md) this.reads += 1;
            const entry = entryFor(rel, st.mtimeMs, md ? await readHead(abs) : null);
            next.set(rel, { mtimeMs: st.mtimeMs, size: st.size, entry });
          } catch {
            unreadable ??= rel;
          }
        }),
      );
    }
    this.cache.set(root, next);
    const scope: Scope = unreadable ? "unreadable" : total > INDEX_FILE_CAP ? "truncated" : "complete";
    return { scope, total, unreadable, files: kept.flatMap((rel) => (next.has(rel) ? [next.get(rel)!.entry] : [])) };
  }
}
