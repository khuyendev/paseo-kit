// ph runs (FLOW-42): list run directories newest first; --prune removes done and stopped runs beyond runs_keep. A paused run
// (kit feedback 88) is kept like a failed one: it is to be continued.
import fs from "node:fs";
import path from "node:path";
import { failedLine } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { RUN_FILES, readStopRequest, runsDirOf } from "./journal.mjs";

export const RUNS_OPTIONS = Object.freeze({ prune: "bool", "runs-dir": "string" });
const PRUNABLE = new Set(["done", "stopped"]);

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

export async function runsCommand(ctx) {
  const runs = listRuns(runsDirOf(ctx.root, ctx.opts["runs-dir"]));
  // A running run with a pending stop request says so (kit feedback 88).
  const stopNote = (r) => {
    if (r.info?.status !== "running") return "";
    const stop = readStopRequest(r.dir);
    return stop ? ` stop requested (${stop.at ?? "wave-boundary"}${stop.requestedAt ? ` at ${stop.requestedAt}` : ""})` : "";
  };
  for (const r of runs) ctx.out(`${r.id} ${r.info?.status ?? "unknown"} ${r.info?.startedAt ?? "-"} ${r.info?.name ?? "-"}${stopNote(r)}`);
  let removed = 0;
  let code = 0;
  if (ctx.opts.prune) {
    const candidates = runs.filter((r) => PRUNABLE.has(r.info?.status));
    for (const r of candidates.slice(ctx.cfg.runs_keep)) {
      if (pidAlive(r.info.pid)) continue;
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
  ctx.out(`runs: ${runs.length} listed, ${removed} removed`);
  return code;
}
