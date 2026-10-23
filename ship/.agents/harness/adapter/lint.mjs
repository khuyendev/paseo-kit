// `ph harness lint` (HARN-05..10, 13, 18): checks the assets the harness generated (Scope of the latest
// history row) and everything the adapter names; other owner content is advisory (`--all`, warnings only).
import fs from "node:fs";
import path from "node:path";
import { GSD_ROLES, OVERLAY_REL, loadConfigLenient } from "../config.mjs";
import { readJson, readText } from "../lib/io.mjs";
import { errText } from "../lib/cli.mjs";
import { isInside, realInside, toSlash } from "../lib/paths.mjs";
import { runGit } from "../runtime/worktrees.mjs";
import { setupGaps, setupProblems } from "../runtime/worktree-setup.mjs";
import { isBuiltinRunnerKind } from "./contract.mjs";
import { lintCommandContract } from "./lint-probes.mjs";
import { isWorkflowScript, lintAgentFile, lintSkillFolder, lintTextFile, walkFiles } from "./lint-assets.mjs";
import { lintWorkflowScript } from "./lint-scripts.mjs";
import { checkCompositionVerbs } from "../gsd/verb-check.mjs";
import { EVAL_RECORD_KINDS, HISTORY_REL, badScopePath, lintHistory, scopePaths, triggerRecordRel, validateEvalRecord, validateTriggerRecord } from "./records.mjs";

const SKILLS = ".claude/skills";
const AGENTS = ".agents/agents";

// A path the project names (scope, adapter asset, --script reference) is walked or read only inside the root.
const inRoot = (root, rel) => isInside(path.resolve(root, rel), root);

const SCRIPT_OPERAND = /^(?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:[cm]?js|ts|py|sh|ps1|bat|cmd|rb|pl)$/i;

