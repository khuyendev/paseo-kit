// Model and effort selection for every agent ph or the workflow runner creates (PHCL-21, PHCL-22, D-16).
import { GSD_ROLES, OVERLAY_REL, THINKING_LEVELS } from "../config.mjs";
import { UsageError } from "../lib/cli.mjs";

const stripSuffix = (model) => model.replace(/\[[^\]]*\]$/, "");

function splitId(cfg, id) {
  const at = id.indexOf("/");
  const provider = id.slice(0, at);
  return { provider: cfg.agent_providers[provider] ?? provider, model: id.slice(at + 1) };
}

// One allowlist key for `circle/x[1m]` and `circle-agent/x`: provider mapped, `[...]` suffix stripped.
export function modelKey(cfg, id) {
  const { provider, model } = splitId(cfg, id);
  return `${provider}/${stripSuffix(model)}`;
}

export function resolveModel(cfg, spec, effort) {
  if (effort !== undefined && effort !== null && !THINKING_LEVELS.includes(effort)) throw new UsageError(`unknown effort '${effort}'`);
  let name = String(spec);
  if (Object.hasOwn(cfg.tier_aliases, name) && !Object.hasOwn(cfg.tiers, name)) name = cfg.tier_aliases[name];
  let id;
  let tier = null;
  if (Object.hasOwn(cfg.tiers, name)) {
    tier = cfg.tiers[name];
    // CONF-11: the kit ships its tiers unconfigured; the adapter generator or the owner maps them.
    if (!tier.provider) throw new UsageError(`tier ${name} has no model; set tiers.${name}.provider in ${OVERLAY_REL} (the harness adapter generator writes it)`);
    id = tier.provider;
  } else if (name.includes("/")) {
    id = name;
  } else {
    throw new UsageError(`unknown model tier '${spec}' (tiers: ${Object.keys(cfg.tiers).join(", ")}; or provider/model)`);
  }
  if (cfg.allowed_models.length) {
    const want = modelKey(cfg, id);
    if (!cfg.allowed_models.some((entry) => entry.includes("/") && modelKey(cfg, entry) === want)) {
      throw new UsageError(`model ${id} is not in config allowed_models`);
    }
  }
  const { provider, model } = splitId(cfg, id);
  return {
    id: `${provider}/${model}`,
    provider,
    model,
    thinking: effort ?? tier?.thinking,
    features: tier?.features ?? {},
  };
}

export const validRoles = (cfg) => [...new Set([...GSD_ROLES, ...Object.keys(cfg.gsd.roles)])];

export function checkRole(cfg, role) {
  if (role === undefined || role === null) return;
  if (!validRoles(cfg).includes(role)) throw new UsageError(`unknown role '${role}' (roles: ${validRoles(cfg).join(", ")})`);
}

// Model and effort resolve independently: per-run argument > gsd.roles entry > definition `model:` > default_tier.
// The role is always given explicitly (--role, fanout role=, agent({role})), never inferred from the agent type.
export function selectModel({ cfg, explicit = {}, role, definition = null }) {
  checkRole(cfg, role);
  const entry = role ? cfg.gsd.roles[role] ?? {} : {};
  const model = explicit.model ?? entry.model ?? definition?.model ?? cfg.default_tier;
  const effort = explicit.effort ?? entry.effort ?? undefined;
  return resolveModel(cfg, model, effort);
}
