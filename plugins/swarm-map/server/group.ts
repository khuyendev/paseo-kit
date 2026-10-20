// Swarm grouping (PANL-28): `ph` stamps the swarm name as label `ph.swarm`, so the label decides; the title rule
// is only the fallback for agents not created by `ph`, and never depends on the 60-char title cut.
export const SWARM_LABEL = "ph.swarm";

const COUNTER_SUFFIX = /^(.+?)\s+#?\d+(?::.*)?$/;

export function swarmName(title: string): string {
  const t = title.trim();
  if (!t) return "(untitled)";
  const counter = COUNTER_SUFFIX.exec(t);
  if (counter) return counter[1];
  const colon = t.indexOf(":");
  if (colon > 0) return t.slice(0, colon).trim();
  return t.split(/\s+/)[0];
}

export function groupName(agent: { swarm: string | null; title: string }): string {
  return agent.swarm?.trim() ? agent.swarm.trim() : swarmName(agent.title);
}
