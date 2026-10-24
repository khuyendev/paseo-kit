// The project adapter contract (M12): helpers the GSD core, flows and hooks call by name to read the
// `adapter` section. The kit ships a neutral adapter (ADPT-16); projects get theirs from the harness (D-109).
import fs from "node:fs";
import path from "node:path";
import { toSlash } from "../lib/paths.mjs";
import { invokeHook } from "./hooks.mjs";

const BUILTIN_RUNNERS = new Set(["build", "cmd"]);

// ADPT-03: the kind whose prefix starts the `<automated>` text; the longest prefix wins so `test:unit:` beats `test:`.
export function classifyObligation(cfg, text) {
  const trimmed = String(text).trim();
  let best = null;
  for (const [kind, entry] of Object.entries(cfg.adapter.verify_vocabulary)) {
    if (!trimmed.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.entry.prefix.length) best = { kind, entry };
  }
  if (!best) return null;
  return { kind: best.kind, argument: trimmed.slice(best.entry.prefix.length).trim(), entry: best.entry };
}

// ADPT-03 default parser: one target, the trimmed argument (none for an empty argument).
export const defaultTargets = (argument) => (String(argument).trim() ? [String(argument).trim()] : []);

// ADPT-03: `{argument}` becomes one argv element, `{targets}` one element per target (spaces kept, no shell).
export function substitutePlaceholders(argv, { argument = "", targets = [] } = {}) {
  const out = [];
  for (const word of argv) {
    if (word === "{targets}") out.push(...targets);
    else out.push(word.split("{argument}").join(argument));
  }
  return out;
}

// Splits a `cmd:` argument into argv words; double or single quotes group words, no other shell syntax.
export function splitCommandLine(text) {
  const words = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (const ch of String(text)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) words.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started || cur) words.push(cur);
  return words;
}

// ADPT-02/03: the argv that runs an obligation. `configured: false` = the gate reports `not configured`.
export function obligationCommand(cfg, { kind, argument = "", targets = defaultTargets(argument) }) {
  const { commands, verify_vocabulary: vocab } = cfg.adapter;
  const entry = vocab[kind];
  if (!entry) throw new Error(`verify kind ${kind} is not registered in adapter.verify_vocabulary`);
  if (entry.runner !== null) {
    const runner = commands.verify[entry.runner];
    if (!runner) throw new Error(`adapter.verify_vocabulary.${kind}.runner ${entry.runner} is not a key of adapter.commands.verify`);
    return { configured: true, argv: substitutePlaceholders(runner.argv, { argument, targets }), timeoutS: runner.timeout_s };
  }
  if (kind === "build") return commandFor(cfg, "build");
  if (kind === "cmd") {
    const argv = splitCommandLine(argument);
    return argv.length ? { configured: true, argv, timeoutS: commands.test_timeout_s } : { configured: false, argv: null, timeoutS: null };
  }
  throw new Error(`verify kind ${kind} has no runner (only build and cmd have built-in runners)`);
}

// ADPT-02: build or test argv and timeout; a null command is `configured: false`, never green.
export function commandFor(cfg, name) {
  const { commands } = cfg.adapter;
  const argv = commands[name];
  return argv ? { configured: true, argv: [...argv], timeoutS: commands[`${name}_timeout_s`] } : { configured: false, argv: null, timeoutS: null };
}