// CR-HAR-06: repo-relative scripts in an adapter argv (`node tools/check.mjs`, `./tools/build.sh`). A bare
// command name is a PATH executable and options or data arguments are no script.
export function scriptOperands(argv) {
  return (argv ?? []).filter((w, i) => typeof w === "string" && SCRIPT_OPERAND.test(w) && (i > 0 || w.includes("/"))).map((w) => w.replace(/^\.\//, ""));
}

// Every script an adapter command or checker argv runs: [{where, rel}].
function adapterArgvScripts(a) {
  const lists = [["adapter.commands.build", a.commands.build], ["adapter.commands.test", a.commands.test]];
  for (const g of a.commands.gates ?? []) lists.push([`adapter.commands.gates.${g.name}`, g.argv]);
  for (const [k, v] of Object.entries(a.commands.verify)) lists.push([`adapter.commands.verify.${k}`, v.argv]);
  (a.commands.smoke_builds ?? []).forEach((argv, i) => lists.push([`adapter.commands.smoke_builds[${i}]`, argv]));
  lists.push(["adapter.dependency_probe", a.dependency_probe]);
  for (const p of a.command_probes ?? []) lists.push([`adapter.command_probes.${p.name}`, p.argv]);
  for (const [ext, v] of Object.entries(a.syntax_checkers)) lists.push([`adapter.syntax_checkers.${ext}`, v.argv]);
  return lists.flatMap(([where, argv]) => scriptOperands(argv).map((rel) => ({ where, rel })));
}

// HARN-07/08 checks of the adapter section itself.
function lintAdapter(root, cfg) {
  const out = [];
  const fail = (msg) => out.push({ level: "fail", file: OVERLAY_REL, line: null, msg });
  const exists = (rel) => fs.existsSync(path.resolve(root, rel));
  // Adapter paths are repo-relative: an existing one whose link leads outside the project is a failure too.
  const linkOut = (where, rel) => {
    if (exists(rel) && !realInside(root, rel)) fail(`${where}: ${rel} resolves outside the project through a link`);
  };
  const a = cfg.adapter;
  if (a.stack_skill && !exists(`${SKILLS}/${a.stack_skill}/SKILL.md`)) fail(`adapter.stack_skill ${a.stack_skill}: no ${SKILLS}/${a.stack_skill}/SKILL.md`);
  for (const [role, type] of Object.entries(a.agents)) {
    if (!GSD_ROLES.includes(role)) fail(`adapter.agents.${role}: not a GSD role`);
    if (!exists(`${AGENTS}/${type}.md`)) fail(`adapter.agents.${role}: agent type ${type} has no ${AGENTS}/${type}.md`);
  }
  for (const [kind, entry] of Object.entries(a.verify_vocabulary)) {
    for (const key of ["parser", "resolver", "evidence_parser"]) {
      if (entry[key] && !exists(entry[key])) fail(`adapter.verify_vocabulary.${kind}.${key}: script ${entry[key]} does not exist`);
      else if (entry[key]) linkOut(`adapter.verify_vocabulary.${kind}.${key}`, entry[key]);
    }
    if (entry.runner !== null && !a.commands.verify[entry.runner]) fail(`adapter.verify_vocabulary.${kind}.runner: ${entry.runner} is not a key of adapter.commands.verify`);
    if (entry.runner === null && !isBuiltinRunnerKind(kind)) fail(`adapter.verify_vocabulary.${kind}: no runner (only build and cmd have built-in runners)`);
  }
  for (const [where, rel] of [["adapter.ownership.shared.predicate", a.ownership.shared.predicate], ["adapter.attribution", a.attribution]]) {
    if (rel && !exists(rel)) fail(`${where}: script ${rel} does not exist`);
    else if (rel) linkOut(where, rel);
  }
  for (const { where, rel } of adapterArgvScripts(a)) if (!exists(rel)) fail(`${where}: script ${rel} does not exist`); else linkOut(where, rel);
  for (const rel of a.instructions) if (!exists(rel)) fail(`adapter.instructions: ${rel} does not exist`); else linkOut("adapter.instructions", rel);
  for (const p of setupProblems(root, a.worktree_setup, runGit)) fail(p);
  out.push(...lintCommandContract(root, cfg));
  for (const gap of setupGaps(root, cfg, runGit)) out.push({ level: "warn", file: OVERLAY_REL, line: null, msg: gap });
  for (const [role, entry] of Object.entries(cfg.gsd.roles)) {
    if (!entry.reason?.trim()) fail(`gsd.roles.${role}: no reason (every role entry states why)`);
  }
  return out;
}

// Assets named by the adapter: the stack skill folder, project agents, hook scripts and argv scripts.
function adapterAssets(cfg) {
  const a = cfg.adapter;
  const paths = [];
  if (a.stack_skill) paths.push(`${SKILLS}/${a.stack_skill}`);
  for (const type of Object.values(a.agents)) paths.push(`${AGENTS}/${type}.md`);
  for (const entry of Object.values(a.verify_vocabulary)) paths.push(...[entry.parser, entry.resolver, entry.evidence_parser].filter(Boolean));
  paths.push(...[a.ownership.shared.predicate, a.attribution].filter(Boolean));
  paths.push(...adapterArgvScripts(a).map((s) => s.rel));
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

function lintAssets(root, cfg, groups, { workflows = new Set() } = {}) {
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
      const r = lintTextFile(root, path.join(root, rel), { workflow: workflows.has(rel) });
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

const refTarget = (r) => (r.kind === "agent" ? `${AGENTS}/${r.name}.md` : r.kind === "skill" ? `${SKILLS}/${r.name}/SKILL.md` : r.name.replace(/^\.\//, ""));

// Workflow scripts the linted files invoke (`--script`) that exist: mandatory and checked as workflow scripts.
function invokedScripts(root, refs) {
  return [...new Set(refs.filter((r) => r.kind === "script").map(refTarget))].filter((rel) => inRoot(root, rel) && fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isFile());
}

// Structural checks for invoked scripts the first pass linted as plain files (no meta, outside .agents/workflows/).
function structureOfInvoked(root, rels) {
  return rels.flatMap((rel) => {
    const text = readText(path.join(root, rel));
    return isWorkflowScript(rel, text) ? [] : lintWorkflowScript(text).map((f) => ({ ...f, file: rel }));
  });
}

function lintReferences(root, refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const target = refTarget(r);
    const key = `${r.file}|${target}`;
    if (seen.has(key) || fs.existsSync(path.join(root, target))) continue;
    seen.add(key);
    const msg = r.kind === "script" ? `workflow script ${target} does not exist` : `${r.kind === "agent" ? "agent type" : "skill"} ${r.name} has no ${target}`;
    out.push({ level: "fail", file: r.file, line: r.line, msg });
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
    // An invalid scope entry is reported above and never used.
    if (rows.length) scope = scopePaths(rows.at(-1).scope).filter((p) => !badScopePath(p)).map((p) => toSlash(p).replace(/^\.\//, "").replace(/\/$/, ""));
  }
  for (const rel of scope.filter((p) => !fs.existsSync(path.join(root, p)))) {
    findings.push({ level: "warn", file: HISTORY_REL, line: null, msg: `scope path ${rel} does not exist` });
  }
  findings.push(...lintAdapter(root, cfg));
  // Kit feedback 87: a composition may call only the kit's flow and gsd verbs (checked after every evolve edit).
  findings.push(...checkCompositionVerbs(root).problems.map((p) => ({ level: "fail", file: p.file, line: p.line, msg: p.msg })));
  const named = [...scope, ...adapterAssets(cfg)].filter((p) => inRoot(root, p) && fs.existsSync(path.join(root, p)) && p !== OVERLAY_REL);
  const scoped = new Set(named.flatMap((p) => expand(root, p)));
  const groups = classify([...scoped]);
  const main = lintAssets(root, cfg, groups);
  const invoked = invokedScripts(root, main.refs);
  const fresh = invoked.filter((rel) => !scoped.has(rel));
  const scripts = lintAssets(root, cfg, classify(fresh), { workflows: new Set(fresh) });
  const structure = structureOfInvoked(root, invoked.filter((rel) => scoped.has(rel)));
  findings.push(...main.findings, ...scripts.findings, ...structure, ...lintReferences(root, [...main.refs, ...scripts.refs]));
  for (const rel of fresh) scoped.add(rel);
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
