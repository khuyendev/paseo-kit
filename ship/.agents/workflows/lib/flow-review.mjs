// Code-review scope and review records (GSDF-92).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { isInside, resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { git } from "./flow-git.mjs";
import { keyFiles } from "./flow-owns.mjs";
import { physicalPath } from "../../harness/gsd/adapter-hooks.mjs";

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|[^/]+\.lock)$/;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["gated", "downgraded", "deferred", "pre-existing"];
const VERDICTS = ["confirmed", "refuted", "uncertain", "unverified", null];

// A scope path inside the code root, also physically (G082): a path reached through a junction or link whose target
// lies outside the root is dropped, so a reviewer is never pointed at files outside the project.
function normalize(root, p) {
  let s = String(p).trim();
  if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
  const abs = path.resolve(root, s);
  if (!isInside(abs, root)) return null;
  const rel = toSlash(path.relative(root, abs));
  return physicalPath(root, rel) === null ? null : rel;
}

// The plan's actual changes: its transfer record (worktree isolation) or its files in commits.json.
function actualChanges(root, phaseDir, plan) {
  const dir = resolveInside(root, phaseDir);
  const t = readJsonIf(path.join(dir, "transfers", `${plan}.json`), null);
  if (t) return { source: "transfer", files: t.files.map((f) => ({ path: f.path, deleted: Boolean(f.deleted) })) };
  const commits = readJsonIf(path.join(dir, "commits.json"), []) ?? [];
  const files = commits.flatMap((c) => c.plans?.[plan] ?? []);
  if (files.length) return { source: "commits", files: [...new Set(files)].map((p) => ({ path: p, deleted: !fs.existsSync(path.join(root, p)) })) };
  return { source: null, files: [] };
}

// Planning artifacts, lockfiles and deleted paths are no review scope.
function excludeNonCode(root, scope, excluded) {
  return scope.filter((p) => {
    if (p.startsWith(".planning/")) { excluded.push({ path: p, reason: "planning artifact" }); return false; }
    if (LOCKFILES.test(p)) { excluded.push({ path: p, reason: "lockfile" }); return false; }
    if (!fs.existsSync(path.join(root, p))) { excluded.push({ path: p, reason: "deleted" }); return false; }
    return true;
  });
}

// input: {plan, files?: explicit list, filterExplicit?: apply the non-code exclusions to that list (the batch phase
// review's own list, G071; an owner's list is taken as given), summary?: SUMMARY path, evaluation?: files from
// check evaluation-scope}
export function reviewScope(root, phaseDir, { plan, files, filterExplicit = false, summary, evaluation }) {
  const log = [];
  const excluded = [];
  if (Array.isArray(files) && files.length) {
    const listed = [];
    for (const f of files) {
      const n = normalize(root, f);
      if (n) listed.push(n);
      else excluded.push({ path: f, reason: "outside the code root" });
    }
    return { plan, source: "explicit", scope: filterExplicit ? excludeNonCode(root, listed, excluded) : listed, excluded, log };
  }
  let source = "summary";
  let listed = [];
  const summaryAbs = summary ? resolveInside(root, summary) : null;
  if (summaryAbs && fs.existsSync(summaryAbs)) {
    const kf = keyFiles(readText(summaryAbs));
    for (const p of [...kf.created, ...kf.modified]) {
      const n = normalize(root, p);
      if (n) listed.push(n);
      else excluded.push({ path: p, reason: "outside the code root" });
    }
  }
  if (!listed.length) { source = "evaluation-scope"; listed = (evaluation ?? []).map((p) => normalize(root, p)).filter(Boolean); }
  const actual = actualChanges(root, phaseDir, plan);
  let scope = [...new Set(listed)];
  if (actual.source) {
    const changed = new Set(actual.files.map((f) => f.path));
    for (const f of actual.files) if (!scope.includes(f.path)) { scope.push(f.path); log.push(`added ${f.path}: changed by the plan but not in its SUMMARY`); }
    for (const p of scope) if (!changed.has(p)) log.push(`listed ${p} did not change in the plan's ${actual.source} record`);
    scope = scope.filter((p) => changed.has(p));
    for (const f of actual.files) if (f.deleted) { excluded.push({ path: f.path, reason: "deleted" }); scope = scope.filter((p) => p !== f.path); }
  }
  scope = excludeNonCode(root, scope, excluded);
  return { plan, source, scope, excluded, log };
}

// New-side line ranges [start, end] of a `git diff -U0` text; a pure deletion marks the line it sits before.
export function diffHunks(diff) {
  const out = [];
  for (const m of String(diff).matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    out.push(count === 0 ? [Math.max(1, start), Math.max(1, start)] : [start, start + count - 1]);
  }
  return out;
}

