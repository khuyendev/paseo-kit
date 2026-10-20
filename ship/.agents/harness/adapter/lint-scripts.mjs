// Mechanical checks of generated workflow scripts (HARN-06, HARN-18): a pure-literal meta with name and
// description, phase() titles declared in meta.phases, no clock or randomness, null-guarded array results.
import vm from "node:vm";

const META_START = /^export\s+const\s+meta\s*=\s*/;

// Skips whitespace and comments from `i`; returns the next index.
function skipTrivia(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("//", i)) i = src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
    else if (src.startsWith("/*", i)) i = src.indexOf("*/", i) < 0 ? src.length : src.indexOf("*/", i) + 2;
    else return i;
  }
}

// The balanced `{...}` starting at `i` (strings, templates and comments skipped), or null.
function objectLiteral(src, i) {
  if (src[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (j++; j < src.length && src[j] !== ch; j++) if (src[j] === "\\") j++;
    } else if (src.startsWith("//", j)) j = src.indexOf("\n", j) < 0 ? src.length : src.indexOf("\n", j);
    else if (src.startsWith("/*", j)) j = src.indexOf("*/", j) + 1 || src.length;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

// String contents and comments removed, so only the literal's structure remains.
function structureOnly(literal) {
  return literal
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

// Returns {meta} or {error} for the script's leading meta statement (FLOW-01 rules).
export function readMeta(text) {
  const src = String(text).replace(/^\uFEFF/, "");
  const start = skipTrivia(src, 0);
  const head = src.slice(start).match(META_START);
  if (!head) return { error: "the first statement is not `export const meta = {...}`" };
  const literal = objectLiteral(src, start + head[0].length);
  if (!literal) return { error: "meta is not an object literal" };
  if (/[()`]|\.\.\./.test(structureOnly(literal))) return { error: "meta is not a pure literal (no calls, templates or spreads)" };
  let meta;
  try {
    meta = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
  } catch (e) {
    return { error: `meta does not evaluate: ${e.message}` };
  }
  for (const key of ["name", "description"]) {
    if (typeof meta[key] !== "string" || !meta[key].trim()) return { error: `meta.${key} must be a non-empty string` };
  }
  if (meta.phases !== undefined && (!Array.isArray(meta.phases) || meta.phases.some((p) => typeof p?.title !== "string"))) {
    return { error: "meta.phases must be an array of {title}" };
  }
  return { meta };
}

export const looksLikeWorkflowScript = (text) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*export\s+const\s+meta\b/.test(String(text).replace(/^\uFEFF/, ""));

const ARRAY_USE = String.raw`\s*\.\s*(?:map|forEach|reduce|some|every|flatMap|join|length|slice|sort|find|findIndex|entries|concat|at)\b`;

// Returns [{level, line, msg}].
export function lintWorkflowScript(text) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  const lineOf = (index) => String(text).slice(0, index).split("\n").length;
  const { meta, error } = readMeta(text);
  if (error) findings.push({ level: "fail", line: 1, msg: error });
  lines.forEach((line, i) => {
    for (const [re, what] of [[/\bDate\.now\s*\(/, "Date.now()"], [/\bMath\.random\s*\(/, "Math.random()"], [/\bnew\s+Date\s*\(\s*\)/, "new Date()"]]) {
      if (re.test(line)) findings.push({ level: "fail", line: i + 1, msg: `${what} breaks resume; pass times and seeds through args` });
    }
  });
  const titles = new Set((meta?.phases ?? []).map((p) => p.title));
  for (const m of String(text).matchAll(/\bphase\(\s*(['"`])([^'"`$]*)\1\s*\)/g)) {
    if (meta && !titles.has(m[2])) findings.push({ level: "fail", line: lineOf(m.index), msg: `phase('${m[2]}') has no entry in meta.phases` });
  }
  for (const m of String(text).matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(parallel|pipeline|agent)\s*\(/g)) {
    const [, name, fn] = m;
    const v = name.replace(/\$/g, "\\$");
    const rest = String(text).slice(m.index + m[0].length);
    const guarded = fn === "agent"
      ? new RegExp(String.raw`\b${v}\s*\?\.|!\s*${v}\b|\b${v}\s*(?:&&|\?\?|\|\||[!=]==?\s*null)`).test(rest)
      : new RegExp(String.raw`\b${v}\s*\.\s*filter\s*\(\s*Boolean\s*\)`).test(rest);
    const used = fn === "agent"
      ? new RegExp(String.raw`\b${v}(?:\.\w+)*${ARRAY_USE}`).test(rest)
      : new RegExp(String.raw`\b${v}${ARRAY_USE}|for\s*\(\s*(?:const|let|var)\s+\S+\s+of\s+${v}\b|\.\.\.${v}\b`).test(rest);
    if (used && !guarded) findings.push({ level: "warn", line: lineOf(m.index), msg: `${fn}() result ${name} is used as an array without a null guard (.filter(Boolean) or a check)` });
  }
  return findings;
}