// Kit feedback 102 F2: the arguments that give each test case its own limit (adapter.commands.test_case_timeout_s through the
// test_case_timeout_arg template, `{s}` = the seconds), so a hung test fails in seconds, not at the step timeout. An argv that
// starts with adapter.commands.test gets them right after that prefix, unless its rest already names the flag (the template's
// first word up to `{s}`); any other argv, or either key unset, is returned as it is.
export function withTestCaseTimeout(cfg, argv) {
  const { test, test_case_timeout_s: seconds, test_case_timeout_arg: template } = cfg.adapter.commands;
  if (!Array.isArray(argv) || !test?.length || !seconds || !template?.length) return argv;
  if (argv.length < test.length || test.some((w, i) => argv[i] !== w)) return argv;
  const flag = template[0].split("{s}")[0];
  const rest = argv.slice(test.length);
  if (flag && rest.some((w) => w === flag || w.startsWith(flag.endsWith("=") ? flag : `${flag}=`))) return argv;
  return [...test, ...template.map((w) => w.split("{s}").join(String(seconds))), ...rest];
}
// The test command the gate runs and its fixers are given: {argv (null without adapter.commands.test), caseTimeoutS (the per-test
// limit it carries, or null)}; `argv` defaults to adapter.commands.test (gsd-execute passes its normalized form).
export function testCommandOf(cfg, argv = cfg.adapter.commands.test) {
  if (!argv) return { argv: null, caseTimeoutS: null };
  const out = withTestCaseTimeout(cfg, argv);
  return { argv: out, caseTimeoutS: out.length > argv.length ? cfg.adapter.commands.test_case_timeout_s : null };
}

export const isBuiltinRunnerKind = (kind) => BUILTIN_RUNNERS.has(kind);

// ADPT-03 default `cmd` resolution: the first path-like token (has a slash or a file extension) against the code root.
export function resolveCmdTarget(codeRoot, argument) {
  const token = splitCommandLine(argument).find((w) => /[\\/]/.test(w) || /\.[A-Za-z0-9]+$/.test(w));
  if (!token) return { target: String(argument).trim(), status: "ok", detail: "no path-like token" };
  return { target: token, status: fs.existsSync(path.resolve(codeRoot, token)) ? "ok" : "missing" };
}

