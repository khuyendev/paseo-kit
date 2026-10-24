// ph runs (FLOW-42): list run directories newest first; --prune removes done and stopped runs beyond runs_keep, and dead
// running records whose runner is gone (kit feedback 118). A paused run (kit feedback 88) is kept like a failed one.
import fs from "node:fs";
import path from "node:path";
import { failedLine } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { pidAlive, processStartTimes, runnerLive } from "../lib/proc.mjs";
import { RUN_FILES, readStopRequest, runsDirOf } from "./journal.mjs";

export const RUNS_OPTIONS = Object.freeze({ prune: "bool", live: "bool", "runs-dir": "string" });
const PRUNABLE = new Set(["done", "stopped"]);

// The last phase the log named, and the last log line, for a runner that is gone (kit feedback 118 F1).
export function lastActivity(dir) {
  let text = "";
  try { text = fs.readFileSync(path.join(dir, RUN_FILES.log), "utf8"); } catch { return "(no log)"; }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "(no log)";
  const phase = [...lines].reverse().find((l) => l.startsWith("phase "));
  const last = lines.at(-1).slice(0, 180);
  if (!phase) return last;
  const title = phase.slice(6).slice(0, 80);
  return last === phase ? `phase ${title}` : `phase ${title}; ${last}`;
}

export function listRuns(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const runs = [];
  for (const ent of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    let info = null;
    try {
      info = readJsonIf(path.join(runsDir, ent.name, RUN_FILES.run));
    } catch {
      info = null;
    }
    runs.push({ id: ent.name, dir: path.join(runsDir, ent.name), info });
  }
  // Newest first by start time; run ids sort by time as well, so they break ties.
  const key = (r) => `${r.info?.startedAt ?? ""}|${r.id}`;
  return runs.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

export async function runsCommand(ctx, { startsOf = processStartTimes } = {}) {
  const runs = listRuns(runsDirOf(ctx.root, ctx.opts["runs-dir"]));
  const alive = runs.filter((r) => r.info?.status === "running" && pidAlive(r.info.pid)).map((r) => r.info.pid);
  const starts = startsOf(alive);
  const live = (r) => runnerLive(r.info, { starts });
  // A running record whose runner is gone is dead (kit feedback 118). A live one with a pending stop request says so (88).
  const shown = (r) => {
    if (r.info?.status === "running" && !live(r)) return "dead";
    return r.info?.status ?? "unknown";
  };
  const stopNote = (r) => {
    if (shown(r) !== "running") return "";
    const stop = readStopRequest(r.dir);
    return stop ? ` stop requested (${stop.at ?? "wave-boundary"}${stop.requestedAt ? ` at ${stop.requestedAt}` : ""})` : "";
  };
  const tail = (r) => (shown(r) === "dead" ? ` last: ${lastActivity(r.dir)}` : "");
  const listed = ctx.opts.live ? runs.filter(live) : runs;
  for (const r of listed) ctx.out(`${r.id} ${shown(r)} ${r.info?.startedAt ?? "-"} ${r.info?.name ?? "-"}${stopNote(r)}${tail(r)}`);
  let removed = 0;
  let code = 0;
  if (ctx.opts.prune) {
    // Done and stopped beyond runs_keep, plus every dead running record (118 F3). A live runner is never removed.
    const aged = runs.filter((r) => PRUNABLE.has(r.info?.status)).slice(ctx.cfg.runs_keep);
    const dead = runs.filter((r) => r.info?.status === "running" && !live(r));
    for (const r of [...aged, ...dead]) {
      if (live(r)) continue;
      try {
        fs.rmSync(r.dir, { recursive: true, force: true, maxRetries: 3 });
        ctx.out(`removed ${r.id}`);
        removed++;
      } catch (e) {
        ctx.out(failedLine(r.id, e));
        code = 2;
      }
    }
  }
  ctx.out(`runs: ${listed.length} listed, ${removed} removed`);
  return code;
}
