// `machine export`: live Paseo providers -> scrubbed canonical template paseo/providers.json; the live config is never
// changed (MACH-13, MACH-14, INV-08).
import { writeJsonAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { Fail, loadDefaults, readLive } from "./context.mjs";
import { HOME_MARK, isPlaceholder, SECRET_KEY, templateErrors } from "./template.mjs";

// Shorter values are never substituted in free text: they would corrupt unrelated words (SR-PLT-01).
const MIN_SCRUB_CHARS = 8;
const NOTES =
  "Paseo providers of paseo-kit, written by kit.mjs machine export. kit.mjs machine apply adds missing providers and " +
  "missing models only; existing providers, models and credentials are never changed or removed. The main provider " +
  "stores its disallowedTools (owner denies plus main_provider_disallowed_tools); a worker stores no disallowedTools " +
  "and none of the agent_provider_env keys: apply renders them from the kit defaults. {{HOME}} is the home folder; " +
  "{{secret:NAME}} is filled only at apply time from $PASEO_KIT_NAME, a live provider on the same ANTHROPIC_BASE_URL, " +
  "or $NAME. apply then runs paseo reload (--no-reload skips it); the daemon is never restarted.";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenPattern = (needle) => new RegExp(`(?<![A-Za-z0-9])${escape(needle)}(?![A-Za-z0-9])`, "g");

function hostOf(value) {
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

// [{needle, placeholder}] longest first, so an overlapping shorter secret never splits a longer one. The length
// floor applies to values only: a secret URL's host is scrubbed and checked whatever its length (MACH-13).
function needlesOf(secrets) {
  const needles = [];
  const add = (needle, key) => {
    if (!needles.some((n) => n.needle === needle)) needles.push({ needle, placeholder: `{{secret:${key}}}` });
  };
  for (const { key, value } of secrets) {
    if (value.length >= MIN_SCRUB_CHARS) add(value, key);
    const host = hostOf(value);
    if (host) add(host, key);
  }
  return needles.sort((a, b) => b.needle.length - a.needle.length);
}

function homePrefix(value, home) {
  const fold = (s) => (process.platform === "win32" ? s.toLowerCase() : s);
  const h = toSlash(home).replace(/\/+$/, "");
  const v = toSlash(value);
  if (fold(v) === fold(h) || fold(v).startsWith(`${fold(h)}/`)) return HOME_MARK + v.slice(h.length);
  return value;
}

// Strings (never property names): home prefix -> {{HOME}}, then whole-token secret scrubs.
function scrubText(value, ctx) {
  if (Array.isArray(value)) return value.map((v) => scrubText(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubText(v, ctx)]));
  if (typeof value !== "string") return value;
  return ctx.needles.reduce((s, { needle, placeholder }) => s.replace(tokenPattern(needle), placeholder), homePrefix(value, ctx.home));
}

const secretFields = (p) => Object.entries(p?.env ?? {}).filter(([k]) => SECRET_KEY.test(k));

// Canonical representation (MACH-14): worker without disallowedTools and kit env keys; main = live denies + main list.
function exportProvider(p, { worker, cfg, ctx }) {
  const { disallowedTools, ...rest } = structuredClone(p);
  const out = scrubText(rest, ctx);
  for (const [k] of secretFields(p)) out.env[k] = `{{secret:${k}}}`;
  if (worker) {
    for (const k of Object.keys(cfg.agent_provider_env)) if (out.env) delete out.env[k];
  } else out.disallowedTools = [...new Set([...(Array.isArray(disallowedTools) ? disallowedTools : []), ...cfg.main_provider_disallowed_tools])];
  return out;
}

// The structural leak check: every secret env field a placeholder, no secret value of 8+ characters and no secret host as a whole token.
function leaks(tpl, text, needles) {
  const fieldLeak = Object.values(tpl.providers).some((p) => secretFields(p).some(([, v]) => !isPlaceholder(v)));
  const escaped = (needle) => JSON.stringify(needle).slice(1, -1);
  return fieldLeak || needles.some(({ needle }) => tokenPattern(needle).test(text) || tokenPattern(escaped(needle)).test(text));
}

export function runExport(ctx) {
  const cfg = loadDefaults(ctx);
  const live = readLive(ctx);
  const names = [...new Set(Object.entries(cfg.agent_providers).flat())];
  const workers = new Set(Object.values(cfg.agent_providers));
  const liveProviders = live.agents?.providers ?? {};
  const missing = names.filter((n) => !liveProviders[n]);
  if (missing.length) throw new Fail(`provider ${missing.join(", ")} (kit agent_providers) is not in ${ctx.paseoConfig}`);
  const secrets = names.flatMap((n) => secretFields(liveProviders[n]).filter(([, v]) => typeof v === "string" && v).map(([key, value]) => ({ key, value })));
  const scrubCtx = { home: ctx.home, needles: needlesOf(secrets) };
  const providers = Object.fromEntries(names.map((n) => [n, exportProvider(liveProviders[n], { worker: workers.has(n), cfg, ctx: scrubCtx })]));
  const tpl = { _notes: NOTES, providers };
  if (live.agents?.metadataGeneration !== undefined) tpl.metadataGeneration = structuredClone(live.agents.metadataGeneration);
  const text = `${JSON.stringify(tpl, null, 2)}\n`;
  if (leaks(tpl, text, scrubCtx.needles)) throw new Fail("a secret would be written into the template; not written");
  const errors = templateErrors(tpl, cfg);
  if (errors.length) throw new Fail(`the exported template fails the template check: ${errors.join("; ")}; not written`);
  writeJsonAtomic(ctx.templateFile, tpl);
  ctx.out(`wrote ${ctx.templateFile}: providers ${names.join(", ")} (secrets as {{secret:NAME}}, home folder as {{HOME}})`);
  return 0;
}
