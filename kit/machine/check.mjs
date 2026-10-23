// `machine check`: read-only readiness lines `ok|problem|note <text>`; its only external call is `claude --version` (MACH-02, MACH-03).
import fs from "node:fs";
import { claudeVersion, MIN_CLAUDE_VERSION, NODE_REQUIREMENT, nodeRuntimeProblem, versionAtLeast } from "../../ship/.agents/harness/platform.mjs";
import { claudeConfigDir, loadInputs, readLive } from "./context.mjs";
import { linkDirs, linkLines, linkStates, readRecord } from "./links.mjs";
import { kitPlugins, pluginLines } from "./plugins.mjs";
import { modelPlan, policyLines, retiredModels } from "./providers.mjs";

// The Claude CLI runs under the template's config dir, not the caller's default (MACH-17).
export function claudeGate(ctx, tpl) {
  const version = claudeVersion({ ...ctx.env, CLAUDE_CONFIG_DIR: claudeConfigDir(ctx, tpl) });
  const shown = /\d+\.\d+\.\d+/.exec(version ?? "")?.[0] ?? "unknown";
  const ok = versionAtLeast(version) === true;
  return { ok, text: `Claude Code ${shown}${ok ? "" : " (unavailable or too old)"}; the harness-files mod needs >= ${MIN_CLAUDE_VERSION}` };
}

export const nodeGate = () => {
  const problem = nodeRuntimeProblem();
  return { ok: problem === null, text: problem ? `${problem} (needs ${NODE_REQUIREMENT})` : `node ${process.versions.node} (needs ${NODE_REQUIREMENT})` };
};

// Prints the check and returns its exit code: 0, or 2 when any `problem`. Throws Fail (exit 1) when an input is unreadable.
export function runCheck(ctx, { enablePlugins = false } = {}) {
  const { cfg, tpl } = loadInputs(ctx);
  const live = readLive(ctx);
  const record = readRecord(ctx.linksRecord);
  let problems = 0;
  const say = (level, text) => {
    if (level === "problem") problems++;
    ctx.out(`${level} ${text}`);
  };
  const node = nodeGate();
  say(node.ok ? "ok" : "problem", node.text);
  say("ok", `platform ${process.platform} ${process.arch}`);
  const claude = claudeGate(ctx, tpl);
  say(claude.ok ? "ok" : "problem", claude.text);
  say("note", "the harness-files mod is activated per project: kit.mjs install|update <project> --enable-plugin, then verify with ph doctor");
  const plan = modelPlan(live, tpl, cfg);
  for (const p of plan) {
    say("problem", p.missing ? `Paseo provider ${p.name} is missing from ${ctx.paseoConfig}; run kit.mjs machine apply` : `Paseo provider ${p.name} lacks the models ${p.add.map((m) => m.id).join(", ")}; run kit.mjs machine apply`);
  }
  if (!plan.length) say("ok", `Paseo providers ${[...new Set(Object.entries(cfg.agent_providers).flat())].join(", ")} have every template model`);
  if (fs.existsSync(ctx.reloadPending)) say("problem", "Paseo config change is not reloaded yet; run kit.mjs machine apply");
  for (const line of policyLines(live, cfg)) say(line.level, line.text);
  for (const { name, id } of retiredModels(live, tpl, cfg)) say("note", `Paseo provider ${name} has the model ${id}, which the template no longer ships; left for the owner to remove in Paseo`);
  for (const line of pluginLines(live, kitPlugins(ctx.pluginsDir), enablePlugins)) say(line.level, line.text);
  for (const line of linkLines(linkStates(linkDirs(tpl, ctx.home), record, ctx.skillDir))) say(line.level, line.text);
  return problems ? 2 : 0;
}
