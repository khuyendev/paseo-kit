// ph doctor (PHCL-04): one `ok|problem|note` line per check, continuing past every problem. It never probes a model
// and never starts a daemon.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OVERLAY_REL } from "../config.mjs";
import { TESTED_PASEO_CLI, clampThinking, filePluginState } from "../paseo-client/index.mjs";
import { errText } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { policyLines } from "../lib/provider-policy.mjs";
import { id8 } from "../lib/paths.mjs";
import { FILE_PLUGIN_ID, MIN_CLAUDE_VERSION, NODE_REQUIREMENT, claudeVersion, nodeRuntimeProblem, paseoConfigFile, versionAtLeast } from "../platform.mjs";
import { runGsd } from "../gsd/commands.mjs";
import { AGENTS_DIR, listAgentTypes } from "./agents.mjs";
import { resolveModel } from "./models.mjs";

const MB_PER_AGENT = 350;

async function daemonLines(ctx, line) {
  let session = null;
  try {
    session = await ctx.paseo();
  } catch (e) {
    line("problem", `paseo: ${errText(e)}`);
    return;
  }
  const same = session.version === TESTED_PASEO_CLI;
  line(same ? "ok" : "note", `paseo cli ${session.version} at ${session.cliDir} (tested with ${TESTED_PASEO_CLI}); daemon reachable`);
  if (session.caller) {
    const me = await session.fetchAgent(session.caller).catch(() => null);
    if (me) line("ok", `caller agent found: ${me.title ?? id8(me.id)}`);
    else line("problem", `caller agent ${id8(session.caller)} not found on the daemon`);
  }
  for (const [name, tier] of Object.entries(ctx.cfg.tiers)) {
    if (!tier.provider) {
      line("problem", `tier ${name} has no model; set tiers.${name}.provider in ${OVERLAY_REL} (the harness adapter generator writes it)`);
      continue;
    }
    let sel;
    try {
      sel = resolveModel({ ...ctx.cfg, allowed_models: [] }, name);
    } catch (e) {
      line("problem", `tier ${name}: ${errText(e)}`);
      continue;
    }
    const entry = (await session.providerModels(sel.provider)).find((m) => m.id === sel.model);
    const thinking = entry ? clampThinking(tier.thinking, (entry.thinkingOptions ?? []).map((o) => o.id)) : undefined;
    const features = Object.entries(tier.features ?? {}).map(([k, v]) => `${k}=${v}`).join(",");
    line(entry ? "ok" : "problem", `tier ${name} -> ${tier.provider} thinking ${thinking ?? "default"}${features ? ` features ${features}` : ""}${entry ? "" : " (model not offered by the provider)"}`);
  }
}

function modLines(ctx, line, versionText) {
  const st = filePluginState(ctx.root, ctx.env, versionText);
  line(st.copied ? "ok" : "problem", `file mod ${st.copied ? "copied" : "missing"}: ${st.plugin}`);
  if (versionText === null) line("note", `Claude Code version unknown (the harness-files mod needs >= ${MIN_CLAUDE_VERSION}; version check only, no model call)`);
  else line(st.supported ? "ok" : "problem", `Claude Code ${versionText} (the harness-files mod needs >= ${MIN_CLAUDE_VERSION}; version check only, no model call)`);
  if (st.disabled && st.direct) line("note", `file mod disabled by the owner (enabledPlugins ${FILE_PLUGIN_ID} false) but CLAUDE_CODE_PLUGIN_DIRS loads it directly`);
  else if (st.disabled) line("note", `file mod disabled by the owner (enabledPlugins ${FILE_PLUGIN_ID} false)`);
  else if (st.enabled) line("ok", `file mod enabled by the owner${st.registered ? " (natively registered)" : ""}`);
  else if (st.direct) line("ok", "file mod loaded through CLAUDE_CODE_PLUGIN_DIRS of this process");
  else line("note", `file mod not selected (enabledPlugins has no ${FILE_PLUGIN_ID}); the kit never toggles it`);
  if (st.supported !== false && (st.launchReady || (st.copied && st.enabled && st.registered))) line("ok", "file mod eligible for ph worker launch");
  else line("note", "file mod inactive or unsupported for workers: native Read/Edit/Write fallback applies only where owner restrictions permit it");
}

function paseoPolicyLines(ctx, line) {
  const file = paseoConfigFile(ctx.env);
  let live;
  try {
    live = readJsonIf(file);
  } catch (e) {
    line("problem", `paseo config ${file}: ${errText(e)}`);
    return;
  }
  if (!live) {
    line("problem", `paseo config ${file} not found; run kit.mjs machine apply`);
    return;
  }
  for (const { level, text } of policyLines(live, ctx.cfg)) line(level, text);
}

