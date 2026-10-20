// `ph harness lint` (HARN-05..10, 13, 18): checks the assets the harness generated (Scope of the latest
// history row) and everything the adapter names; other owner content is advisory (`--all`, warnings only).
import fs from "node:fs";
import path from "node:path";
import { GSD_ROLES, OVERLAY_REL, loadConfigLenient } from "../config.mjs";
import { readJson, readText } from "../lib/io.mjs";
import { errText } from "../lib/cli.mjs";
import { toSlash } from "../lib/paths.mjs";
import { isBuiltinRunnerKind } from "./contract.mjs";
import { lintAgentFile, lintSkillFolder, lintTextFile, walkFiles } from "./lint-assets.mjs";
import { EVAL_RECORD_KINDS, HISTORY_REL, lintHistory, scopePaths, triggerRecordRel, validateEvalRecord, validateTriggerRecord } from "./records.mjs";

const SKILLS = ".claude/skills";
const AGENTS = ".agents/agents";

// HARN-07/08 checks of the adapter section itself.
function lintAdapter(root, cfg) {
  const out = [];
  const fail = (msg) => out.push({ level: "fail", file: OVERLAY_REL, line: null, msg });
  const exists = (rel) => fs.existsSync(path.resolve(root, rel));
  const a = cfg.adapter;
  if (a.stack_skill && !exists(`${SKILLS}/${a.stack_skill}/SKILL.md`)) fail(`adapter.stack_skill ${a.stack_skill}: no ${SKILLS}/${a.stack_skill}/SKILL.md`);
  for (const [role, type] of Object.entries(a.agents)) {
    if (!GSD_ROLES.includes(role)) fail(`adapter.agents.${role}: not a GSD role`);
    if (!exists(`${AGENTS}/${type}.md`)) fail(`adapter.agents.${role}: agent type ${type} has no ${AGENTS}/${type}.md`);
  }
  for (const [kind, entry] of Object.entries(a.verify_vocabulary)) {
    for (const key of ["parser", "resolver", "evidence_parser"]) {
      if (entry[key] && !exists(entry[key])) fail(`adapter.verify_vocabulary.${kind}.${key}: script ${entry[key]} does not exist`);
    }
    if (entry.runner !== null && !a.commands.verify[entry.runner]) fail(`adapter.verify_vocabulary.${kind}.runner: ${entry.runner} is not a key of adapter.commands.verify`);
    if (entry.runner === null && !isBuiltinRunnerKind(kind)) fail(`adapter.verify_vocabulary.${kind}: no runner (only build and cmd have built-in runners)`);
  }
  for (const [where, rel] of [["adapter.ownership.shared.predicate", a.ownership.shared.predicate], ["adapter.attribution", a.attribution]]) {
    if (rel && !exists(rel)) fail(`${where}: script ${rel} does not exist`);
  }
  for (const rel of a.instructions) if (!exists(rel)) fail(`adapter.instructions: ${rel} does not exist`);
  for (const [role, entry] of Object.entries(cfg.gsd.roles)) {
    if (!entry.reason?.trim()) fail(`gsd.roles.${role}: no reason (every role entry states why)`);
  }
  return out;
}

// Assets named by the adapter: the stack skill folder, project agents and adapter scripts.
function adapterAssets(cfg) {
  const a = cfg.adapter;
  const paths = [];
  if (a.stack_skill) paths.push(`${SKILLS}/${a.stack_skill}`);
  for (const type of Object.values(a.agents)) paths.push(`${AGENTS}/${type}.md`);
  for (const entry of Object.values(a.verify_vocabulary)) paths.push(...[entry.parser, entry.resolver, entry.evidence_parser].filter(Boolean));
  paths.push(...[a.ownership.shared.predicate, a.attribution].filter(Boolean));
  return paths;
}

// Groups repo-relative paths into skill folders, agent files and other files.
function classify(relPaths) {
  const skills = new Set();
  const agents = new Set();
  const files = new Set();
  const commands = new Set();
  for (const rel of relPaths) {
    const skill = rel.match(/^\.claude\/skills\/([^/]+)/);
    if (skill) skills.add(`${SKILLS}/${skill[1]}`);
    else if (/^\.agents\/agents\/[^/]+\.md$/.test(rel)) agents.add(rel);
    else if (rel.startsWith(".claude/commands/")) commands.add(rel);
    else files.add(rel);
  }
  return { skills, agents, files, commands };
}

