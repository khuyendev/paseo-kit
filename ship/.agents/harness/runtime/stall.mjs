// Silence of an agent ph started (kit feedback 127). No stream event for agent_silent_s is a stall, reported
// whatever the turn's model or tool time. The report never stops the agent and never resends a prompt.
// Steering texts stay in the workflow hub (D-35); the lines below are the report, not a prompt.
import { UsageError } from "../lib/cli.mjs";
import { id8 } from "../lib/paths.mjs";
import { PARENT_LABEL } from "../paseo-client/index.mjs";

export const STALL_POLL_MS = 10_000;
const TERMINAL = /^(completed|failed|error|canceled|cancelled)$/;

export function stallBody({ silentS, tool, openS }) {
  if (tool) return `silent ${silentS} s during ${tool} open ${openS} s (a long tool call, not an API hang)`;
  return `silent ${silentS} s (no stream event)`;
}

// The line the caller reads. It offers the two commands; this module never runs them.
export function stallReport({ name, id, silentS, tool, openS }) {
  return `stall ${name} ${id8(id)} ${stallBody({ silentS, tool, openS })}; ph stop ${id8(id)} or resend the prompt`;
}

export function resumeReport({ name, id }) {
  return `resumed ${name} ${id8(id)}`;
}

export function watchdogStallLine(label, id, detail) {
  return `log watchdog: ${label} ${id8(id)} stall: ${detail.body}; ph stop ${id8(id)} or resend the prompt`;
}

export function watchdogResumeLine(label, id) {
  return `log watchdog: ${label} ${id8(id)} resumed`;
}

export function silenceState(at) {
  return { lastEventAt: at, reported: false, tools: new Map() };
}

// Any stream event refreshes the silence clock. A running tool_call is remembered from the first time it is seen.
export function noteStream(st, item, now) {
  st.lastEventAt = now;
  if (!item || item.type !== "tool_call" || !item.callId) return;
  if (item.status === "running") {
    const row = st.tools.get(item.callId) ?? { name: item.name, openedAt: now };
    if (item.name) row.name = item.name;
    st.tools.set(item.callId, row);
    return;
  }
  if (TERMINAL.test(item.status ?? "")) st.tools.delete(item.callId);
}

export function noteUpdatedAt(st, updatedAtMs) {
  if (Number.isFinite(updatedAtMs) && updatedAtMs > st.lastEventAt) st.lastEventAt = updatedAtMs;
}

export function openToolsFromTimeline(entries) {
  const open = new Map();
  for (const e of entries ?? []) {
    const it = e?.item ?? e;
    if (it?.type !== "tool_call" || !it.callId) continue;
    if (it.status === "running") {
      const row = open.get(it.callId) ?? { name: it.name, callId: it.callId };
      if (it.name) row.name = it.name;
      open.set(it.callId, row);
    } else if (TERMINAL.test(it.status ?? "")) open.delete(it.callId);
  }
  return [...open.values()];
}

// Timeline is the authority for which calls are still open. A call the stream already timed keeps that openedAt;
// one first seen here starts at fallbackAt (the last event: the tool start when nothing followed it).
export function syncOpenTools(st, open, fallbackAt) {
  const ids = new Set(open.map((t) => t.callId));
  for (const id of st.tools.keys()) if (!ids.has(id)) st.tools.delete(id);
  for (const t of open) {
    const row = st.tools.get(t.callId);
    if (!row) st.tools.set(t.callId, { name: t.name, openedAt: fallbackAt });
    else if (t.name) row.name = t.name;
  }
}

export function longestOpen(st, now) {
  let best = null;
  for (const row of st.tools.values()) if (!best || row.openedAt < best.openedAt) best = row;
  return best ? { name: best.name || "tool", openS: Math.max(0, Math.round((now - best.openedAt) / 1000)) } : null;
}

// 'stall' once when the gap crosses the limit, 'resume' once when an event ends it, else null. 0 disables.
export function judgeSilence(st, now, silentS) {
  if (!(silentS > 0)) return null;
  if (now - st.lastEventAt >= silentS * 1000) {
    if (st.reported) return null;
    st.reported = true;
    return "stall";
  }
  if (st.reported) {
    st.reported = false;
    return "resume";
  }
  return null;
}

export function silenceDetail(st, now) {
  const open = longestOpen(st, now);
  return { silentS: Math.max(0, Math.round((now - st.lastEventAt) / 1000)), tool: open?.name, openS: open?.openS, body: stallBody({ silentS: Math.max(0, Math.round((now - st.lastEventAt) / 1000)), tool: open?.name, openS: open?.openS }) };
}

function emitSilence(st, now, silentS, out, line) {
  const kind = judgeSilence(st, now, silentS);
  if (kind) out(line(kind, silenceDetail(st, now)));
  return kind;
}

