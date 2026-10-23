// ph watch-run (FLOW-40): follow run logs by appended bytes and end by itself when every run has ended.
import fs from "node:fs";
import path from "node:path";
import { UsageError, oneLine } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { resolveInside } from "../lib/paths.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { RUN_FILES, checkRunId, runsDirOf, runsDirSuffix } from "./journal.mjs";

export const WATCH_USAGE = "ph watch-run RUNID... [--all | --quiet] [--from-start] [--runs-dir D]";
export const WATCH_OPTIONS = Object.freeze({ all: "bool", quiet: "bool", "from-start": "bool", "runs-dir": "string" });
const POLL_MS = 1000;
const ABSENT_MS = 60_000;
const DEAD_CHECKS = 3;
const TERMINAL = /^workflow (done|failed) /;
const SHOWN = /^(log |phase |workflow )|^agent done #\d+ .* null \(/;

function readAppended(st) {
  let fd;
  try {
    fd = fs.openSync(st.logFile, "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= st.offset) return [];
    const buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
    st.offset = size;
    // Split on byte level so a multi-byte character cut at the end of a read is held with the partial line.
    const data = Buffer.concat([st.rest, buf]);
    const lastNl = data.lastIndexOf(0x0a);
    if (lastNl < 0) {
      st.rest = data;
      return [];
    }
    st.rest = data.subarray(lastNl + 1);
    return data.subarray(0, lastNl).toString("utf8").split("\n").map((l) => l.replace(/\r$/, ""));
  } finally {
    fs.closeSync(fd);
  }
}

export async function watchRunCommand(ctx) {
  const ids = ctx.args;
  if (!ids.length) throw new UsageError(`name at least one run id: ${WATCH_USAGE}`);
  if (ctx.opts.all && ctx.opts.quiet) throw new UsageError("give --all or --quiet, not both");
  // Every id is checked before any run starts streaming, so one bad id stops the whole command.
  for (const id of ids) checkRunId(id, "run id");
  const runsDir = runsDirOf(ctx.root, ctx.opts["runs-dir"]);
  const archiveHint = runsDirSuffix(ctx.root, runsDir);
  const many = ids.length > 1;
  const runs = ids.map((id) => {
    const dir = resolveInside(runsDir, id);
    return {
      id, dir, logFile: path.join(dir, RUN_FILES.log), offset: 0, rest: Buffer.alloc(0),
      first: true, ended: false, deadChecks: 0, since: ctx.clock.now(),
    };
  });
  const say = (st, line) => ctx.out(`${many ? `[${st.id.slice(-4)}] ` : ""}${line}`);
  const end = (st, line) => {
    if (line) say(st, line);
    st.ended = true;
  };
  // --quiet: the wait is woken once, by the line that ends the watch (the end lines below are always printed).
  const shown = (line) => (ctx.opts.quiet ? TERMINAL.test(line) : ctx.opts.all || SHOWN.test(line));

  function poll(st) {
    const lines = readAppended(st);
    if (st.first && lines.length && !ctx.opts["from-start"]) {
      // A re-armed watcher summarises instead of replaying the whole log (owner 2026-10-14).
      const phase = lines.filter((l) => l.startsWith("phase ")).pop()?.slice(6) ?? "none";
      if (!ctx.opts.quiet) say(st, `resuming ${st.id}: skipped ${lines.length} earlier lines; current phase ${phase} (--from-start replays them)`);
      const terminal = lines.find((l) => TERMINAL.test(l));
      if (terminal) return end(st, terminal);
    } else {
      for (const line of lines) {
        if (shown(line)) say(st, line);
        if (TERMINAL.test(line)) return end(st);
      }
    }
    st.first = false;
    const now = ctx.clock.now();
    if (!fs.existsSync(st.dir)) {
      if (now - st.since >= ABSENT_MS) end(st, `workflow not found (no ${st.dir})`);
      return;
    }
    const info = readJsonIf(path.join(st.dir, RUN_FILES.run));
    if (!info) {
      if (now - st.since >= ABSENT_MS) end(st, `workflow not started (no run.json in ${st.dir})`);
      return;
    }
    if (info.status !== "running") {
      // The runner writes run.json before its terminal log line, so the next poll reads that line before this fallback.
      if (!st.settling) {
        st.settling = true;
        return;
      }
      const why = info.stopReason ? `; reason: ${oneLine(info.stopReason)}` : info.error ? `; error: ${oneLine(info.error)}` : "";
      return end(st, `workflow ended (run.json status ${info.status}${why})`);
    }
    // Three consecutive dead checks, so a runner that just wrote its last line is not taken for dead.
    if (pidAlive(info.pid)) st.deadChecks = 0;
    else if (++st.deadChecks >= DEAD_CHECKS) end(st, `workflow interrupted (runner pid ${info.pid} is gone; end it with: ph archive --run ${st.id}${archiveHint})`);
  }

  for (;;) {
    for (const st of runs) if (!st.ended) poll(st);
    if (runs.every((st) => st.ended)) return 0;
    await ctx.clock.sleep(POLL_MS);
  }
}