function expand(root, rel) {
  return walkFiles(path.join(root, rel)).map((abs) => toSlash(path.relative(root, abs)));
}

function lintAssets(root, cfg, groups) {
  const findings = [];
  const refs = [];
  const tiers = Object.keys(cfg.tiers);
  for (const rel of groups.commands) findings.push({ level: "fail", file: rel, line: null, msg: "generated file under .claude/commands/ (orchestrators are skills)" });
  for (const folder of groups.skills) {
    const r = lintSkillFolder(root, folder);
    findings.push(...r.findings);
    refs.push(...r.refs);
    const skill = path.posix.basename(folder);
    const rec = path.join(root, triggerRecordRel(skill));
    if (!fs.existsSync(rec)) findings.push({ level: "warn", file: `${folder}/SKILL.md`, line: null, msg: `no trigger record ${triggerRecordRel(skill)}` });
    else findings.push(...recordFindings(triggerRecordRel(skill), () => validateTriggerRecord(readJson(rec), skill)));
  }
  for (const rel of groups.agents) {
    const r = lintAgentFile(root, rel, tiers);
    findings.push(...r.findings);
    refs.push(...r.refs);
  }
  for (const rel of groups.files) {
    const base = path.posix.basename(rel);
    if (EVAL_RECORD_KINDS.includes(base)) findings.push(...recordFindings(rel, () => validateEvalRecord(base, readJson(path.join(root, rel)))));
    else {
      const r = lintTextFile(root, path.join(root, rel));
      findings.push(...r.findings);
      refs.push(...r.refs);
    }
  }
  return { findings, refs };
}

function recordFindings(rel, validate) {
  try {
    return validate().map((msg) => ({ level: "fail", file: rel, line: null, msg }));
  } catch (e) {
    return [{ level: "fail", file: rel, line: null, msg: errText(e) }];
  }
}

function lintReferences(root, refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const target = r.kind === "agent" ? `${AGENTS}/${r.name}.md` : `${SKILLS}/${r.name}/SKILL.md`;
    const key = `${r.file}|${target}`;
    if (seen.has(key) || fs.existsSync(path.join(root, target))) continue;
    seen.add(key);
    out.push({ level: "fail", file: r.file, line: r.line, msg: `${r.kind === "agent" ? "agent type" : "skill"} ${r.name} has no ${target}` });
  }
  return out;
}

// Returns {findings: [{level: fail|warn, file, line, msg}], checked: <number of files>}.
export function lintProject(root, { all = false } = {}) {
  const findings = [];
  const { cfg, error } = loadConfigLenient(root);
  if (error) findings.push({ level: "fail", file: OVERLAY_REL, line: null, msg: errText(error) });
  let scope = [];
  const historyFile = path.join(root, HISTORY_REL);
  if (fs.existsSync(historyFile)) {
    const { rows, problems } = lintHistory(readText(historyFile));
    findings.push(...problems.map((p) => ({ level: "fail", file: HISTORY_REL, line: p.line, msg: p.msg })));
    if (rows.length) scope = scopePaths(rows.at(-1).scope).map((p) => toSlash(p).replace(/^\.\//, "").replace(/\/$/, ""));
  }
  for (const rel of scope.filter((p) => !fs.existsSync(path.join(root, p)))) {
    findings.push({ level: "warn", file: HISTORY_REL, line: null, msg: `scope path ${rel} does not exist` });
  }
  findings.push(...lintAdapter(root, cfg));
  const named = [...scope, ...adapterAssets(cfg)].filter((p) => fs.existsSync(path.join(root, p)) && p !== OVERLAY_REL);
  const scoped = new Set(named.flatMap((p) => expand(root, p)));
  const groups = classify([...scoped]);
  const main = lintAssets(root, cfg, groups);
  findings.push(...main.findings, ...lintReferences(root, main.refs));
  let checked = scoped.size;
  if (all) {
    const rest = [...expand(root, SKILLS), ...expand(root, AGENTS), ...expand(root, ".claude/commands")].filter((p) => !scoped.has(p));
    const extra = lintAssets(root, cfg, classify(rest));
    const advisory = [...extra.findings, ...lintReferences(root, extra.refs)].map((f) => ({ ...f, level: "warn", msg: `advisory: ${f.msg}` }));
    findings.push(...advisory);
    checked += rest.length;
  }
  return { findings, checked };
}

export const findingLine = (f) => `${f.level} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.msg}`;
