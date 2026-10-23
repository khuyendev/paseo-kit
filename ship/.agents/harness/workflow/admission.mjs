// Caller-wide admission of workflow calls beyond the run semaphore (FLOW-14): running capacity shared with teammates
// and other runs, and the live-agent cap for calls that need a new agent (PHCL-24). G133: the count and the
// reservation hold the caller's cap lock, shared with every run and spawn of the caller, until the call's agent is
// running or the call ends.
import { takeCapLock } from "../runtime/cap-lock.mjs";

const RECOUNT_MS = 5000;

export function createCapacity({ session, cfg, clock, out, root }) {
  const reservations = new Set();
  const retained = new Set();
  const wakers = new Set();

  const wake = () => {
    for (const w of [...wakers]) w();
  };
  // Resolves on an own completion or after RECOUNT_MS; the timer is cleared so no handle outlives the wait.
  const pause = () => new Promise((resolve) => {
    let timer = null;
    const done = () => {
      wakers.delete(done);
      clock.clearTimeout(timer);
      resolve();
    };
    wakers.add(done);
    timer = clock.setTimeout(done, RECOUNT_MS);
  });

  async function count(needsNew) {
    const agents = await session.listAgents(session.requireCaller());
    const ownIds = new Set([...reservations].map((r) => r.agentId).filter(Boolean));
    const runningOthers = agents.filter((a) => a.status === "running" && !ownIds.has(a.id)).length;
    const running = runningOthers + reservations.size;
    const unmade = [...reservations].filter((r) => r.needsNew && !r.agentId).length;
    const live = agents.length + unmade;
    const idle = agents.filter((a) => a.status !== "running");
    // Nothing can free a live slot when every idle agent is held by this run and no own call is about to end
    // with an archive (FLOW-14: then the call is a named null at once).
    const ownTransient = [...reservations].some((r) => !r.retain);
    const stuck = idle.every((a) => retained.has(a.id)) && !ownTransient;
    return { running, live, runOk: running < cfg.max_subagents, liveOk: !needsNew || live < cfg.max_live_subagents, stuck };
  }

  const liveReason = (live) => `live agent cap reached (${live} of ${cfg.max_live_subagents}); end sessions or archive idle agents`;

  // Count-then-reserve runs one call at a time, so concurrent calls do not all see the same free slot.
  let turn = Promise.resolve();
  const serial = (fn) => {
    const next = turn.then(fn);
    turn = next.catch(() => {});
    return next;
  };

  return {
    retain: (agentId) => retained.add(agentId),
    unretain: (agentId) => retained.delete(agentId),
    // {release(), started(agentId), keep()} once a running slot (and a live slot when needsNew) is free, or {reason}.
    admit: ({ needsNew }) => serial(() => admitOne(needsNew)),
  };

  async function admitOne(needsNew) {
    const liveDeadline = clock.now() + cfg.wait_timeout_s * 1000;
    let logged = false;
    for (;;) {
      const unlock = await takeCapLock(root, session.requireCaller(), clock);
      let n;
      try {
        n = await count(needsNew);
      } catch (e) {
        unlock();
        throw e;
      }
      if (n.runOk && n.liveOk) {
        const r = { needsNew, agentId: null, retain: false };
        reservations.add(r);
        let held = true;
        // The cap lock is released once: when the agent is running (started) or when the call ends (release).
        const free = () => {
          if (held) unlock();
          held = false;
        };
        return {
          started: (agentId) => {
            r.agentId = agentId;
            free();
          },
          keep: () => void (r.retain = true),
          release: () => {
            reservations.delete(r);
            free();
            wake();
          },
        };
      }
      unlock();
      if (!n.liveOk && (n.stuck || clock.now() >= liveDeadline)) return { reason: liveReason(n.live) };
      if (!logged) {
        out(`log waiting for a free agent slot (${n.running} running of ${cfg.max_subagents})`);
        logged = true;
      }
      await pause();
    }
  }
}
