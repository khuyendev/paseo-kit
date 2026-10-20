// Paseo provider plan, policy lines and the additive, union-only patch (MACH-03..05, MACH-08, MACH-09, MACH-18).
import { Fail } from "./fail.mjs";
import { render } from "./template.mjs";

export const providersOf = (live) => live?.agents?.providers ?? {};
const modelIds = (p) => (Array.isArray(p?.models) ? p.models.map((m) => m?.id) : []);
const pairsOf = (cfg) => Object.entries(cfg.agent_providers);
const isList = (v) => v === undefined || v === null || Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);

// Per template provider: missing, or the template model entries it lacks (MACH-03).
export function modelPlan(live, tpl) {
  const providers = providersOf(live);
  const plan = [];
  for (const [name, p] of Object.entries(tpl.providers)) {
    if (!providers[name]) plan.push({ name, missing: true, add: [] });
    else {
      const have = new Set(modelIds(providers[name]));
      const add = listOf(p.models).filter((m) => !have.has(m.id));
      if (add.length) plan.push({ name, missing: false, add });
    }
  }
  return plan;
}

// Model ids a kit provider holds that the template no longer ships: reported, never removed (D-15).
export function retiredModels(live, tpl) {
  const providers = providersOf(live);
  return Object.entries(tpl.providers).flatMap(([name, p]) => {
    const shipped = new Set(modelIds(p));
    return providers[name] ? modelIds(providers[name]).filter((id) => id && !shipped.has(id)).map((id) => ({ name, id })) : [];
  });
}

// MACH-04 worker lines, then MACH-05 main lines: [{level: "ok"|"problem", text}].
export function policyLines(live, cfg) {
  const providers = providersOf(live);
  const lines = [];
  const required = cfg.agent_provider_disallowed_tools;
  for (const [main, worker] of pairsOf(cfg)) {
    const w = providers[worker];
    if (!w) {
      lines.push({ level: "problem", text: `agent provider ${worker} (copy of ${main}) is missing; run kit.mjs machine apply` });
      continue;
    }
    if (!isList(w.disallowedTools)) {
      lines.push({ level: "problem", text: `agent provider ${worker}: disallowedTools is not a list; owner review needed in Paseo` });
      continue;
    }
    const have = listOf(w.disallowedTools);
    const lacks = required.filter((t) => !have.includes(t));
    const envDiff = Object.entries(cfg.agent_provider_env).filter(([k, v]) => w.env?.[k] !== v);
    if (lacks.length) lines.push({ level: "problem", text: `agent provider ${worker} does not disallow ${lacks.join(", ")}; run kit.mjs machine apply` });
    if (envDiff.length) {
      const want = envDiff.map(([k, v]) => `${k}=${v}`).join(", ");
      lines.push({ level: "problem", text: `agent provider ${worker} env lacks or differs: ${want}; run kit.mjs machine apply` });
    }
    if (!lacks.length && !envDiff.length) {
      const extra = new Set(have.filter((t) => !required.includes(t))).size;
      lines.push({ level: "ok", text: `agent provider ${worker}: ${required.length} required rule(s) and the kit env present; ${extra} owner extra rule(s) preserved` });
    }
  }
  const mainList = cfg.main_provider_disallowed_tools;
  if (!mainList.length) return lines;
  for (const main of Object.keys(cfg.agent_providers)) {
    const m = providers[main];
    if (!m) lines.push({ level: "problem", text: `main provider ${main} is missing; run kit.mjs machine apply` });
    else if (!isList(m.disallowedTools)) lines.push({ level: "problem", text: `main provider ${main}: disallowedTools is not a list; owner review needed in Paseo` });
    else {
      const lacks = mainList.filter((t) => !listOf(m.disallowedTools).includes(t));
      lines.push(
        lacks.length
          ? { level: "problem", text: `main provider ${main} lacks ${lacks.join(", ")} (main sessions orchestrate through Paseo, not native subagents); run kit.mjs machine apply` }
          : { level: "ok", text: `main provider ${main}: ${mainList.join(", ")} disallowed (orchestration goes through Paseo)` },
      );
    }
  }
  return lines;
}

