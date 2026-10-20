// Read-only git inspection for the flow helper (argv, no shell).
import { spawnSync } from "node:child_process";

export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")}: ${(r.stderr || String(r.error ?? "failed")).trim().split("\n")[0]}`);
  return { code: r.status ?? -1, out: (r.stdout ?? "").replace(/\r/g, "") };
}

export const gitLines = (cwd, args, opts) => git(cwd, args, opts).out.split("\n").filter(Boolean);

export function head(cwd) {
  const r = git(cwd, ["rev-parse", "HEAD"], { allowFail: true });
  return r.code === 0 ? r.out.trim() : null;
}

// Porcelain status as [{path, code}] (renames give the new path); untracked files listed one by one.
export function status(cwd) {
  const raw = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).out;
  const parts = raw.split("\0").filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    entries.push({ path: parts[i].slice(3), code });
    if (code[0] === "R" || code[0] === "C") i++;
  }
  return entries;
}
