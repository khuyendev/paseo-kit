// Per-agent token sums from turn_completed events, subscribed at creation (PCLI-11, INV-15).
const SETTLE_MS = 2000;
const SETTLE_POLL_MS = 100;

const contextOf = (u) => u?.contextWindowUsedTokens ?? (u?.inputTokens ?? 0) + (u?.cachedInputTokens ?? 0);

export class UsageTracker {
  constructor(client, clock) {
    this.client = client;
    this.clock = clock;
    this.totals = new Map();
    this.seen = new Set();
    client.on("agent_stream", (message) => this.onEvent(message?.payload ?? message));
  }

  async track(ids) {
    const fresh = ids.filter((id) => id && !this.totals.has(id));
    if (!fresh.length) return;
    for (const id of fresh) this.totals.set(id, { turns: 0, input: 0, cachedInput: 0, output: 0, reportedCostUsd: null, late: 0, perTurn: [] });
    try {
      await this.client.observeTimeline(fresh).ready;
    } catch (e) {
      for (const id of fresh) this.totals.delete(id);
      throw e;
    }
  }

  onEvent(payload) {
    const event = payload?.event;
    const t = this.totals.get(payload?.agentId);
    if (!t || event?.type !== "turn_completed" || !event.usage) return;
    const key = event.turnId ?? (typeof payload.seq === "number" ? `seq${payload.seq}` : null);
    if (key) {
      const seenKey = `${payload.agentId}:${key}`;
      if (this.seen.has(seenKey)) return;
      this.seen.add(seenKey);
    }
    // waitTurn already counted this turn from the idle snapshot because its event came late.
    if (t.late > 0) {
      t.late--;
      return;
    }
    this.add(t, event.usage);
  }

  add(t, usage) {
    const turn = { input: usage.inputTokens ?? 0, cachedInput: usage.cachedInputTokens ?? 0, output: usage.outputTokens ?? 0, maxContext: contextOf(usage) };
    t.turns++;
    t.input += turn.input;
    t.cachedInput += turn.cachedInput;
    t.output += turn.output;
    // Long-context rates apply per request, so every turn keeps its own context for costing (PHCL-14).
    t.perTurn.push(turn);
    if (typeof usage.totalCostUsd === "number") t.reportedCostUsd = usage.totalCostUsd;
  }

  // After an idle turn: wait briefly for its event; when none came, count the snapshot usage and drop the late event.
  async settleTurn(agentId, turnsBefore, lastUsage, deadline = Infinity) {
    const t = this.totals.get(agentId);
    if (!t) return;
    const until = Math.min(this.clock.now() + SETTLE_MS, deadline);
    while (t.turns <= turnsBefore && this.clock.now() < until) await this.clock.sleep(Math.min(SETTLE_POLL_MS, until - this.clock.now()));
    if (t.turns <= turnsBefore && lastUsage) {
      this.add(t, lastUsage);
      t.late++;
    }
  }

  // The next prompt starts a turn: a late event still owed by the previous turn is given up as lost, so it cannot take this turn's event.
  expireLate(agentId) {
    const t = this.totals.get(agentId);
    if (t) t.late = 0;
  }

  turnsOf(agentId) {
    return this.totals.get(agentId)?.turns ?? 0;
  }

  perTurnOf(agentId) {
    return this.totals.get(agentId)?.perTurn.slice() ?? [];
  }

  tracked(agentId) {
    return this.totals.has(agentId);
  }

  get(agentId) {
    const t = this.totals.get(agentId);
    return t ? { turns: t.turns, input: t.input, cachedInput: t.cachedInput, output: t.output, reportedCostUsd: t.reportedCostUsd } : null;
  }
}
