// Live retier of a workflow run (F45B): the agents the run owns follow the overlay while the run goes. A tier that
// resolves to another model of the same provider switches each live agent of it (setModel, then the thinking level);
// a tier on another provider cannot reach a live agent, so the agent keeps its model and the next call uses the tier.
// The overlay is checked on a timer that runs only while the run owns a live agent, and it is read again only when
// its file changed.
import fs from "node:fs";
import path from "node:path";
import { OVERLAY_REL, loadConfig } from "../config.mjs";
import { errText } from "../lib/cli.mjs";
import { id8 } from "../lib/paths.mjs";

export const RETIER_TICK_MS = 5000;

const describe = ({ model, thinking }) => (thinking ? `${model} thinking ${thinking}` : model);

export function createRetier({ session, runtime, root, out, clock }) {
  const live = new Map();
  const file = path.join(root, OVERLAY_REL);
  const signature = () => {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : null;
  };
  let seen = signature();
  let timer = null;
  let chain = Promise.resolve();

  const stopTicker = () => {
    clock.clearTimeout(timer);
    timer = null;
  };

  function schedule() {
    if (timer || !live.size) return;
    timer = clock.setTimeout(() => {
      timer = null;
      chain = chain.then(check).catch((e) => out(`log warning: retier check failed: ${errText(e)}`));
      schedule();
    }, RETIER_TICK_MS);
    timer?.unref?.();
  }

  // Calls of a changed overlay run one after another, so a slow switch never overlaps the next check of the same agent.
  async function check() {
    const now = signature();
    if (now === seen) return;
    seen = now;
    let cfg;
    try {
      cfg = loadConfig(root);
    } catch (e) {
      out(`log warning: retier skipped, the overlay does not load: ${errText(e)}`);
      return;
    }
    for (const [agentId, rec] of [...live]) {
      if (live.get(agentId) === rec) await retierOne(agentId, rec, cfg);
    }
  }

  async function retierOne(agentId, rec, cfg) {
    const tier = runtime.requestedModel(cfg, rec.request);
    let sel;
    try {
      sel = runtime.selectModel(cfg, rec.request);
    } catch (e) {
      out(`log warning: retier ${rec.label} ${id8(agentId)} not resolved, the agent keeps ${describe(rec)}: ${errText(e)}`);
      return;
    }
    // A tier with no thinking level leaves the agent's current thinking as it is (null would turn thinking off).
    const thinking = sel.thinking ?? null;
    const thinkingChanged = thinking !== null && thinking !== rec.thinking;
    if (sel.id === rec.model && !thinkingChanged) return;
    if (sel.provider !== rec.provider) {
      out(`retier ${rec.label}: ${tier} moved to provider ${sel.provider}; the running agent keeps ${rec.model}, the next call uses the new tier`);
      return;
    }
    const from = describe(rec);
    try {
      if (sel.id !== rec.model) {
        await session.setModel(agentId, sel.model);
        rec.model = sel.id;
      }
      if (thinkingChanged) {
        if (await session.setThinking(agentId, sel)) rec.thinking = thinking;
        else out(`log warning: retier ${rec.label} ${id8(agentId)}: ${sel.id} offers no ${thinking} thinking; the thinking stays ${rec.thinking ?? "default"}`);
      }
    } catch (e) {
      out(`log warning: retier ${rec.label} ${id8(agentId)} failed, the agent keeps ${describe(rec)}: ${errText(e)}`);
    }
    const to = describe(rec);
    if (to === from) return;
    out(`retier ${rec.label} ${id8(agentId)}: ${from} -> ${to}`);
    rec.switches.push(`${from} -> ${to}`);
  }

  return {
    // A call's agent (created, resumed or adopted) follows the overlay from now on. The record is the call's own: its
    // model is the one the agent runs on now, and its switches are the retiers of this call.
    follow(agentId, label, identity) {
      const rec = { label, request: identity.request, provider: identity.provider, model: identity.model, thinking: identity.effort ?? null, switches: [] };
      live.set(agentId, rec);
      schedule();
      return rec;
    },
    // The agent is archived, or no longer alive for the run; the timer stops with the last live agent.
    release(agentId) {
      live.delete(agentId);
      if (!live.size) stopTicker();
    },
    close() {
      live.clear();
      stopTicker();
    },
  };
}
