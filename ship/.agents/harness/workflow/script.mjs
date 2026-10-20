// Workflow script format (FLOW-01) and the script context with its determinism guards (FLOW-02).
// The context is not a security boundary (FLOW-49): scripts are trusted project code.
import vm from "node:vm";

const META_START = /^export\s+const\s+meta\s*=\s*/;

// Index just past the end of the comment or string starting at `i`, or -1 when none starts there.
function skipToken(src, i) {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") {
    const end = src.indexOf("\n", i);
    return end < 0 ? src.length : end;
  }
  if (c === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    if (end < 0) throw new Error("workflow script: unterminated comment");
    return end + 2;
  }
  if (c === "'" || c === '"' || c === "`") {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === c) return j + 1;
    }
    throw new Error("workflow script: unterminated string");
  }
  return -1;
}

// Position of the first statement: after whitespace and comments.
function firstStatement(src) {
  let i = 0;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) i = skipToken(src, i);
    else return i;
  }
}

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const skip = skipToken(src, i);
    if (skip >= 0) {
      i = skip - 1;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i + 1;
  }
  throw new Error("meta: no closing brace");
}

// The literal with comments removed and string contents emptied, so only code characters remain.
function codeOnly(literal) {
  let out = "";
  for (let i = 0; i < literal.length; i++) {
    const skip = skipToken(literal, i);
    if (skip < 0) {
      out += literal[i];
      continue;
    }
    if (literal[i] === "`") out += "`";
    else if (literal[i] !== "/") out += "''";
    else out += " ";
    i = skip - 1;
  }
  return out;
}

export const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Split a script into its JSON-cloned meta and a body with the meta statement blanked (line numbers kept).
export function parseScript(source) {
  const src = stripBom(String(source));
  const start = firstStatement(src);
  const m = META_START.exec(src.slice(start));
  if (!m) throw new Error("workflow script must begin with `export const meta = {...}` (its first statement)");
  const open = start + m[0].length;
  if (src[open] !== "{") throw new Error("meta must be an object literal");
  const close = matchBrace(src, open);
  const literal = src.slice(open, close);
  if (/[()`]|\.\.\./.test(codeOnly(literal))) {
    throw new Error("meta must be a pure literal (no calls, spreads, template strings or computed values)");
  }
  let meta;
  try {
    meta = JSON.parse(JSON.stringify(vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })));
  } catch (e) {
    throw new Error(`meta must be a pure literal: ${e.message}`);
  }
  if (typeof meta?.name !== "string" || !meta.name.trim()) throw new Error("meta.name (non-empty string) is required");
  if (typeof meta.description !== "string" || !meta.description.trim()) throw new Error("meta.description (non-empty string) is required");
  if (meta.phases !== undefined) {
    if (!Array.isArray(meta.phases) || !meta.phases.every((p) => p && typeof p === "object" && typeof p.title === "string")) {
      throw new Error("meta.phases must be an array of {title}");
    }
  }
  let end = close;
  while (end < src.length && /[ \t;]/.test(src[end])) end++;
  const body = src.slice(0, start) + src.slice(start, end).replace(/[^\n]/g, " ") + src.slice(end);
  return { meta, body };
}

// Runs inside the script context: defines the globals on top of the host bridge `__host` (values cross as JSON).
const PRELUDE = String.raw`
"use strict";
const __h = globalThis.__host;
delete globalThis.__host;
const __msg = (e) => (e && e.message) || String(e);
globalThis.args = __h.argsJson === undefined ? undefined : JSON.parse(__h.argsJson);
globalThis.runId = __h.runId;
Math.random = () => { throw new Error("Math.random() is not available in workflow scripts (it would break resume); vary prompts by index instead"); };
{
  const RealDate = Date;
  const WorkflowDate = function Date(...a) {
    if (!new.target) throw new Error("Date() is not available in workflow scripts (it would break resume); pass times through args");
    if (a.length === 0) throw new Error("new Date() without arguments is not available in workflow scripts (it would break resume); pass times through args");
    return new RealDate(...a);
  };
  WorkflowDate.prototype = RealDate.prototype;
  WorkflowDate.UTC = RealDate.UTC;
  WorkflowDate.parse = RealDate.parse;
  WorkflowDate.now = () => { throw new Error("Date.now() is not available in workflow scripts (it would break resume); pass times through args"); };
  globalThis.Date = WorkflowDate;
}
globalThis.log = (m) => __h.log(String(m));
globalThis.phase = (t) => __h.phase(String(t));
{
  const say = (...a) => __h.log(a.map(String).join(" "));
  const methods = { log: say, info: say, warn: say, error: say };
  globalThis.console = new Proxy(methods, {
    get(target, key) {
      if (typeof key === "symbol" || Object.hasOwn(target, key)) return target[key];
      throw new Error("console." + key + " is not available in workflow scripts (use console.log, info, warn or error)");
    },
  });
}
globalThis.agent = async (prompt, opts) => {
  const r = await __h.agent(String(prompt), opts === undefined ? undefined : JSON.stringify(opts));
  if (r === null) return null;
  return r.kind === "text" ? r.value : JSON.parse(r.value);
};
globalThis.parallel = async (thunks) => {
  if (!Array.isArray(thunks)) throw new TypeError("parallel() takes an array of functions");
  __h.checkItems(thunks.length, "parallel");
  return Promise.all(thunks.map(async (t, i) => {
    try { return await t(); } catch (e) { __h.warn("parallel item " + i + " -> null: " + __msg(e)); return null; }
  }));
};
globalThis.pipeline = async (items, ...stages) => {
  if (!Array.isArray(items)) throw new TypeError("pipeline() takes an array of items");
  __h.checkItems(items.length, "pipeline");
  return Promise.all(items.map(async (item, index) => {
    let prev = item;
    for (const stage of stages) {
      try { prev = await stage(prev, item, index); }
      catch (e) { __h.warn("pipeline item " + index + " -> null: " + __msg(e)); return null; }
    }
    return prev;
  }));
};
globalThis.budget = Object.freeze({
  get total() { return __h.budgetTotal(); },
  spent: () => __h.budgetSpent(),
  remaining: () => __h.budgetRemaining(),
});
globalThis.workflow = async (ref, a) => {
  const r = await __h.workflow(JSON.stringify(ref), a === undefined ? undefined : JSON.stringify(a));
  return r === undefined ? undefined : JSON.parse(r);
};
globalThis.shell = async (cmd, opts) => JSON.parse(await __h.shell(JSON.stringify(cmd), opts === undefined ? undefined : JSON.stringify(opts)));
`;

// Run a parsed body in a fresh context; `host` is the bridge the prelude wraps. Resolves the JSON-cloned return value.
export async function runBody(body, scriptPath, host) {
  const context = vm.createContext({ __host: host });
  vm.runInContext(PRELUDE, context, { filename: "workflow-prelude.js" });
  const wrapped = `(async () => {\n${body}\n})()`;
  const result = await new vm.Script(wrapped, { filename: scriptPath, lineOffset: -1 }).runInContext(context);
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}
