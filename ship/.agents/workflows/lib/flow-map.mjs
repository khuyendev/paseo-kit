// map-codebase plumbing: doc check, secrets scan, map stamp and the warn-only drift gate (GSDF-05, GSDF-06).
import fs from "node:fs";
import path from "node:path";
import { readText, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";
import { git, gitLines, head } from "./flow-git.mjs";

export const MAP_DIR = ".planning/codebase";
export const MAP_DOCS = ["STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING", "CONCERNS"];
const MIN_LINES = 20;

const SECRET_PATTERNS = [
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["openai-style-key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe-key", /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
];

export function mapCheck(root, docs = MAP_DOCS) {
  const problems = [];
  for (const doc of docs) {
    const rel = `${MAP_DIR}/${doc}.md`;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel}: missing`); continue; }
    const lines = readText(abs).split(/\r?\n/).length;
    if (lines < MIN_LINES) problems.push(`${rel}: ${lines} lines < ${MIN_LINES}`);
  }
  return { ok: problems.length === 0, problems, code: problems.length ? 1 : 0 };
}

// Findings name the file, line and kind only; the matched value never reaches the output.
export function secrets(root, rels) {
  const findings = [];
  for (const rel of rels) {
    const abs = resolveInside(root, rel);
    if (!fs.existsSync(abs)) continue;
    readText(abs).split(/\r?\n/).forEach((line, i) => {
      for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) findings.push({ file: rel, line: i + 1, kind });
    });
  }
  return { clean: findings.length === 0, findings, code: findings.length ? 1 : 0 };
}

function setFrontmatter(text, fields) {
  const m = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const keep = (m ? m[1].split(/\r?\n/) : []).filter((l) => !Object.keys(fields).some((k) => l.startsWith(`${k}:`)));
  const lines = [...keep, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)];
  const body = m ? text.slice(m[0].length) : text;
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function frontmatterValue(text, key) {
  const m = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") || null : null;
}

// The stamp is a shell step, never the mapper's job (GSDF-06).
export function stamp(root, docs = MAP_DOCS) {
  const commit = head(root);
  if (!commit) throw new Error("no git HEAD to stamp the map with");
  const at = new Date().toISOString();
  const stamped = [];
  for (const doc of docs) {
    const rel = `${MAP_DIR}/${doc}.md`;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    writeTextAtomic(abs, setFrontmatter(readText(abs), { last_mapped_commit: commit, last_mapped_at: at }));
    stamped.push(rel);
  }
  return { commit, at, stamped };
}

const topDir = (p) => (p.includes("/") ? p.split("/")[0] : null);

// Warn-only: never blocks planning; no baseline or any internal failure is `skipped`, never drift.
export function drift(root, threshold) {
  try {
    const dir = path.join(root, MAP_DIR);
    const docs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
    const commits = docs.map((f) => frontmatterValue(readText(path.join(dir, f)), "last_mapped_commit")).filter(Boolean);
    if (!commits.length) return { status: "skipped", reason: "no map baseline (last_mapped_commit)" };
    const base = commits[0];
    if (git(root, ["cat-file", "-e", `${base}^{commit}`], { allowFail: true }).code !== 0) return { status: "skipped", reason: `baseline ${base} not in this repository` };
    const mapped = new Set(gitLines(root, ["ls-tree", "-d", "--name-only", base]));
    const changed = gitLines(root, ["diff", "--name-status", "--no-renames", `${base}`, "--"]);
    const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard"]);
    const newDirs = new Set();
    const changedInside = [];
    for (const p of [...changed.map((l) => l.split("\t").pop()), ...untracked]) {
      const top = topDir(p);
      if (!top || top === ".planning") continue;
      if (mapped.has(top)) changedInside.push(p);
      else newDirs.add(top);
    }
    const count = newDirs.size + changedInside.length;
    const status = count >= threshold ? "drift" : "ok";
    return { status, count, threshold, baseline: base, newDirs: [...newDirs].sort(), changedInside: changedInside.length };
  } catch (e) {
    return { status: "skipped", reason: `drift check failed: ${String(e.message ?? e).split("\n")[0]}` };
  }
}
