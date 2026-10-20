// Harness records: the history table (HARN-13), skill-test eval records (HARN-09) and trigger records (HARN-10).
import path from "node:path";

export const HISTORY_REL = ".agents/harness-history.md";
export const HISTORY_COLUMNS = Object.freeze(["Date", "Change", "Scope", "Reason", "Supersedes"]);
export const SKILL_TESTS_REL = ".agents/skill-tests";
export const triggerRecordRel = (skill) => `${SKILL_TESTS_REL}/${skill}/triggers.json`;

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export const scopePaths = (scope) => String(scope).split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean);

function badScopePath(p) {
  if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith("/")) return "is absolute";
  if (p.split(/[\\/]/).includes("..")) return "leaves the repository";
  return null;
}

// Parses the table. Returns {rows: [{line, date, change, scope, reason, supersedes}], problems: [{line, msg}]}.
export function parseHistory(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  const problems = [];
  const headerAt = lines.findIndex((l) => l.trim().startsWith("|") && cells(l).map((c) => c.toLowerCase()).join("|") === HISTORY_COLUMNS.join("|").toLowerCase());
  if (headerAt < 0) return { rows: [], problems: [{ line: 1, msg: `no history table with columns | ${HISTORY_COLUMNS.join(" | ")} |` }] };
  const rows = [];
  for (let i = headerAt + 1; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    if (isSeparator(lines[i])) continue;
    const c = cells(lines[i]);
    if (c.length !== HISTORY_COLUMNS.length) {
      problems.push({ line: i + 1, msg: `row has ${c.length} cells, expected ${HISTORY_COLUMNS.length}` });
      continue;
    }
    const [date, change, scope, reason, supersedes] = c;
    rows.push({ line: i + 1, date, change, scope, reason, supersedes });
  }
  return { rows, problems };
}

// HARN-13: Date, Change, Scope and Reason non-empty; ISO dates in non-decreasing order; Scope repo-relative paths.
export function lintHistory(text) {
  const { rows, problems } = parseHistory(text);
  let previous = null;
  for (const row of rows) {
    for (const [name, value] of [["Date", row.date], ["Change", row.change], ["Scope", row.scope], ["Reason", row.reason]]) {
      if (!value) problems.push({ line: row.line, msg: `empty ${name}` });
    }
    if (row.date && !validDate(row.date)) problems.push({ line: row.line, msg: `date ${row.date} is not an ISO date (YYYY-MM-DD)` });
    else if (row.date) {
      if (previous && row.date < previous) problems.push({ line: row.line, msg: `date ${row.date} is earlier than the row above (${previous})` });
      previous = row.date;
    }
    for (const p of scopePaths(row.scope)) {
      const bad = badScopePath(p);
      if (bad) problems.push({ line: row.line, msg: `scope path ${p} ${bad}; use repo-relative paths` });
    }
  }
  return { rows, problems };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function closed(obj, keys, where) {
  if (!isObj(obj)) return [`${where} must be an object`];
  const errs = Object.keys(obj).filter((k) => !keys.includes(k)).map((k) => `${where}: unknown field ${k}`);
  for (const k of keys) if (!(k in obj)) errs.push(`${where}: missing field ${k}`);
  return errs;
}

// HARN-09: exact schemas of the skill-test records. Returns a list of errors (empty = valid).
export const EVAL_RECORD_KINDS = Object.freeze(["eval_metadata.json", "grading.json", "timing.json"]);

export function validateEvalRecord(kind, rec) {
  if (kind === "eval_metadata.json") {
    const errs = closed(rec, ["eval_id", "eval_name", "prompt", "assertions"], "eval_metadata");
    if (errs.length) return errs;
    if (!(isInt(rec.eval_id) || (typeof rec.eval_id === "string" && rec.eval_id))) errs.push("eval_id must be an integer or a non-empty string");
    if (typeof rec.eval_name !== "string" || typeof rec.prompt !== "string") errs.push("eval_name and prompt must be strings");
    if (!Array.isArray(rec.assertions)) errs.push("assertions must be an array");
    return errs;
  }
  if (kind === "grading.json") {
    const errs = closed(rec, ["expectations", "summary"], "grading");
    if (errs.length) return errs;
    if (!Array.isArray(rec.expectations)) return ["expectations must be an array"];
    rec.expectations.forEach((e, i) => {
      const where = `expectations[${i}]`;
      const e2 = closed(e, ["text", "passed", "evidence"], where);
      if (e2.length) errs.push(...e2);
      else if (typeof e.text !== "string" || typeof e.passed !== "boolean" || typeof e.evidence !== "string") errs.push(`${where}: text and evidence must be strings, passed a boolean`);
    });
    const s2 = closed(rec.summary, ["passed", "failed", "total", "pass_rate"], "summary");
    if (s2.length) errs.push(...s2);
    else if (![rec.summary.passed, rec.summary.failed, rec.summary.total].every(isInt) || !isNum(rec.summary.pass_rate)) errs.push("summary: passed, failed, total must be integers and pass_rate a number");
    return errs;
  }
  if (kind === "timing.json") {
    const errs = closed(rec, ["total_tokens", "duration_ms", "total_duration_seconds"], "timing");
    if (errs.length) return errs;
    if (!isInt(rec.total_tokens) || !isNum(rec.duration_ms) || !isNum(rec.total_duration_seconds)) errs.push("total_tokens must be an integer, duration_ms and total_duration_seconds numbers");
    return errs;
  }
  throw new Error(`unknown eval record ${kind}`);
}

// HARN-10: a trigger record holds at least 10 should-trigger and 10 near-miss requests with their results.
export function validateTriggerRecord(rec, skill) {
  const errs = closed(rec, ["skill", "date", "model", "requests", "precision", "recall"], "triggers");
  if (errs.length) return errs;
  if (rec.skill !== skill) errs.push(`skill ${JSON.stringify(rec.skill)} is not ${skill}`);
  if (!validDate(String(rec.date))) errs.push("date must be an ISO date");
  if (typeof rec.model !== "string" || !rec.model) errs.push("model must be a non-empty string");
  if (!Array.isArray(rec.requests)) return [...errs, "requests must be an array"];
  const bad = rec.requests.findIndex((r) => !isObj(r) || typeof r.text !== "string" || typeof r.should_trigger !== "boolean" || typeof r.triggered !== "boolean");
  if (bad >= 0) errs.push(`requests[${bad}] needs text, should_trigger and triggered`);
  const should = rec.requests.filter((r) => r?.should_trigger === true).length;
  const near = rec.requests.filter((r) => r?.should_trigger === false).length;
  if (should < 10 || near < 10) errs.push(`needs 10 should-trigger and 10 near-miss requests (has ${should} and ${near})`);
  if (!isNum(rec.precision) || !isNum(rec.recall)) errs.push("precision and recall must be numbers");
  return errs;
}
