// The machine policy check shared by `kit.mjs machine check` (MACH-04/05) and `ph doctor` (PHCL-04): worker lines,
// then main lines, as [{level: "ok"|"problem", text}]. Pure; `live` is the parsed Paseo config.
const isList = (v) => v === undefined || v === null || Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);

export function policyLines(live, cfg) {
  const providers = live?.agents?.providers ?? {};
  const lines = [];
  const required = cfg.agent_provider_disallowed_tools;
  for (const [main, worker] of Object.entries(cfg.agent_providers)) {
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
  // Whether SendMessage is denied on a main provider never yields a problem (INV-06).
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
