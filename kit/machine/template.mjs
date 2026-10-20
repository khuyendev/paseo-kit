// Provider template text rules: secret placeholders, {{HOME}}, rendering at apply, and the template schema (MACH-10, MACH-14).
import path from "node:path";
import { Fail } from "./fail.mjs";

// Env values under these keys never enter a kit file: credentials and the endpoint (MACH-10, INV-08).
export const SECRET_KEY = /TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i;
export const HOME_MARK = "{{HOME}}";
const PLACEHOLDER = /\{\{secret:(\w+)\}\}/g;
export const isPlaceholder = (value) => typeof value === "string" && /^\{\{secret:\w+\}\}$/.test(value);

export function expandHome(value, home) {
  return value.startsWith(HOME_MARK) ? path.join(home, value.slice(HOME_MARK.length)) : value;
}

// Template value -> live value: `_` keys dropped, secrets filled through `secret(name)`, {{HOME}} expanded.
export function render(value, { home, secret }) {
  if (Array.isArray(value)) return value.map((v) => render(v, { home, secret }));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, render(v, { home, secret })]));
  }
  if (typeof value !== "string") return value;
  return expandHome(value.replace(PLACEHOLDER, (_, name) => secret(name)), home);
}

const nonEmpty = (v) => (typeof v === "string" && v ? v : null);

// MACH-10 order: the endpoint from PASEO_KIT_ANTHROPIC_BASE_URL or ANTHROPIC_BASE_URL; any other secret from
// PASEO_KIT_<NAME>, a live provider on the identical endpoint, then <NAME>. A peer on another endpoint never lends (D-13).
export function secretResolver(live, env) {
  const endpoint = nonEmpty(env.PASEO_KIT_ANTHROPIC_BASE_URL) ?? nonEmpty(env.ANTHROPIC_BASE_URL);
  const peers = Object.values(live?.agents?.providers ?? {});
  return (name) => {
    const value =
      name === "ANTHROPIC_BASE_URL"
        ? endpoint
        : (nonEmpty(env[`PASEO_KIT_${name}`]) ??
          (endpoint && nonEmpty(peers.find((p) => p?.env?.ANTHROPIC_BASE_URL === endpoint && nonEmpty(p.env[name]))?.env[name])) ??
          nonEmpty(env[name]));
    if (!value) throw new Fail(`no value for the secret ${name}: set the environment variable PASEO_KIT_${name}`);
    return value;
  };
}

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const ABSOLUTE_HOME = /^(?:[A-Za-z]:[\\/]|\/(?:home|Users)\/)/;

function walkStrings(value, visit, at) {
  if (typeof value === "string") visit(value, at);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, visit, `${at}[${i}]`));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) walkStrings(v, visit, `${at}.${k}`);
}

// The canonical template shape shared by export and the shipped file (MACH-13, MACH-14): workers store no policy,
// mains store their denies including the main list. Returns error texts, [] when valid.
export function templateErrors(tpl, cfg) {
  if (!isObject(tpl) || !isObject(tpl.providers)) return ["providers: expected an object"];
  const errors = [];
  const pairs = Object.entries(cfg.agent_providers);
  const workers = new Set(pairs.map(([, w]) => w));
  const mains = new Set(pairs.map(([m]) => m));
  for (const name of [...mains, ...workers]) if (!tpl.providers[name]) errors.push(`providers.${name}: missing`);
  for (const [name, p] of Object.entries(tpl.providers)) {
    const at = `providers.${name}`;
    if (!isObject(p)) {
      errors.push(`${at}: expected an object`);
      continue;
    }
    if (!nonEmpty(p.extends)) errors.push(`${at}.extends: expected a provider name`);
    if (p.env !== undefined && !isObject(p.env)) errors.push(`${at}.env: expected an object`);
    for (const [k, v] of Object.entries(isObject(p.env) ? p.env : {})) {
      if (SECRET_KEY.test(k) && !isPlaceholder(v)) errors.push(`${at}.env.${k}: a secret field must be a {{secret:NAME}} placeholder`);
    }
    if (p.models !== undefined) {
      const ids = Array.isArray(p.models) ? p.models.map((m) => m?.id) : null;
      if (!ids || ids.some((id) => !nonEmpty(id))) errors.push(`${at}.models: expected a list of models with an id`);
      else if (new Set(ids).size !== ids.length) errors.push(`${at}.models: duplicate model id`);
    }
    if (workers.has(name)) {
      if (p.disallowedTools !== undefined) errors.push(`${at}.disallowedTools: a worker stores no policy (rendered from agent_provider_disallowed_tools)`);
      for (const k of Object.keys(cfg.agent_provider_env)) {
        if (isObject(p.env) && k in p.env) errors.push(`${at}.env.${k}: a worker stores no kit env key (rendered from agent_provider_env)`);
      }
    }
    if (mains.has(name)) {
      const have = Array.isArray(p.disallowedTools) ? p.disallowedTools : null;
      const lacks = have ? cfg.main_provider_disallowed_tools.filter((t) => !have.includes(t)) : [];
      if (!have) errors.push(`${at}.disallowedTools: expected a list`);
      else if (lacks.length) errors.push(`${at}.disallowedTools: lacks ${lacks.join(", ")}`);
    }
    walkStrings(p, (s, where) => ABSOLUTE_HOME.test(s) && errors.push(`${where}: absolute path (use {{HOME}})`), at);
  }
  return errors;
}
