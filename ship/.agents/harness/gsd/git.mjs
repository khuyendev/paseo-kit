// git calls of the gsd verbs: argv only, never a shell, always inside the code root (GSDC-03, GSDC-38).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { unavailable } from "./common.mjs";

export const GIT_TIMEOUT_MS = 30000;

export function git(root, args, { input, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", input, timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.error?.code === "ETIMEDOUT", error: r.error ?? null };
}

// git output or a 69 "could not look" (an unreadable repo or a timeout is never an answer).
export function gitOk(root, args, opts) {
  const r = git(root, args, opts);
  if (r.timedOut) throw unavailable(`git ${args[0]} timed out`);
  if (r.error || r.code !== 0) throw unavailable(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").split("\n")[0]}`);
  return r.stdout;
}

export function headOf(root) {
  const r = git(root, ["rev-parse", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export const hasGit = (dir) => fs.existsSync(path.join(dir, ".git"));
