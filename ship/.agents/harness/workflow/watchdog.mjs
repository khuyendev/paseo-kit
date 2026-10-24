// Model-time watchdog of workflow agents (FLOW-29..FLOW-39). Armed only by the workflow runner, never for spawn or
// fanout teammates (FLOW-39). Message texts are shipped prompt text (D-35): change only with owner review.
import path from "node:path";
import { generatedMatch, generatedRules } from "../adapter/contract.mjs";
import { errText } from "../lib/cli.mjs";
import { id8 } from "../lib/paths.mjs";
import { SEARCH_TOOLS, SHELL_TOOLS, inputKey, inputOf, inputReady, readPaths, toolKind } from "./tools.mjs";

export const TICK_MS = 10_000;
export const NUDGE_TEXT = (min) => `Harness watchdog: you have used ${min} minutes of your own time since the last prompt (tool time not counted). Finish now: stop exploring, do the remaining work in bulk (one script or one batched read and edit), and give your final answer within the next 3 tool calls. If something blocks you, answer now and state the blocker.`;
export const SIGNAL_TEXT = {
  loop: (s) => `Harness watchdog: you called ${s.tool} with the same input ${s.count} times since the last prompt. That is a loop. Do not repeat it: use the result you already have or change the approach (for example one shell grep -rn with alternation), then finish the whole task; this is not a reason to stop early or return an empty result.`,
  reread: (s) => `Harness watchdog: you read ${s.file} ${s.count} times since the last prompt. Read a file once and keep what you need from it; do not open it again for one more detail. Then finish the whole task.`,
  // Kit feedback 120: generated output is named on its own, so its reread cost is not mixed with authored files.
  "reread-generated": (s) => `Harness watchdog: generated file(s) read again: ${s.files.map((f) => `${f.file} ${f.count} times${f.from ? ` (generated from ${f.from})` : ""}`).join("; ")}. Review the source and the generator command, not the output. Do not open a generated file again.`,
  piecemeal: (s) => `Harness watchdog: you made ${s.count} reads or searches without writing anything. Stop reading piece by piece: get everything you still need in one batched read (or one script), then produce the complete result.`,
};
export const STUCK_TEXT = (tool) => `Harness watchdog: your ${tool} call did not return and was interrupted. Check what it already changed (re-read the affected files), then continue the task with smaller calls (at most 3 files per batch call).`;
const TERMINAL = /^(completed|failed|error|canceled|cancelled)$/;

export function watchdogConfig(cfg) {
  return {
    enabled: cfg.watchdog_enabled,
    nudgeS: cfg.agent_nudge_s,
    stopS: cfg.agent_stop_s,
    toolStuckS: cfg.agent_tool_stuck_s,
    fileToolStuckS: cfg.agent_file_tool_stuck_s,
    repeatCalls: cfg.watchdog_repeat_calls,
    sameFileReads: cfg.watchdog_same_file_reads,
    readsWithoutWrite: cfg.watchdog_reads_without_write,
  };
}