const union = (have, add) => [...new Set([...have, ...add])];

// The whole provider patch in memory on a copy of `live`; returns {next, changes}. Order matters: template providers
// first, then missing workers cloned from the main as the owner left it, then models, worker policy, main policy (MACH-09).
export function patchProviders(live, tpl, cfg, { home, secret }) {
  const next = structuredClone(live);
  next.agents ??= {};
  next.agents.providers ??= {};
  const providers = next.agents.providers;
  const existed = new Set(Object.keys(providers));
  const pairs = pairsOf(cfg);
  const workers = new Set(pairs.map(([, w]) => w));
  const changes = [];
  for (const name of new Set(pairs.flat())) {
    if (providers[name] && !isList(providers[name].disallowedTools)) {
      throw new Fail(`Paseo provider ${name}: disallowedTools is not a list; fix it in Paseo first`);
    }
  }
  for (const [name, p] of Object.entries(tpl.providers)) {
    if (workers.has(name) || providers[name]) continue;
    providers[name] = render(p, { home, secret });
    changes.push(`added provider ${name}`);
  }
  for (const [main, worker] of pairs) {
    if (providers[worker]) continue;
    if (existed.has(main)) {
      const copy = structuredClone(providers[main]);
      copy.label = `${copy.label ?? main} (harness agents)`;
      copy.description = `Copy of ${main} for harness agents, made by kit.mjs machine apply`;
      providers[worker] = copy;
      changes.push(`added provider ${worker} (copy of ${main})`);
    } else if (tpl.providers[worker]) {
      providers[worker] = render(tpl.providers[worker], { home, secret });
      changes.push(`added provider ${worker}`);
    } else throw new Fail(`cannot add the worker provider ${worker}: no live provider ${main} and no template entry`);
  }
  for (const [name, p] of Object.entries(tpl.providers)) {
    const live = providers[name];
    if (live.models !== undefined && !Array.isArray(live.models)) throw new Fail(`Paseo provider ${name}: models is not a list`);
    const have = new Set(modelIds(live));
    const add = listOf(p.models).filter((m) => !have.has(m.id));
    if (!add.length) continue;
    live.models = [...listOf(live.models), ...render(add, { home, secret })];
    changes.push(`added to ${name}: ${add.map((m) => m.id).join(", ")}`);
  }
  for (const worker of workers) {
    const w = providers[worker];
    const have = listOf(w.disallowedTools);
    const lacks = cfg.agent_provider_disallowed_tools.filter((t) => !have.includes(t));
    if (lacks.length) {
      w.disallowedTools = union(have, lacks);
      changes.push(`${worker} disallows ${lacks.join(", ")}`);
    }
    const envDiff = Object.entries(cfg.agent_provider_env).filter(([k, v]) => w.env?.[k] !== v);
    if (envDiff.length) {
      w.env = { ...(w.env ?? {}), ...Object.fromEntries(envDiff) };
      changes.push(`${worker} env sets ${envDiff.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  }
  for (const main of Object.keys(cfg.agent_providers)) {
    const m = providers[main];
    if (!m) throw new Fail(`main provider ${main} is missing from the Paseo config and the template has no entry for it`);
    const have = listOf(m.disallowedTools);
    const lacks = cfg.main_provider_disallowed_tools.filter((t) => !have.includes(t));
    if (!lacks.length) continue;
    m.disallowedTools = union(have, lacks);
    changes.push(`main provider ${main} disallows ${lacks.join(", ")}`);
  }
  if (tpl.metadataGeneration !== undefined && next.agents.metadataGeneration === undefined) {
    next.agents.metadataGeneration = structuredClone(tpl.metadataGeneration);
    changes.push("added metadataGeneration");
  }
  return { next, changes };
}
