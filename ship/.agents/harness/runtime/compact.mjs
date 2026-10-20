// ph compact-self: a detached watcher compacts an agent once its turn ends, confirms it, then wakes the agent
// (PHCL-17, PHCL-18). Native autocompact is never touched.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PH_FILE, UsageError, errText } from "../lib/cli.mjs";
import { id8 } from "../lib/paths.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { usedPct } from "./cmd-agents.mjs";

export const WATCHER_COMMAND = "compact-run";
const POLL_MS = 3000;
const TIMEOUT_MS = 900000;
// The only reliable success signal is a large drop: a notification arriving mid-compaction cancels it and the agent
// then goes idle without having compacted.
const DONE_RATIO = 0.5;

export const tempDir = (env) => (process.platform === "win32" ? env.TEMP || env.TMP : env.TMPDIR) || os.tmpdir();

export function compactFiles(env, agentId) {
  const base = path.join(tempDir(env), `ph-compact-${id8(agentId)}`);
  return { lock: `${base}.lock`, log: `${base}.log` };
}

const lockPid = (file) => {
  try {
    return Number.parseInt(fs.readFileSync(file, "utf8"), 10);
  } catch {
    return NaN;
  }
};

// One watcher per agent: the lock holds the watcher's pid; a lock whose pid is dead is replaced.
function takeLock(file, agentId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = lockPid(file);
      if (pidAlive(pid)) throw new UsageError(`compact already armed for ${id8(agentId)} (watcher pid ${pid})`);
      fs.rmSync(file, { force: true });
    }
  }
  throw new UsageError(`compact lock ${file} could not be taken`);
}

export function spawnWatcher({ root, env, args, log }) {
  const fd = fs.openSync(log, "w");
  try {
    const child = spawn(process.execPath, [PH_FILE, WATCHER_COMMAND, ...args], {
      cwd: root, env: { ...env, PASEO_HARNESS_ROOT: root }, detached: true, windowsHide: true, stdio: ["ignore", fd, fd],
    });
    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(fd);
  }
}

export async function armCompact(ctx, session, target, { start = spawnWatcher } = {}) {
  const agent = await session.fetchAgent(target);
  if (!agent) throw new UsageError(`no agent ${target}`);
  const resume = ctx.opts.resume ?? ctx.cfg.compact_resume;
  const { lock, log } = compactFiles(ctx.env, target);
  takeLock(lock, target);
  let pid;
  try {
    pid = start({ root: ctx.root, env: ctx.env, log, args: [target, "--focus", ctx.opts.focus ?? "", "--resume", resume] });
    if (!pid) throw new Error("the watcher process did not start");
    fs.writeFileSync(lock, String(pid));
  } catch (e) {
    fs.rmSync(lock, { force: true });
    throw e;
  }
  const p = usedPct(agent);
  ctx.out(`compact armed for ${id8(target)} (context ${p === null ? "n/a" : `${p.toFixed(0)}%`}); it starts when the turn ends and the resume message follows when it is done (log ${log}). End your turn now`);
  return 0;
}

const hhmmss = (ms) => new Date(ms).toTimeString().slice(0, 8);

export async function runCompactWatcher(ctx, session, { target, focus, resume }) {
  const { lock } = compactFiles(ctx.env, target);
  const clock = ctx.clock;
  const log = (m) => ctx.out(`${hhmmss(clock.now())} ${m}`);
  const report = async (m) => {
    try {
      await session.sendPrompt(target, m);
      log(`report sent: ${m}`);
    } catch (e) {
      log(`REPORT NOT SENT (${errText(e)}): ${m}`);
    }
  };
  try {
    log(`waiting for ${id8(target)} to go idle`);
    const st = await session.waitForFinish(target, ctx.cfg.wait_timeout_s * 1000).catch((e) => ({ status: `error ${errText(e)}` }));
    if (st.status !== "idle") {
      log(`wait for idle ended with ${st.status}; /compact not sent`);
      await report("compact-self: waiting for your turn to end failed, so /compact was NOT sent. Your context is not compacted; decide yourself whether to call compact-self again.");
      return 2;
    }
    const read = () => session.fetchAgent(target).catch(() => null);
    const first = await read();
    const before = first?.lastUsage?.contextWindowUsedTokens ?? null;
    log(`idle, used ${before}; sending /compact`);
    try {
      await session.sendPrompt(target, `/compact${focus ? ` ${focus}` : ""}`);
    } catch (e) {
      log(`sending /compact failed: ${errText(e)}`);
      await report(`compact-self: sending /compact failed (${errText(e)}); your context is not compacted.`);
      return 2;
    }
    let after = null;
    let ran = false;
    for (const end = clock.now() + TIMEOUT_MS; clock.now() < end;) {
      await clock.sleep(POLL_MS);
      const a = await read();
      after = a?.lastUsage?.contextWindowUsedTokens ?? after;
      if (a?.status === "running") {
        ran = true;
        log(`compacting (used ${after})`);
        continue;
      }
      if (before && after !== null && after < before * DONE_RATIO) {
        log(`compaction done: used ${before} -> ${after}`);
        await report(resume);
        return 0;
      }
      // The compact turn ran and ended without the drop: cancelled (e.g. by a notification) or failed.
      if (ran || (a && a.updatedAt !== first?.updatedAt)) break;
    }
    log(`compaction NOT confirmed: used ${before} -> ${after}`);
    await report(`compact-self: compaction NOT confirmed (used tokens ${before} -> ${after}); it may have been cancelled by an incoming notification. Your context is probably not compacted. Decide yourself whether and when to call compact-self again.`);
    return 2;
  } finally {
    if (lockPid(lock) === process.pid) fs.rmSync(lock, { force: true });
  }
}

async function compactSelf(ctx) {
  const target = ctx.opts.agent ?? ctx.env.PASEO_AGENT_ID?.trim();
  if (!target) throw new UsageError("PASEO_AGENT_ID is not set: pass --agent or run inside a Paseo agent");
  return armCompact(ctx, await ctx.paseo(), target);
}

async function compactRun(ctx) {
  const [target] = ctx.args;
  if (!target || ctx.opts.resume === undefined) throw new UsageError(`${WATCHER_COMMAND} <agent id> --focus F --resume R (started by compact-self)`);
  return runCompactWatcher(ctx, await ctx.paseo(), { target, focus: ctx.opts.focus, resume: ctx.opts.resume });
}

export const compactCommands = [
  {
    name: "compact-self",
    summary: "compact yourself after this turn and get the resume message (stop Monitors, then end your turn)",
    usage: "ph compact-self [--focus TEXT] [--resume TEXT] [--agent ID]",
    options: { focus: "string", resume: "string", agent: "string" },
    config: "required",
    run: compactSelf,
  },
  {
    name: WATCHER_COMMAND,
    summary: "internal: the detached compact-self watcher",
    usage: `ph ${WATCHER_COMMAND} <agent id> --focus F --resume R`,
    options: { focus: "string", resume: "string" },
    config: "required",
    hidden: true,
    run: compactRun,
  },
];