// While `fn` runs (fanout --collect's waitTurn), report this agent's silence. A failed read is not a failure of fn.
export async function watchAgent(session, agent, { clock, silentS, out }) {
  if (!(silentS > 0)) return () => {};
  const st = silenceState(clock.now());
  const name = agent.title ?? id8(agent.id);
  let stopped = false;
  let timer = null;
  const unsub = session.onAgentStream((p) => {
    if (stopped || p?.agentId !== agent.id || !p.event) return;
    noteStream(st, p.event.item, clock.now());
    emitSilence(st, clock.now(), silentS, out, (kind, detail) => (kind === "stall" ? stallReport({ name, id: agent.id, ...detail }) : resumeReport({ name, id: agent.id })));
  });
  await session.observe([agent.id]).catch(() => {});
  const sample = async () => {
    if (stopped) return;
    try {
      const fresh = await session.fetchAgent(agent.id);
      if (!fresh || fresh.archivedAt || fresh.status !== "running") return;
      noteUpdatedAt(st, Date.parse(fresh.updatedAt ?? ""));
      const page = await session.timeline(agent.id, { limit: 40 });
      syncOpenTools(st, openToolsFromTimeline(page.entries), st.lastEventAt);
      if (stopped) return;
      emitSilence(st, clock.now(), silentS, out, (kind, detail) => (kind === "stall" ? stallReport({ name, id: agent.id, ...detail }) : resumeReport({ name, id: agent.id })));
    } catch {
      // The turn's own wait reports a dead daemon; a missed sample is not a second failure.
    }
  };
  const arm = () => {
    if (stopped) return;
    timer = clock.setTimeout(() => { sample().finally(arm); }, STALL_POLL_MS);
    timer?.unref?.();
  };
  arm();
  return () => {
    stopped = true;
    if (timer) clock.clearTimeout(timer);
    unsub?.();
  };
}

function labelPair(text) {
  const eq = String(text).indexOf("=");
  if (eq <= 0 || eq === text.length - 1) throw new UsageError("--label must be key=value");
  return [text.slice(0, eq), text.slice(eq + 1)];
}

// Agents the watch covers. No --run and no --label: the caller's own subagents (or --caller's).
// --run / --label select by label across parents; --caller then keeps only that parent's.
export async function agentsForWatch(session, { caller, run, label }) {
  if (run || label) {
    const labels = {};
    if (run) labels["harness.run"] = run;
    if (label) {
      const [key, value] = labelPair(label);
      labels[key] = value;
    }
    let found = await session.findAgents(labels);
    if (caller) found = found.filter((a) => a.labels?.[PARENT_LABEL] === caller);
    return found;
  }
  if (!caller) throw new UsageError("ph watch-agents needs a caller (run ph from an agent, or pass --caller, --run or --label)");
  return session.listAgents(caller);
}

// Foreground watch. Exits only for --until-idle (no matching agent running) or an aborted signal. Never stops or resends.
export async function runWatchAgents({ session, cfg, clock, out, filter, untilIdle = false, signal }) {
  const silentS = cfg.agent_silent_s;
  const states = new Map();
  const unsub = session.onAgentStream((p) => {
    const st = states.get(p?.agentId);
    if (!st || !p?.event) return;
    noteStream(st, p.event.item, clock.now());
    emitSilence(st, clock.now(), silentS, out, (kind, detail) => (kind === "stall" ? stallReport({ name: st.name, id: st.id, ...detail }) : resumeReport({ name: st.name, id: st.id })));
  });
  try {
    while (!signal?.aborted) {
      const agents = await agentsForWatch(session, filter);
      const running = agents.filter((a) => !a.archivedAt && a.status === "running");
      const live = new Set(running.map((a) => a.id));
      if (running.length) await session.observe(running.map((a) => a.id)).catch(() => {});
      for (const a of running) {
        const at = Date.parse(a.updatedAt ?? "");
        let st = states.get(a.id);
        if (!st) {
          st = { ...silenceState(Number.isFinite(at) ? at : clock.now()), name: a.title ?? id8(a.id), id: a.id };
          states.set(a.id, st);
        }
        st.name = a.title ?? st.name;
        noteUpdatedAt(st, at);
        try {
          const page = await session.timeline(a.id, { limit: 40 });
          syncOpenTools(st, openToolsFromTimeline(page.entries), st.lastEventAt);
        } catch {
          // UpdatedAt still judges the stall; the tool name is missing until a later read works.
        }
        emitSilence(st, clock.now(), silentS, out, (kind, detail) => (kind === "stall" ? stallReport({ name: st.name, id: a.id, ...detail }) : resumeReport({ name: st.name, id: a.id })));
      }
      for (const id of states.keys()) if (!live.has(id)) states.delete(id);
      if (untilIdle && running.length === 0) return 0;
      await clock.sleep(STALL_POLL_MS);
    }
    return 0;
  } finally {
    unsub?.();
  }
}
