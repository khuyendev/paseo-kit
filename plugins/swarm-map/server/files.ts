// File ledger (PANL-37, PANL-38): which agent touched each file last (its holder), the touch before by another
// agent, and who wrote it recently. Fed on every timeline read (PANL-60); in memory only (INV-38: two writers of
// one file within the window are shown as a write conflict).
import type { FileHold, FileOp } from "../shared/swarm.ts";
import { FILE_HOLD_MS, FORGET_MS, HANDOFF_WINDOW_MS, HOLDS_PER_AGENT } from "./limits.ts";
import { baseName } from "./text.ts";

export interface FileTouch {
  agentId: string;
  op: FileOp;
  at: string;
}

export interface Handoff {
  path: string;
  touch: FileTouch;
  prev: FileTouch;
}

interface Entry {
  path: string;
  last: FileTouch;
  prev: FileTouch | null;
  // agent id -> time of its latest edit/write
  writers: Map<string, string>;
}

// Windows paths are case-insensitive and use either slash.
function keyOf(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function normalize(path: string): string {
  const [head, ...rest] = path.split("/");
  const out: string[] = [];
  for (const seg of rest) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${head}/${out.join("/")}`;
}

// The file a touch names (PANL-37, CR-PNL-07): absolute paths as they are, Git-Bash `/c/x` as `C:/x` when the cwd
// is a Windows path, a relative path against the agent's cwd; null for a relative path without a cwd, which the
// ledger then keeps per agent and never merges with another agent's file.
export function resolveTouchPath(file: string, cwd: string | null): string | null {
  const f = file.replace(/\\/g, "/");
  const bash = /^\/([A-Za-z])(\/|$)/.exec(f);
  if (bash && cwd !== null && /^[A-Za-z]:/.test(cwd)) return normalize(`${bash[1].toUpperCase()}:/${f.slice(3)}`);
  if (/^[A-Za-z]:\//.test(f) || f.startsWith("/")) return normalize(f);
  if (!cwd) return null;
  return normalize(`${cwd.replace(/\\/g, "/").replace(/\/+$/, "")}/${f}`);
}

const isWrite = (op: FileOp) => op === "edit" || op === "write";
const recentWriters = (e: Entry, nowMs: number) => [...e.writers.values()].filter((at) => nowMs - Date.parse(at) <= HANDOFF_WINDOW_MS).length;

export class FileLedger {
  private readonly entries = new Map<string, Entry>();

  // Records one touch; returns the handoff it causes. A repeated touch is a no-op, and a touch not newer than the
  // holder's never moves the holder (timelines of different agents are read in any order). `scope` (an agent id)
  // keeps a path that could not be resolved apart from every other agent's.
  record(path: string, touch: FileTouch, scope: string | null = null): Handoff | null {
    const key = scope === null ? keyOf(path) : `${scope}\0${keyOf(path)}`;
    const e = this.entries.get(key);
    if (!e) {
      const writers = new Map<string, string>(isWrite(touch.op) ? [[touch.agentId, touch.at]] : []);
      this.entries.set(key, { path, last: touch, prev: null, writers });
      return null;
    }
    if (isWrite(touch.op) && (e.writers.get(touch.agentId) ?? "") < touch.at) e.writers.set(touch.agentId, touch.at);
    if (touch.at <= e.last.at) return null;
    const before = e.last;
    e.last = touch;
    if (before.agentId === touch.agentId) return null;
    e.prev = before;
    return Date.parse(touch.at) - Date.parse(before.at) <= HANDOFF_WINDOW_MS ? { path: e.path, touch, prev: before } : null;
  }

  writersOf(path: string, nowMs: number): number {
    const e = this.entries.get(keyOf(path));
    return e ? recentWriters(e, nowMs) : 0;
  }

  // Holds of drawn agents touched within FILE_HOLD_MS, newest first: HOLDS_PER_AGENT per agent plus every file
  // with two or more writers; counts = files held per agent.
  holds(drawn: ReadonlySet<string>, nowMs: number): { holds: FileHold[]; counts: Map<string, number> } {
    const out: FileHold[] = [];
    for (const [key, e] of this.entries) {
      const age = nowMs - Date.parse(e.last.at);
      if (age > FORGET_MS) {
        this.entries.delete(key);
        continue;
      }
      if (age > FILE_HOLD_MS || !drawn.has(e.last.agentId)) continue;
      const prev = e.prev !== null && Date.parse(e.last.at) - Date.parse(e.prev.at) <= HANDOFF_WINDOW_MS ? e.prev : null;
      out.push({
        path: e.path,
        name: baseName(e.path),
        op: e.last.op,
        agentId: e.last.agentId,
        at: e.last.at,
        prevAgentId: prev?.agentId ?? null,
        prevOp: prev?.op ?? null,
        writers: recentWriters(e, nowMs),
      });
    }
    out.sort((a, b) => b.at.localeCompare(a.at));
    const counts = new Map<string, number>();
    const holds = out.filter((h) => {
      const n = (counts.get(h.agentId) ?? 0) + 1;
      counts.set(h.agentId, n);
      return n <= HOLDS_PER_AGENT || h.writers >= 2;
    });
    return { holds, counts };
  }
}