// Model time since the last prompt: elapsed time minus the union of tool spans, clipped to [promptAt, now] (FLOW-29).
export function modelMs(st, now) {
  const open = [...st.calls.values()].filter((c) => c.inputAt !== null).map((c) => [c.inputAt, now]);
  const spans = [...st.toolSpans, ...open]
    .map(([a, b]) => [Math.max(a, st.promptAt), Math.min(b, now)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let tool = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    tool += b - Math.max(a, end);
    end = b;
  }
  return now - st.promptAt - tool;
}

// Read-kind tools get the short limit; every shell tool and anything else the long one (FLOW-35).
function stuckLimitS(cfg, name) {
  if (SHELL_TOOLS.has(name)) return cfg.toolStuckS;
  const kind = toolKind(name, null);
  return kind === "read" || kind === "write" ? cfg.fileToolStuckS : cfg.toolStuckS;
}

export function createWatchdog({ session, cfg, clock, out, root }) {
  const c = watchdogConfig(cfg);
  const genRules = generatedRules(cfg);
  const states = new Map();
  const rootSlash = `${path.resolve(root).split(path.sep).join("/").replace(/\/$/, "")}/`.toLowerCase();
  let unsubscribe = null;
  let timer = null;

  const relPath = (p) => {
    const slash = p.replace(/\\/g, "/");
    return slash.toLowerCase().startsWith(rootSlash) ? slash.slice(rootSlash.length) : slash;
  };

  const schedule = () => {
    if (timer || !states.size) return;
    timer = clock.setTimeout(() => {
      timer = null;
      hub.tick(clock.now());
      schedule();
    }, TICK_MS);
    timer?.unref?.();
  };

  const stopTicker = () => {
    if (timer && !states.size) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };

  function arm(agentId, label) {
    if (!c.enabled) return null;
    unsubscribe ??= session.onAgentStream((p) => hub.onEvent(p));
    const st = {
      agentId, label, promptAt: clock.now(), nudged: false, signals: new Set(), calls: new Map(), finished: new Set(),
      toolSpans: [], repeats: new Map(), fileReads: new Map(), readsSinceWrite: 0, generatedNoted: new Set(),
      stuckInterrupted: false, retry: null, retryBase: 0, stopped: false, stopReason: null, archived: false,
    };
    const tag = () => `log watchdog: ${label} ${id8(agentId)}`;
    const send = (text) => session.sendPrompt(agentId, text).catch((e) => out(`log watchdog: message to ${id8(agentId)} failed: ${errText(e)}`));
    st.signal = (kind, detail) => {
      if (st.signals.has(kind) || st.stopped) return;
      st.signals.add(kind);
      out(`${tag()} ${kind}: ${JSON.stringify(detail).slice(0, 160)}`);
      send(SIGNAL_TEXT[kind](detail));
    };
    // Each runner prompt starts a new measurement; the stuck flag, open calls and finished ids survive (FLOW-37).
    st.reset = () => {
      Object.assign(st, { nudged: false, promptAt: clock.now(), toolSpans: [], readsSinceWrite: 0 });
      st.signals.clear();
      st.repeats.clear();
      st.fileReads.clear();
      st.generatedNoted.clear();
    };
    st.disarm = () => {
      states.delete(agentId);
      stopTicker();
    };
    st.stop = (reason, line) => {
      st.stopped = true;
      st.stopReason = reason;
      out(`${tag()} ${line}`);
      states.delete(agentId);
      stopTicker();
      st.archived = true;
      session.archive(agentId).catch((e) => out(`log watchdog: archive ${id8(agentId)} failed: ${errText(e)}`));
    };
    st.tick = (now) => {
      if (st.stopped) return;
      const stuck = [...st.calls.values()].find((call) => call.inputAt !== null && stuckLimitS(c, call.name) > 0 && now - call.inputAt >= stuckLimitS(c, call.name) * 1000);
      if (stuck && !st.stuckInterrupted) {
        // First hang: interrupt the turn so finished work is kept; the runner waits for the retry turn (FLOW-35).
        st.stuckInterrupted = true;
        // The interrupted calls' time stays tool time and late events cannot reopen them; dropping the spans turned
        // a long shell call into model time and stopped the retry at once (CR-WFL-03, FLOW-29).
        for (const [callId, call] of st.calls) {
          if (call.inputAt !== null) st.toolSpans.push([call.inputAt, now]);
          st.finished.add(callId);
        }
        st.calls.clear();
        out(`${tag()} one ${stuck.name} call ran ${Math.round((now - stuck.inputAt) / 1000)} s without returning, interrupted`);
        st.retry = session.cancel(agentId)
          .catch((e) => out(`log watchdog: cancel ${id8(agentId)} failed: ${errText(e)}`))
          .then(() => {
            st.retryBase = session.turnsOf(agentId);
            return send(STUCK_TEXT(stuck.name));
          });
        return;
      }
      if (stuck) {
        const min = Math.round((now - stuck.inputAt) / 60000);
        return st.stop(`watchdog stopped the agent: second hung ${stuck.name} call`, `one ${stuck.name} call ran ${min} min without returning, stopped`);
      }
      const sec = modelMs(st, now) / 1000;
      const min = Math.round(sec / 60);
      if (c.stopS > 0 && sec >= c.stopS) return st.stop(`watchdog stopped the agent after ${c.stopS} s`, `used ${min} min of model time since its last prompt, stopped`);
      if (c.nudgeS > 0 && sec >= c.nudgeS && !st.nudged) {
        st.nudged = true;
        out(`${tag()} used ${min} min of model time since its last prompt, nudged to finish`);
        send(NUDGE_TEXT(min));
      }
    };
    states.set(agentId, st);
    schedule();
    return st;
  }

  function completed(st, it, call, now) {
    call.done = true;
    st.toolSpans.push([call.inputAt ?? now, now]);
    st.calls.delete(it.callId);
    st.finished.add(it.callId);
    const input = inputOf(it.detail);
    const key = call.inputKey ?? inputKey(input);
    const kind = toolKind(it.name, input);
    // A write is progress: it clears the read and repeat counters first, then counts itself (FLOW-33).
    if (kind === "write") {
      st.readsSinceWrite = 0;
      st.fileReads.clear();
      st.repeats.clear();
      st.generatedNoted.clear();
    }
    if (kind === "read") {
      st.readsSinceWrite++;
      if (!SEARCH_TOOLS.has(it.name)) {
        for (const p of readPaths(input)) {
          const rel = relPath(p);
          const entry = st.fileReads.get(rel.toLowerCase()) ?? { file: rel, count: 0 };
          entry.count++;
          st.fileReads.set(rel.toLowerCase(), entry);
        }
      }
    }
    if (key) {
      const repeatKey = `${it.name} ${key}`;
      const count = (st.repeats.get(repeatKey) ?? 0) + 1;
      st.repeats.set(repeatKey, count);
      if (c.repeatCalls > 0 && count >= c.repeatCalls) st.signal("loop", { tool: it.name, count });
    }
    if (c.sameFileReads > 0) {
      const over = [...st.fileReads.values()].filter((e) => e.count >= c.sameFileReads);
      const gen = [];
      const plain = [];
      for (const e of over) {
        const hit = generatedMatch(genRules, e.file);
        if (hit) gen.push({ file: e.file, count: e.count, ...(hit.source ? { from: hit.source } : {}) });
        else plain.push(e);
      }
      const fresh = gen.filter((e) => !st.generatedNoted.has(e.file.toLowerCase()));
      if (fresh.length) {
        for (const e of fresh) st.generatedNoted.add(e.file.toLowerCase());
        const text = fresh.map((f) => `${f.file} ${f.count} times${f.from ? ` (generated from ${f.from})` : ""}`).join("; ");
        if (st.signals.has("reread-generated")) out(`log watchdog: ${st.label} ${id8(st.agentId)} reread generated: ${text}`);
        else st.signal("reread-generated", { files: fresh });
      }
      if (plain.length) st.signal("reread", { file: plain[0].file, count: plain[0].count });
    }
    if (c.readsWithoutWrite > 0 && st.readsSinceWrite >= c.readsWithoutWrite) st.signal("piecemeal", { count: st.readsSinceWrite });
  }

  const hub = {
    arm,
    states,
    onEvent(p) {
      const st = states.get(p?.agentId);
      const it = p?.event?.item;
      if (!st || p.event?.type !== "timeline" || it?.type !== "tool_call" || !it.callId) return;
      // A fast tool can report completed before its running event; a late running event must not reopen it (FLOW-31).
      if (st.finished.has(it.callId)) return;
      const now = clock.now();
      let call = st.calls.get(it.callId);
      if (!call) {
        call = { name: it.name, inputKey: null, inputAt: null, done: false };
        st.calls.set(it.callId, call);
      }
      if (it.status === "running") {
        const input = inputOf(it.detail);
        const key = inputKey(input);
        const ready = inputReady(it.name, input);
        // The tool clock starts when the input is complete; generation time before that is model time (FLOW-30).
        if (key && key !== call.inputKey) {
          call.inputKey = key;
          if (ready) call.inputAt = now;
        } else if (call.inputAt === null && ready) call.inputAt = now;
        return;
      }
      if (call.done || !TERMINAL.test(it.status ?? "")) return;
      completed(st, it, call, now);
    },
    tick(now = clock.now()) {
      for (const st of [...states.values()]) st.tick(now);
    },
    close() {
      states.clear();
      stopTicker();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
  return hub;
}
