// Workflow script format (FLOW-01) and the script context with its determinism guards (FLOW-02).
// The context is not a security boundary (FLOW-49): scripts are trusted project code.
import vm from "node:vm";
import { executeSteps } from "./steps.mjs";

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

// The kit helpers of the compositions (THIN.md item 1, kit feedback 87), once the "shared GSD script helpers" block every
// gsd-*.js copied: verb wrappers, config, the detail agent call, digests, prompt templates. The engine evaluates this
// function's source inside each script context on top of `shell` and `agent`, so it may use only its parameters and
// JavaScript built-ins, and its values belong to the script's realm. A script's own definition of a name wins (the body
// is a function scope); the kit's helpers keep calling each other, not a script's replacement.
export function kitHelpers({ shell, agent, parallel }) {
  const PH = ".agents/harness/ph.mjs";
  const FLOW = ".agents/workflows/lib/gsd-flow.mjs";
  const PHASE_DIR_RE = /^\.planning\/phases\/\d+(\.\d+)?-[a-z0-9-]+$/;
  const lastJson = (text) => { try { return JSON.parse(String(text).trim().split(/\r?\n/).pop()); } catch { return null; } };
  // A verb prints its JSON on one last line; shell() keeps only the last 20000 characters by default, which cut the line of
  // `outline parse` for a 12-plan phase (23 KB) and made the outline look incomplete. Keep the whole output.
  const VERB_TAIL_CHARS = 4000000;
  // GSDF-03: the one verb helper; JSON goes on stdin, only validated values reach the argv.
  async function run(argv, input) {
    const r = await shell(["node", ...argv], { tailChars: VERB_TAIL_CHARS, ...(input === undefined ? {} : { input: typeof input === "string" ? input : JSON.stringify(input) }) });
    return { code: r.code, json: lastJson(r.stdout), stderr: r.stderr };
  }
  async function loadCfg() {
    // Same tail as run(): the default 20000 characters cut a config that had grown past it, and every workflow
    // then failed at its first step.
    const r = await shell(["node", PH, "config"], { tailChars: VERB_TAIL_CHARS });
    if (r.code !== 0) throw new Error(`ph config failed: ${String(r.stderr).split(/\r?\n/)[0]}`);
    return JSON.parse(r.stdout);
  }
  const gsd = (argv, input) => run([PH, "gsd", ...argv], input);
  const flow = (argv, input) => run([FLOW, ...argv], input);
  const phaseNumber = (dir) => /phases\/(\d+(?:\.\d+)?)-/.exec(dir)[1];
  const digestLine = (key, hash) => `Input digest (${key}): ${hash}`;
  const policyBlock = (path) => `<research_input_policy>\n${path ? `Approved research: ${path}. Read and use only this report.` : "Approved research: NONE. Do not read or use any RESEARCH.md on disk."}\n</research_input_policy>`;
  const NEVER_RETRY = /quota|credit|billing|auth|permission|usage limit|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED/i;
  // agent option `detail: true` resolves {result, reason, agentId, worktree, durationS, model, effort};
  // the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
  async function call(prompt, opts) {
    const d = await agent(prompt, { ...opts, detail: true });
    return { result: d?.result ?? null, reason: d?.reason ?? null, model: d?.model ?? null, effort: d?.effort ?? null };
  }
  const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
  const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
  // The refusal of a held lease names the holder's workflow and run (kit-feedback 1); `what` says what it holds.
  const leaseText = (r, what = "this code root") => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds ${what} (${r?.holder ?? r?.error ?? "unknown run"})`;
  async function discussOpen(phaseDir, nn) {
    const ex = (await flow(["exists", `${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`, `${phaseDir}/${nn}-CONTEXT.md`])).json?.exists ?? {};
    if (ex[`${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`]) return "discussion interrupted (DISCUSS-CHECKPOINT present); finish it with gsd-discuss";
    if (!ex[`${phaseDir}/${nn}-CONTEXT.md`]) return "no CONTEXT.md; run gsd-discuss first";
    return null;
  }
  async function sha(text) { return (await gsd(["hash"], text ?? "")).json?.hash ?? null; }
  async function fileSha(path) { const r = await flow(["read", path]); return r.json?.exists ? sha(r.json.text) : null; }
  // A prompt template (`.agents/workflows/prompts/<name>.md`, or `project/<name>`) filled by the flow verb `prompt`; a
  // missing variable, an unknown template or a bad value throws with the verb's error.
  async function renderPrompt(name, vars = {}) {
    const r = await flow(["prompt", name], vars);
    if (r.code !== 0 || typeof r.json?.text !== "string") throw new Error(r.json?.error ?? `prompt ${name}: gsd-flow exited ${r.code}`);
    return r.json.text;
  }
  // Runtime of concurrent steps (THIN stage 2): a bounded pool over items (at most n at a time, results in item order),
  // n slots (at most n calls at once, the others wait in order), a serializer (calls one at a time, in order; a failed
  // call does not stop the next) and a turn lock: `shared` holders run together, an `exclusive` one runs alone, and a
  // waiting request is served before later ones, so neither kind starves.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await parallel(Array.from({ length: Math.min(n, items.length) }, () => async () => {
      while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
  }
  function slots(n) {
    let free = n;
    const waiting = [];
    return async (fn) => {
      if (free > 0) free--;
      else await new Promise((go) => waiting.push(go));
      try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else free++; }
    };
  }
  const serialize = () => {
    let last = Promise.resolve();
    return (fn) => {
      const run = last.then(() => fn());
      last = run.catch(() => {});
      return run;
    };
  };
  function turnLock() {
    const lock = { kind: null, n: 0, queue: [] };
    const pump = () => {
      while (lock.queue.length && (lock.n === 0 || (lock.kind === "shared" && lock.queue[0].kind === "shared"))) {
        const next = lock.queue.shift();
        lock.kind = next.kind;
        lock.n++;
        next.go();
      }
    };
    async function turn(kind, fn) {
      if (lock.queue.length || (lock.n && !(lock.kind === "shared" && kind === "shared"))) await new Promise((go) => lock.queue.push({ kind, go }));
      else { lock.kind = kind; lock.n++; }
      try { return await fn(); } finally {
        if (--lock.n === 0) lock.kind = null;
        pump();
      }
    }
    return { shared: (fn) => turn("shared", fn), exclusive: (fn) => turn("exclusive", fn) };
  }
  return { PH, FLOW, PHASE_DIR_RE, lastJson, VERB_TAIL_CHARS, run, loadCfg, gsd, flow, phaseNumber, digestLine, policyBlock, NEVER_RETRY, call, fatal, needsOwner, leaseText, discussOpen, sha, fileSha, renderPrompt, pool, slots, serialize, turnLock };
}

export const KIT_HELPER_NAMES = Object.freeze(Object.keys(kitHelpers({ shell: null, agent: null, parallel: null })));
// The step libraries (THIN.md stage 3): `executeSteps(run)` (steps.mjs) is bound to the kit helpers above and the runtime
// (agent, shell, parallel, log, phase, runId), never to a script's replacement of one.
export const KIT_STEP_NAMES = Object.freeze(["executeSteps"]);
export { executeSteps };

// Runs inside the script context: defines the globals on top of the host bridge `__host` (values cross as JSON), then
// the kit helpers on top of `shell` and `agent` (writable: a script may wrap `call`), then the step libraries on top of the
// kit's helpers.
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
` + `{
  const __kit = (${kitHelpers})({ shell: globalThis.shell, agent: globalThis.agent, parallel: globalThis.parallel });
  Object.assign(globalThis, __kit);
  const __rt = { shell: globalThis.shell, agent: globalThis.agent, parallel: globalThis.parallel, log: globalThis.log, phase: globalThis.phase, runId: globalThis.runId };
  const __executeSteps = (${executeSteps});
  globalThis.executeSteps = (run) => __executeSteps({ ...__kit, ...__rt }, run);
}
`;

// Run a parsed body in a fresh context; `host` is the bridge the prelude wraps. Resolves the JSON-cloned return value.
export async function runBody(body, scriptPath, host) {
  const context = vm.createContext({ __host: host });
  vm.runInContext(PRELUDE, context, { filename: "workflow-prelude.js" });
  const wrapped = `(async () => {\n${body}\n})()`;
  const result = await new vm.Script(wrapped, { filename: scriptPath, lineOffset: -1 }).runInContext(context);
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}