// Every repo-relative file the adapter names, with the key that names it.
export function adapterFiles(cfg) {
  const a = cfg.adapter;
  const out = [];
  for (const [kind, v] of Object.entries(a.verify_vocabulary)) {
    for (const key of ["parser", "resolver", "evidence_parser"]) if (v[key]) out.push([v[key], `adapter.verify_vocabulary.${kind}.${key}`]);
  }
  if (a.ownership.shared.predicate) out.push([a.ownership.shared.predicate, "adapter.ownership.shared.predicate"]);
  a.instructions.forEach((rel, i) => out.push([rel, `adapter.instructions[${i}]`]));
  if (a.attribution) out.push([a.attribution, "adapter.attribution"]);
  if (a.stack_skill) out.push([`.claude/skills/${a.stack_skill}/SKILL.md`, "adapter.stack_skill"]);
  for (const [role, type] of Object.entries(a.agents)) out.push([`${AGENTS_DIR}/${type}.md`, `adapter.agents.${role}`]);
  return out;
}

function adapterLines(ctx, line) {
  const files = adapterFiles(ctx.cfg);
  const missing = files.filter(([rel]) => !fs.existsSync(path.resolve(ctx.root, rel)));
  for (const [rel, key] of missing) line("problem", `adapter file missing: ${rel} (${key})`);
  if (!missing.length) line("ok", `adapter and gsd sections present; ${files.length} named file(s) exist`);
}

// GSDC-47: the vendored GSD snapshot and the generated method text are checked on every doctor run.
async function gsdUpstreamLines(ctx, line) {
  const lines = [];
  const collect = (l) => lines.push(String(l));
  const code = await runGsd(["upstream", "check"], { env: ctx.env, root: ctx.root, out: collect, err: collect, write: () => {}, errWrite: () => {} });
  const summary = lines.find((l) => l.startsWith("check:")) ?? `check exit ${code}`;
  if (code === 0) return line("ok", `gsd upstream ${summary}`);
  for (const l of lines.filter((x) => x.startsWith("problem:"))) line("problem", `gsd upstream ${l.slice("problem:".length).trim()}`);
  line("problem", `gsd upstream ${summary}`);
}

export async function runDoctor(ctx, { freemem = os.freemem, claudeVersionText = () => claudeVersion(ctx.env) } = {}) {
  let problems = 0;
  const line = (kind, text) => {
    if (kind === "problem") problems++;
    ctx.out(`${kind} ${text}`);
  };
  const nodeProblem = nodeRuntimeProblem();
  line(nodeProblem ? "problem" : "ok", `${nodeProblem ?? `node ${process.versions.node}`} (needs ${NODE_REQUIREMENT})`);
  const caller = ctx.env.PASEO_AGENT_ID?.trim();
  if (caller) line("ok", `PASEO_AGENT_ID ${caller}`);
  else line("problem", "PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent");
  if (ctx.configError) line("problem", `${errText(ctx.configError)} (the remaining checks use the kit defaults; every other ph command fails until it is fixed)`);
  else line("ok", "harness config valid");
  await daemonLines(ctx, line);
  try {
    line("ok", `default_tier ${ctx.cfg.default_tier} -> ${resolveModel(ctx.cfg, ctx.cfg.default_tier).id}`);
  } catch (e) {
    line("problem", `default_tier ${ctx.cfg.default_tier}: ${errText(e)}`);
  }
  const overlay = path.join(ctx.root, OVERLAY_REL);
  if (fs.existsSync(overlay)) line("ok", `overlay ${overlay}`);
  else line("note", "overlay none (kit defaults apply)");
  modLines(ctx, line, claudeVersionText());
  paseoPolicyLines(ctx, line);
  adapterLines(ctx, line);
  await gsdUpstreamLines(ctx, line);
  const types = listAgentTypes(ctx.root);
  if (types.length) line("ok", `agent types in ${AGENTS_DIR}/ (${types.length}): ${types.join(", ")}`);
  else line("note", `no agent types in ${AGENTS_DIR}/`);
  const needMb = ctx.cfg.max_subagents * MB_PER_AGENT;
  const freeMb = Math.round(freemem() / 2 ** 20);
  if (freeMb < needMb) line("note", `free RAM ${freeMb} MB is below max_subagents ${ctx.cfg.max_subagents} x ${MB_PER_AGENT} MB = ${needMb} MB; lower max_subagents or free memory`);
  line("note", "this check does not verify tools loaded into a running session (restart the session after changing the mod or the provider config)");
  return problems ? 2 : 0;
}

export const doctorCommands = [
  {
    name: "doctor",
    summary: "check node, caller, config, Paseo daemon, tiers, file mod, provider policy, adapter and agent types",
    usage: "ph doctor",
    options: {},
    config: "lenient",
    run: (ctx) => runDoctor(ctx),
  },
];
