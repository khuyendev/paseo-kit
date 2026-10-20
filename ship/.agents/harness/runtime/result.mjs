// The `ph result --json` object of one agent (PHCL-13), also written by `fanout --collect` before archiving.
import { costUsd, loadPrices } from "./pricing.mjs";

const seconds = (from, to) => {
  const a = Date.parse(from ?? "");
  const b = Date.parse(to ?? "");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 100) / 10 : null;
};

const isSkillCall = (item) => item?.type === "tool_call" && /^skill$/i.test(item.name ?? "");

function skillName(item) {
  const input = item.input ?? item.detail?.input ?? {};
  return input.skill ?? input.command ?? input.name ?? item.detail?.label ?? item.detail?.text ?? "?";
}

export async function skillsUsed(session, agentId) {
  const names = (await session.timeline(agentId, { limit: 1000 })).map((e) => e.item).filter(isSkillCall).map(skillName);
  return [...new Set(names)];
}

export async function resultJson(session, agent, prices = loadPrices(session.root)) {
  const model = `${agent.provider}/${agent.model}`;
  const tracked = session.usage.get(agent.id);
  // Totals exist only when this process followed the agent from creation (PCLI-11); no guess from the last turn.
  const tokens = tracked ? { turns: tracked.turns, input: tracked.input, cachedInput: tracked.cachedInput, output: tracked.output } : null;
  const usage = agent.lastUsage ?? null;
  return {
    id: agent.id,
    name: agent.title ?? null,
    status: agent.status,
    model,
    final: await session.replyText(agent.id),
    usage,
    tokens,
    costUsd: tokens ? costUsd(prices, agent.model, { ...tokens, maxContext: usage?.contextWindowUsedTokens ?? 0 }) : null,
    reportedCostUsd: tracked?.reportedCostUsd ?? usage?.totalCostUsd ?? null,
    durationS: seconds(agent.createdAt, agent.updatedAt),
    lastTurnS: seconds(agent.lastUserMessageAt, agent.updatedAt),
    skills: await skillsUsed(session, agent.id),
  };
}
