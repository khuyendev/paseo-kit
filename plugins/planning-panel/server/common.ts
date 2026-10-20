// Workspace directory resolution (PANL-11), typed failures (PANL-04) and containment (PANL-13).
import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PlanningErrorCode, PlanningFailure } from "../shared/planning.ts";

export type Paseo = PluginHandlerContext["paseo"];

export class PlanningError extends Error {
  readonly code: PlanningErrorCode;
  constructor(code: PlanningErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
}

export function toFailure(err: unknown, directory: string | null): PlanningFailure {
  if (err instanceof PlanningError) return { ok: false, code: err.code, message: err.message, directory };
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, code: "failed", message: firstLine(message) || "unknown error", directory };
}

export async function workspaceDirectory(paseo: Paseo, workspaceId: string): Promise<string> {
  const ref = paseo.workspaces.ref(workspaceId);
  const ws = ref.current() ?? (await ref.refresh());
  const dir = ws?.workspaceDirectory ?? ref.directory;
  if (!dir) throw new PlanningError("not_found", `Workspace ${workspaceId} has no directory`);
  return dir;
}

export const PLANNING_DIR = ".planning";

export async function planningRoot(directory: string): Promise<string> {
  const root = join(directory, PLANNING_DIR);
  try {
    if ((await fs.stat(root)).isDirectory()) return root;
  } catch {
    // absent: below
  }
  throw new PlanningError("no_planning", `${directory} has no .planning/ folder`);
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// A client path resolved inside `.planning/`: absolute paths, `..` segments and symlinks that escape are
// refused with not_found and nothing outside is read.
export async function resolveInPlanning(root: string, rel: string): Promise<string> {
  const refuse = () => new PlanningError("not_found", `no file ${rel} in .planning/`);
  if (!rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).some((s) => s === "..")) throw refuse();
  const target = resolve(root, rel);
  if (!inside(target, root)) throw refuse();
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw refuse();
  }
  if (!inside(real, await fs.realpath(root))) throw refuse();
  return real;
}
