// Verb compatibility check of the workflow compositions (kit feedback 87): a static scan of `.agents/workflows/*.js` for
// the flow and gsd verbs they call (`flow(["<verb>", ...])`, `gsd(["<verb>", ...])`) against the kit's verb tables.
// Scripts cannot import, so these verbs are the whole API a composition has; an unknown verb fails at run time, this
// check names it before the run. Used by kit.mjs update, ph doctor and ph harness lint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../lib/io.mjs";
import { VERBS } from "./commands.mjs";

export const WORKFLOWS_REL = ".agents/workflows";
export const VERBS_DOC = 'docs/INTERFACES.md of the kit, section "Kit verbs (stable API)"';

// The flow verb table is read from the text of gsd-flow.mjs next to this runtime (its COMMANDS keys), not imported:
// ph starts without the workflows folder, and the flow modules are not loaded for every ph command.
export const FLOW_FILE = fileURLToPath(new URL("../../workflows/lib/gsd-flow.mjs", import.meta.url));

export function flowVerbNames(file = FLOW_FILE) {
  if (!fs.existsSync(file)) return null;
  const body = /^const COMMANDS = \{\r?\n([\s\S]*?)^\};/m.exec(readText(file))?.[1] ?? "";
  return [...body.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z_$][\w$]*)):/gm)].map((m) => m[1] ?? m[2]);
}

const CALL = /\b(flow|gsd)\(\s*\[/g;
// Scripts that define the shared helpers: flow runs gsd-flow.mjs, gsd runs `ph gsd`.
const DEFINES = { flow: /gsd-flow\.mjs/, gsd: /["']gsd["'],\s*\.\.\.argv/ };

// The first three elements of the array literal starting at `at` (`query a b` is the longest verb name): a string for
// a literal, null for anything computed.
function leadingElements(text, at) {
  const out = [];
  let i = at;
  while (out.length < 3) {
    while (/\s/.test(text[i] ?? "")) i++;
    const q = text[i];
    if (q !== '"' && q !== "'" && q !== "`") {
      if (q !== "]") out.push(null);
      break;
    }
    let value = "";
    let j = i + 1;
    for (; j < text.length && text[j] !== q; j++) {
      if (text[j] === "\\") {
        j++;
        if (value !== null) value += text[j];
      } else if (q === "`" && text[j] === "$" && text[j + 1] === "{") value = null;
      else if (value !== null) value += text[j];
    }
    out.push(value);
    i = j + 1;
    while (/\s/.test(text[i] ?? "")) i++;
    if (text[i] !== ",") break;
    i++;
  }
  return out;
}

// `ph gsd` names a verb as `a.b`, `a b`, `query a b` or `a` (gsd/commands.mjs resolveVerb); undefined = not resolvable.
function gsdVerb(tokens) {
  const t = tokens[0] === "query" ? tokens.slice(1) : tokens;
  if (typeof t[0] !== "string" || t[0].startsWith("--")) return undefined;
  if (t[0].includes(".")) return t[0];
  if (typeof t[1] === "string" && Object.hasOwn(VERBS, `${t[0]}.${t[1]}`)) return `${t[0]}.${t[1]}`;
  if (t[1] === null && !Object.hasOwn(VERBS, t[0]) && Object.keys(VERBS).some((v) => v.startsWith(`${t[0]}.`))) return undefined;
  return t[0];
}

// {calls: [{kind: flow|gsd, verb, line}], dynamic: <calls whose verb is computed>} of one script's text.
export function verbCalls(text) {
  const calls = [];
  let dynamic = 0;
  for (const m of text.matchAll(CALL)) {
    const kind = m[1];
    if (!DEFINES[kind].test(text)) continue;
    const tokens = leadingElements(text, m.index + m[0].length);
    const verb = kind === "flow" ? (typeof tokens[0] === "string" ? tokens[0] : undefined) : gsdVerb(tokens);
    if (verb === undefined) dynamic++;
    else calls.push({ kind, verb, line: text.slice(0, m.index).split("\n").length });
  }
  return { calls, dynamic };
}

// Why a call's verb is not served by the kit, null when it is; `flowVerbs` null = gsd-flow.mjs is missing.
export function verbProblem({ kind, verb }, flowVerbs = flowVerbNames()) {
  if (kind === "flow") {
    if (!flowVerbs) return `flow verb "${verb}" cannot be served: .agents/workflows/lib/gsd-flow.mjs is missing (reinstall the kit parts)`;
    return flowVerbs.includes(verb) ? null : `flow verb "${verb}" is not a kit verb (gsd-flow.mjs knows ${flowVerbs.length} verbs; see ${VERBS_DOC})`;
  }
  const entry = VERBS[verb];
  if (!entry) return `gsd verb "${verb}" is not a kit verb (see ph gsd verbs and ${VERBS_DOC})`;
  return entry.ported ? null : `gsd verb "${verb}" is not served by the kit: ${entry.reason}`;
}

// The top-level workflow scripts of a project, repo-relative and sorted.
export function compositionScripts(root) {
  const dir = path.join(root, WORKFLOWS_REL);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => `${WORKFLOWS_REL}/${e.name}`)
    .sort();
}

// {scripts, calls, dynamic, problems: [{file, line, msg}]} over every composition script of `root`.
export function checkCompositionVerbs(root) {
  const scripts = compositionScripts(root);
  const flowVerbs = flowVerbNames();
  const problems = [];
  let calls = 0;
  let dynamic = 0;
  for (const file of scripts) {
    const scan = verbCalls(readText(path.join(root, file)));
    calls += scan.calls.length;
    dynamic += scan.dynamic;
    for (const call of scan.calls) {
      const msg = verbProblem(call, flowVerbs);
      if (msg) problems.push({ file, line: call.line, msg });
    }
  }
  return { scripts: scripts.length, calls, dynamic, problems };
}

export const problemText = (p) => `${p.file}:${p.line}: ${p.msg}`;
