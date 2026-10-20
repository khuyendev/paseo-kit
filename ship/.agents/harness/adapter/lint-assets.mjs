// Checks of generated skills and agent definitions (HARN-05, HARN-06, HARN-08, HARN-18).
import fs from "node:fs";
import path from "node:path";
import { readText } from "../lib/io.mjs";
import { toSlash } from "../lib/paths.mjs";
import { parseFrontMatter, tokens } from "./frontmatter.mjs";
import { PRIMITIVES, extractReferences, scanPrimitives } from "./lint-text.mjs";
import { lintWorkflowScript, looksLikeWorkflowScript } from "./lint-scripts.mjs";

export const AGENT_KEYS = Object.freeze(["name", "description", "tools", "model", "include"]);
export const SKILL_MAX_LINES = 500;
export const REFERENCE_TOC_LINES = 300;
const TEXT_EXT = new Set([".md", ".js", ".mjs", ".cjs", ".json", ".txt", ".yaml", ".yml"]);
const FORBIDDEN_FILES = /^(README|CHANGELOG|INSTALLATION)(\.[^.]+)?$/i;
const EDIT_TOOLS = ["Edit", "MultiEdit", "mcp__harness-files__edit_multiple_files"];
const WRITE_TOOLS = ["Write", "mcp__harness-files__write_multiple_files"];

const lineCount = (text) => text.replace(/\r?\n$/, "").split(/\r?\n/).length;

export function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [dir];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkFiles(p) : [p];
  });
}

// HARN-18 (CR-HAR-07): a workflow script by location or by a `--script` reference, not only by a leading meta,
// so a script without meta still gets the meta, clock and randomness checks.
const WORKFLOW_DIR_SCRIPT = /^\.agents\/workflows\/[^/]+\.[cm]?js$/i;
export const isWorkflowScript = (rel, text) => /\.[cm]?js$/i.test(rel) && (WORKFLOW_DIR_SCRIPT.test(rel) || looksLikeWorkflowScript(text));

// Primitive scan, references and (for workflow scripts) script checks of one text file.
export function lintTextFile(root, abs, { workflow = false } = {}) {
  const rel = toSlash(path.relative(root, abs));
  if (!TEXT_EXT.has(path.extname(abs).toLowerCase())) return { findings: [], refs: [] };
  const text = readText(abs);
  const findings = scanPrimitives(text).map((f) => ({ ...f, file: rel }));
  if ((workflow && /\.[cm]?js$/i.test(rel)) || isWorkflowScript(rel, text)) findings.push(...lintWorkflowScript(text).map((f) => ({ ...f, file: rel })));
  return { findings, refs: extractReferences(text).map((r) => ({ ...r, file: rel })) };
}