// ADPT-04: the path glob an owns entry such as `Path:pkg/` stands for, or null when no owns form matches.
export function ownsGlob(cfg, ownsEntry) {
  const text = String(ownsEntry).trim();
  const form = cfg.adapter.ownership.owns_forms.find((f) => text.startsWith(f.prefix));
  if (!form) return null;
  const value = toSlash(text.slice(form.prefix.length).trim()).replace(/^\.\//, "");
  const glob = form.maps_to.split("<path>").join(value);
  return glob.endsWith("/") ? `${glob}**` : glob;
}

export function matchesGlob(relPath, glob) {
  const rel = toSlash(relPath).replace(/^\.\//, "");
  return path.posix.matchesGlob(rel, glob) || (glob.endsWith("/**") && rel === glob.slice(0, -3));
}

// A regenerated or generated entry: a glob string, or {glob, source?} (kit feedback 120). A string has no source.
export function asGlob(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.glob === "string") return entry.glob;
  return "";
}

export function entrySource(entry) {
  return entry && typeof entry === "object" && typeof entry.source === "string" && entry.source.trim() ? entry.source.trim() : null;
}

// adapter.ownership.regenerated, then optional adapter.generated. An unreadable shape contributes nothing.
export function generatedRules(cfg) {
  const own = cfg?.adapter?.ownership?.regenerated ?? [];
  const extra = cfg?.adapter?.generated ?? [];
  const out = [];
  for (const e of [...own, ...extra]) {
    const glob = asGlob(e);
    if (glob) out.push({ glob, source: entrySource(e) });
  }
  return out;
}

// The first matching rule; a later rule replaces it when only the later one names a source.
export function generatedMatch(rules, rel) {
  let hit = null;
  for (const r of rules ?? []) {
    if (!r?.glob) continue;
    let ok = false;
    try { ok = matchesGlob(rel, r.glob); } catch { ok = false; }
    if (!ok) continue;
    if (!hit || (!hit.source && r.source)) hit = r;
  }
  return hit;
}

// ADPT-04: shared by the adapter's globs (the predicate script is asked through hooks.mjs `shared`).
export const isSharedByGlobs = (cfg, relPath) => cfg.adapter.ownership.shared.globs.some((g) => matchesGlob(relPath, g));

// ADPT-05: lenses of a stage that apply to a file (no `file` = every lens of the stage).
export function lensesFor(cfg, { stage = "code", file } = {}) {
  return cfg.adapter.review_lenses.filter((lens) => {
    if ((lens.stage ?? "code") !== stage) return false;
    if (file === undefined || !lens.applies_to?.length) return true;
    return lens.applies_to.some((g) => matchesGlob(file, g));
  });
}

// ADPT-06: the checker entry for a file's extension, or null (nothing is spawned for it).
export function syntaxCheckerFor(cfg, file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (!ext) return null;
  const checkers = cfg.adapter.syntax_checkers;
  const key = Object.keys(checkers).find((k) => k.toLowerCase() === ext);
  return key ? checkers[key] : null;
}

// ADPT-07: absolute paths of the instruction files, in adapter order.
export const instructionFiles = (cfg, codeRoot) => cfg.adapter.instructions.map((rel) => path.resolve(codeRoot, rel));

export const ENVELOPE_RULE = "Judge a fix against the declared envelope, not one sample point.";

// ADPT-08: the axes block for executor briefs and the review rule line, or null when no envelope is declared.
export function envelopeBlock(cfg) {
  const envelope = cfg.adapter.envelope;
  if (!envelope?.length) return null;
  const lines = envelope.map((e) => {
    const span = e.values ? `values ${e.values.map(String).join(", ")}` : `range ${e.range.map(String).join(" .. ")}`;
    return `- ${e.axis}: ${span} (source: ${e.source})`;
  });
  return { axes: ["Operating envelope:", ...lines].join("\n"), rule: ENVELOPE_RULE };
}

// ADPT-09: the stack-skill line of executor and fixer prompts, or null without a stack skill.
export function stackSkillLine(cfg) {
  const skill = cfg.adapter.stack_skill;
  return skill ? `Follow the ${skill} skill (.claude/skills/${skill}/SKILL.md).` : null;
}

// ADPT-09: the project agent type replacing the generic agent of a GSD role, else the generic type.
export const agentTypeFor = (cfg, role, genericType) => cfg.adapter.agents[role] ?? genericType;

// ADPT-09 / GSDF-20: the wiring stage runs only when the adapter maps an architect.
export const wiringEnabled = (cfg) => Boolean(cfg.adapter.agents.architect);

// ADPT-03/15 for the post-wave gate (CR-HAR-02): kind, argument, targets and the exact runner argv of one plan
// obligation `{kind, command, target?}`. A failed parser or a missing runner is `unavailable` and nothing runs.
// Resolves {outcome: ready|unavailable|not_configured, kind, argument, targets, argv, timeoutS, exitCodeSufficient, evidenceParser, reason}.
export async function gateObligation(cfg, { codeRoot, phaseDir, kind, command = "", target }) {
  const entry = cfg.adapter.verify_vocabulary[kind];
  const text = String(command).trim();
  const argument = entry && text.startsWith(entry.prefix) ? text.slice(entry.prefix.length).trim() : text;
  const base = { kind, argument, targets: [], argv: null, timeoutS: null, exitCodeSufficient: Boolean(entry?.exit_code_sufficient), evidenceParser: entry?.evidence_parser ?? null, reason: null };
  if (!entry) return { ...base, outcome: "unavailable", reason: `kind ${kind} not in adapter.verify_vocabulary` };
  let targets = target ? [String(target)] : defaultTargets(argument);
  if (entry.parser) {
    const parsed = await invokeHook(cfg, { codeRoot, script: entry.parser, op: "parse", phaseDir, kind, argument });
    if (!parsed.ok) return { ...base, outcome: "unavailable", reason: parsed.reason };
    targets = parsed.response.targets;
  }
  // G094: a kind that is not exit-code-sufficient needs a named target; an empty selection runs with no selector and proves nothing.
  if (!entry.exit_code_sufficient && !targets.length) return { ...base, targets, outcome: "unavailable", reason: "no concrete targets selected" };
  let run;
  try {
    run = obligationCommand(cfg, { kind, argument, targets });
  } catch (e) {
    return { ...base, targets, outcome: "unavailable", reason: e.message };
  }
  if (!run.configured) return { ...base, targets, outcome: "not_configured", reason: `no command for kind ${kind}` };
  return { ...base, targets, outcome: "ready", argv: withTestCaseTimeout(cfg, run.argv), timeoutS: run.timeoutS };
}