// The lines each scope file's change added or rewrote, for the pre-existing rule of the code review (owner decision
// 2026-10-22, after the Claude Code team's review write-up: most repeat findings sat in code the change never touched).
// "all" for a file git does not track yet; ranges from the uncommitted change, else from the plan's commit in
// commits.json; null when git cannot say (no repository, no change found), which never marks a finding pre-existing.
export function changedLines(root, phaseDir, { plan, files }) {
  const dir = resolveInside(root, phaseDir);
  const commits = readJsonIf(path.join(dir, "commits.json"), []) ?? [];
  const planCommit = [...commits].reverse().find((c) => Array.isArray(c.plans?.[plan]));
  const diff = (args) => {
    const r = git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", ...args], { allowFail: true });
    return r.code === 0 ? diffHunks(r.out) : [];
  };
  const out = {};
  for (const f of files ?? []) {
    const p = normalize(root, f);
    if (!p) continue;
    if (git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).code !== 0) {
      out[p] = null;
      continue;
    }
    if (git(root, ["ls-files", "--error-unmatch", "--", p], { allowFail: true }).code !== 0) {
      out[p] = "all";
      continue;
    }
    let ranges = diff(["HEAD", "--", p]);
    if (!ranges.length && planCommit?.plans[plan].includes(p)) ranges = diff([`${planCommit.sha}^`, planCommit.sha, "--", p]);
    out[p] = ranges.length ? ranges : null;
  }
  return { plan, files: out };
}

export function validateRecord(rec) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(typeof rec.plan === "string" && rec.plan, "plan: expected string");
  for (const k of ["scope", "excluded", "lenses", "findings", "resolution"]) need(Array.isArray(rec[k]), `${k}: expected array`);
  need(typeof rec.codeOnly === "boolean", "codeOnly: expected boolean");
  for (const [i, f] of (rec.findings ?? []).entries()) {
    need(typeof f.id === "string", `findings[${i}].id: expected string`);
    need(SEVERITIES.includes(f.severity), `findings[${i}].severity: expected one of ${SEVERITIES.join("|")}`);
    need(typeof f.confidence === "number" && f.confidence >= 0 && f.confidence <= 100, `findings[${i}].confidence: expected 0..100`);
    need(STATUSES.includes(f.status), `findings[${i}].status: expected one of ${STATUSES.join("|")}`);
    need(VERDICTS.includes(f.verdict ?? null), `findings[${i}].verdict: expected confirmed|refuted|uncertain|unverified|null`);
  }
  for (const [i, r] of (rec.resolution ?? []).entries()) need(typeof r.id === "string" && typeof r.resolved === "boolean", `resolution[${i}]: expected {id, resolved, evidence}`);
  return errors;
}

const cut = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

function renderReview(nn, records) {
  const lines = [`# Phase ${nn} code review`, "", "Rendered from `review/*.json` (one record per wave and plan).", ""];
  for (const { file, rec } of records) {
    lines.push(`## ${file.replace(/\.json$/, "")}${rec.codeOnly ? " (code-only)" : ""}`, "", `Scope: ${rec.scope.join(", ") || "(empty)"}`, `Lenses: ${rec.lenses.join(", ")}`, "");
    if (rec.findings.length) {
      lines.push("| id | severity | status | verdict | file | trigger |", "| --- | --- | --- | --- | --- | --- |");
      for (const f of rec.findings) lines.push(`| ${f.id} | ${f.severity} | ${f.status} | ${f.verdict ?? "-"} | ${f.file ?? ""}${f.line ? `:${f.line}` : ""} | ${cut(f.trigger, 120).replace(/\|/g, "/")} |`);
      lines.push("");
    } else lines.push("No findings.", "");
    for (const r of rec.resolution) lines.push(`- ${r.id}: ${r.resolved ? "resolved" : "unresolved"} ${cut(r.evidence)}`);
    if (rec.resolution.length) lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeRecord(root, phaseDir, { waveId, record }) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(waveId))) throw new Error(`invalid waveId ${waveId}`);
  // G059: a plan id (NN-MM, or NN-phase for the batch phase review), never a path.
  if (!/^\d+(\.\d+)?-(\d+|phase)$/.test(String(record?.plan))) return { ok: false, errors: [`plan: expected a plan id NN-MM, got ${JSON.stringify(record?.plan)}`], code: 1 };
  const errors = validateRecord(record);
  if (errors.length) return { ok: false, errors, code: 1 };
  const dir = resolveInside(root, phaseDir);
  const name = `${waveId}-${record.plan}.json`;
  writeJsonAtomic(resolveInside(path.join(dir, "review"), name), record);
  const nn = path.basename(dir).split("-")[0];
  const records = fs.readdirSync(path.join(dir, "review")).filter((f) => f.endsWith(".json")).sort()
    .map((file) => ({ file, rec: readJsonIf(path.join(dir, "review", file)) }));
  writeTextAtomic(path.join(dir, `${nn}-REVIEW.md`), renderReview(nn, records));
  return { ok: true, record: `${toSlash(phaseDir)}/review/${name}`, review: `${toSlash(phaseDir)}/${nn}-REVIEW.md` };
}