const ORCHESTRATOR = /\bph(?:\.mjs)?["`]?\s+(?:workflow|spawn|fanout)\b/;

// HARN-18: execution mode at the top, each stage of a mixed orchestrator labelled, test scenarios present.
function lintOrchestrator(body, bodyLine, rel) {
  const lines = body.split(/\r?\n/);
  const out = [];
  const fail = (line, msg) => out.push({ level: "fail", file: rel, line, msg });
  const firstStage = lines.findIndex((l) => /^#{2,4}\s+(Phase|Stage|Step)\b/i.test(l));
  const top = lines.slice(0, firstStage < 0 ? lines.length : firstStage);
  const modeLine = top.find((l) => /^##\s+Execution mode:\s*\S/i.test(l) || /\*\*Execution mode:\*\*/.test(l));
  if (!modeLine) fail(bodyLine, "orchestrator skill does not state its execution mode at the top (## Execution mode: ...)");
  else if (/mixed|hybrid/i.test(modeLine)) {
    lines.forEach((l, i) => {
      const h = l.match(/^(#{2,4})\s+(Phase|Stage)\b/i);
      if (!h) return;
      const end = lines.findIndex((x, j) => j > i && new RegExp(`^#{1,${h[1].length}}\\s`).test(x));
      const section = lines.slice(i + 1, end < 0 ? lines.length : end);
      if (!section.some((x) => /\*\*Execution mode:\*\*/.test(x))) fail(bodyLine + i, `stage "${l.replace(/^#+\s*/, "")}" of a mixed orchestrator has no **Execution mode:** label`);
    });
  }
  const ts = lines.findIndex((l) => /^##\s+Test scenarios\s*$/i.test(l));
  if (ts < 0) fail(bodyLine, "orchestrator skill has no ## Test scenarios section");
  else {
    const end = lines.findIndex((x, j) => j > ts && /^##\s/.test(x));
    const section = lines.slice(ts + 1, end < 0 ? lines.length : end).join("\n");
    if (!/normal/i.test(section) || !/error/i.test(section)) fail(bodyLine + ts, "## Test scenarios needs a normal flow and an error flow");
  }
  return out;
}

// HARN-05 (+06, 18) for one skill folder `.claude/skills/<name>`.
export function lintSkillFolder(root, folderRel) {
  const dir = path.join(root, folderRel);
  const findings = [];
  const refs = [];
  const fail = (file, line, msg) => findings.push({ level: "fail", file, line, msg });
  const skillRel = `${folderRel}/SKILL.md`;
  const files = walkFiles(dir);
  for (const abs of files) {
    const rel = toSlash(path.relative(root, abs));
    if (FORBIDDEN_FILES.test(path.basename(abs))) fail(rel, null, "README, CHANGELOG and INSTALLATION files do not belong in a skill folder");
    const r = lintTextFile(root, abs);
    findings.push(...r.findings);
    refs.push(...r.refs);
    if (/\/references\/[^/]+\.md$/i.test(rel)) {
      const text = readText(abs);
      if (lineCount(text) > REFERENCE_TOC_LINES && !/^#{1,3}\s+(Contents|Table of contents)\b/im.test(text.split(/\r?\n/).slice(0, 60).join("\n"))) {
        fail(rel, null, `reference has ${lineCount(text)} lines (> ${REFERENCE_TOC_LINES}) and no contents list near the top`);
      }
    }
  }
  if (!fs.existsSync(path.join(root, skillRel))) {
    fail(skillRel, null, "skill folder has no SKILL.md");
    return { findings, refs };
  }
  const text = readText(path.join(root, skillRel));
  if (lineCount(text) > SKILL_MAX_LINES) fail(skillRel, null, `SKILL.md has ${lineCount(text)} lines (> ${SKILL_MAX_LINES}); move details to references/`);
  const fm = parseFrontMatter(text);
  if (fm.error || !fm.data) fail(skillRel, 1, fm.error ?? "SKILL.md has no front matter");
  else {
    if (!fm.data.name) fail(skillRel, 1, "front matter has no name");
    const desc = typeof fm.data.description === "string" ? fm.data.description : "";
    if (!desc) fail(skillRel, 1, "front matter has no description");
    else if (!/\buse\b[^.]*\bwhen(ever)?\b/i.test(desc)) fail(skillRel, 1, "description states no 'use when' trigger");
    if (ORCHESTRATOR.test(fm.body)) findings.push(...lintOrchestrator(fm.body, fm.bodyLine, skillRel));
  }
  return { findings, refs };
}

// HARN-05/06/08 for one agent definition `.agents/agents/<name>.md`; `tiers` = valid tier names.
export function lintAgentFile(root, rel, tiers) {
  const findings = [];
  const fail = (line, msg) => findings.push({ level: "fail", file: rel, line, msg });
  const text = readText(path.join(root, rel));
  const r = lintTextFile(root, path.join(root, rel));
  findings.push(...r.findings);
  const fm = parseFrontMatter(text);
  if (fm.error || !fm.data) {
    fail(1, fm.error ?? "agent definition has no front matter");
    return { findings, refs: r.refs };
  }
  for (const key of ["name", "description"]) if (!fm.data[key]) fail(1, `front matter has no ${key}`);
  for (const key of fm.keys.filter((k) => !AGENT_KEYS.includes(k))) fail(1, `front matter key ${key} is not allowed (${AGENT_KEYS.join(", ")})`);
  const model = typeof fm.data.model === "string" ? fm.data.model.trim() : "";
  if (model.includes("/")) fail(1, `model ${model} is a concrete model id; agent files name a tier (${tiers.join(", ")})`);
  else if (model && model !== "inherit" && !tiers.includes(model)) fail(1, `model ${model} is not a tier (${tiers.join(", ")})`);
  const tools = tokens(fm.data.tools);
  for (const t of tools.filter((t) => PRIMITIVES.includes(t))) fail(1, `tools lists the in-session primitive ${t}`);
  if (tools.some((t) => WRITE_TOOLS.includes(t)) && !tools.some((t) => EDIT_TOOLS.includes(t))) {
    findings.push({ level: "warn", file: rel, line: 1, msg: "tools lists Write but not Edit (the agent must rewrite whole files)" });
  }
  return { findings, refs: r.refs };
}
