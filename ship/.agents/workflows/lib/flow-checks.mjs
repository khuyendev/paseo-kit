// Kit feedback 87 C1: checks may not be weakened silently. `check-weakening <phaseDir>` {base?, files?} compares the test and gate
// files changed since the base (HEAD by default) with their base content and reports a deleted test file, removed tests, fewer
// assertions, added skip markers, a changed gate file, and a gate configuration (adapter.commands, verify_vocabulary, checks)
// that differs from the hash the phase baseline recorded. Kit feedback 103: an argv that keeps the old argv and only adds a
// strictness flag (a timeout, fail-fast, a reporter or output flag, verbosity, or a flag the baseline's
// adapter.commands.non_weakening_flags already names) is a note, not a weakening; a removed argument, a narrowed filter or
// path, an added skip, a changed executable, and any verify_vocabulary or checks change still stop. A weakening stands only
// when a plan of the phase declares its path in a <check_changes> block or the owner answered `ph gsd allow`. flow-gate.mjs
// runs it in every gate, so no composition skips it.
// Kit feedback 92: skip markers count only against a base the files had, a marker on a line holding one of
// adapter.checks.skip_guards (an environment guard) is no skip, and an added-skips weakening names the line of each new marker.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadKitConfig, mergeOverlay, OVERLAY_REL } from "../../harness/config.mjs";
import { matchesGlob } from "../../harness/adapter/contract.mjs";
import { DEBUG_DIR, gateConfig, gateConfigHash } from "../../harness/gsd/allow.mjs";
import { checkChanges } from "../../harness/gsd/planning.mjs";
import { readJsonIf } from "../../harness/lib/io.mjs";
import { OWNER_ANSWERS_FILE, readAnswers } from "../../harness/lib/owner-answers.mjs";
import { resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { git } from "./flow-git.mjs";
import { contentHash } from "./flow-owns.mjs";

const r = String.raw;
// The stack defaults: which files are tests (paths are matched only for the stack's extensions) and the regexes of a test
// declaration (group 1, else the first string literal after it, else the function under an attribute line, is its name), an
// assertion and a skip marker. Comment lines never count, so a commented-out assertion is a removed one. The C++ stack also
// reports a narrowed automation-test flag expression and a wider TestNearlyEqual tolerance; those are not counts.
export const STACKS = Object.freeze([
  {
    name: "dart", ext: [".dart"], comment: "c",
    paths: ["**/test/**", "**/integration_test/**", "**/test_driver/**", "**/*_test.dart"],
    test_decl: [r`^\s*(?:test|testWidgets|testGoldens|blocTest|patrolTest|patrolWidgetTest|goldenTest)\s*(?:<[^>]*>)?\s*\(`],
    assert: [r`(?<![\w.$])(?:expect|expectLater|expectAsync\d*|verify|verifyNever|verifyInOrder|verifyZeroInteractions|verifyNoMoreInteractions|fail)\s*(?:<[^>]*>)?\s*\(`],
    skip: [r`\bskip\s*:\s*(?!null\b|false\b)\S`, r`@Skip\b`, r`\bmarkTestSkipped\s*\(`, r`\bsolo\s*:\s*true\b`],
  },
  {
    name: "js", ext: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"], comment: "c",
    paths: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**", "**/spec/**", "**/e2e/**"],
    test_decl: [r`(?<![\w.$])(?:it|test|specify)(?:\.(?:each|concurrent|failing|only|skip|todo|serial|parallel|fixme|fail|slow)\b)*\s*\(`],
    assert: [r`(?<![\w.$])(?:expect|assert)\s*[.(]`, r`\.should\b`, r`(?<![\w.$])t\.(?:is|not|true|false|truthy|falsy|deepEqual|notDeepEqual|like|throws|throwsAsync|notThrows|notThrowsAsync|regex|notRegex|snapshot|assert|pass|fail)\s*\(`],
    skip: [r`(?<![\w.$])(?:it|test|describe|context|suite|specify)\.(?:skip|only|todo|fixme)\b`, r`(?<![\w.$])(?:xit|xtest|xdescribe|xcontext|xspecify|fit|fdescribe|fcontext)\s*\(`, r`[{,]\s*(?:skip|todo|only)\s*:\s*(?!false\b|undefined\b|null\b)[^\s,}]`, r`(?<![\w.$])(?:t|this|ctx|context)\.(?:skip|todo)\s*\(`],
  },
  {
    name: "python", ext: [".py"], comment: "#",
    paths: ["**/test_*.py", "**/*_test.py", "**/tests/**", "**/test/**", "**/conftest.py"],
    test_decl: [r`^\s*(?:async\s+)?def\s+(test\w*)\s*\(`],
    assert: [r`^\s*assert\b`, r`(?<![\w.])self\.(?:assert\w*|fail\w*)\s*\(`, r`\.assert_\w+\s*\(`, r`(?<![\w.])assert_\w+\s*\(`, r`(?<![\w.])pytest\.(?:raises|warns|fail)\s*\(`],
    skip: [r`@(?:pytest\.mark\.(?:skip|skipif|xfail)|unittest\.(?:skip|skipIf|skipUnless|expectedFailure)|skip|skipIf|skipUnless|expectedFailure)\b`, r`(?<![\w.])pytest\.(?:skip|xfail|importorskip)\s*\(`, r`\bself\.skipTest\s*\(`, r`\braise\s+(?:unittest\.)?SkipTest\b`],
  },
  {
    name: "go", ext: [".go"], comment: "c",
    paths: ["**/*_test.go"],
    test_decl: [r`^func\s+(?:\([^)]*\)\s*)?((?:Test|Benchmark|Fuzz|Example)\w*)\s*\(`, r`(?<![\w.])(?:t|b|tt|s)\.Run\s*\(`],
    assert: [r`(?<![\w.])(?:t|b|f|tb|tt)\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(`, r`(?<![\w.])(?:assert|require)\.[A-Z]\w*\s*\(`],
    skip: [r`(?<![\w.])(?:t|b|f|tb|tt|s)\.(?:Skip|Skipf|SkipNow)\s*\(`],
  },
  {
    name: "rust", ext: [".rs"], comment: "c", inline: true,
    paths: ["**/tests/**", "**/benches/**"],
    test_decl: [r`^\s*#\[(?:[\w:]+::)?test\b`],
    assert: [r`\b\w*assert\w*!\s*[(\[{]`, r`#\[should_panic\b`],
    skip: [r`#\[ignore\b`],
  },
  {
    name: "jvm", ext: [".java", ".kt", ".kts"], comment: "c",
    paths: ["**/src/test/**", "**/src/androidTest/**", "**/src/integrationTest/**", "**/*Test.java", "**/*Tests.java", "**/*IT.java", "**/*Test.kt", "**/*Tests.kt"],
    test_decl: [r`^\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate|Property)\b`],
    assert: [r`(?<![\w$])(?:assert[A-Z]\w*|fail|verify)\s*\(`, r`^\s*assert\s`, r`\bshould(?:Be|NotBe|Equal|Contain|Throw|Have)\w*\b`],
    skip: [r`@(?:Disabled|Ignore|EnabledIf|DisabledIf|EnabledOn|DisabledOn)\w*\b`, r`(?<![\w$])assume(?:True|False|That|NotNull)?\s*\(`],
  },
  {
    name: "cpp", ext: [".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".inl"], comment: "c",
    paths: ["**/Tests/**", "**/Test/**", "**/*Test*.cpp", "**/*Spec*.cpp", "**/*.spec.cpp"],
    test_decl: [
      r`(?<![\w])(?:IMPLEMENT_SIMPLE_AUTOMATION_TEST|IMPLEMENT_COMPLEX_AUTOMATION_TEST|BEGIN_DEFINE_SPEC)\s*\(\s*([A-Za-z_]\w*)`,
      r`(?<![\w])TEST(?:_[FP])?\s*\(\s*(\w+\s*,\s*\w+)`,
      r`(?<![\w])(?:TEST_CASE|SCENARIO|TEMPLATE_TEST_CASE)\s*\(`,
    ],
    assert: [
      r`(?<![\w])Test(?:True|False|Equal|NotEqual|NearlyEqual|Null|NotNull|Valid|Invalid|Same|NotSame)\s*\(`,
      r`(?<![\w])AddExpectedError\s*\(`,
      r`(?<![\w])UTEST_\w*`,
      r`(?<![\w])(?:EXPECT|ASSERT)_\w+`,
      r`(?<![\w])(?:CHECK|REQUIRE)(?:_\w+)?\s*\(`,
    ],
    skip: [r`(?<![\w])GTEST_SKIP\s*\(`, r`(?<![\w])DISABLED_`],
    extra: cppExtras,
  },
]);

const KINDS = ["test_decl", "assert", "skip"];
const compiled = new Map();
const rx = (src, flags = "") => {
  const key = `${flags}/${src}`;
  if (!compiled.has(key)) compiled.set(key, new RegExp(src, flags));
  return compiled.get(key);
};
const lf = (text) => String(text).replace(/\r\n?/g, "\n");
const key = (rel) => (process.platform === "win32" ? rel.toLowerCase() : rel);

// The lines of a file with comment lines blanked: `//` and `/* */` blocks that start a line (c), or `#` lines.
function codeLines(text, comment) {
  let block = false;
  return lf(text).split("\n").map((line) => {
    const t = line.trim();
    if (comment === "#") return t.startsWith("#") ? "" : line;
    if (block) {
      if (t.includes("*/")) block = false;
      return "";
    }
    if (t.startsWith("/*")) {
      block = !t.slice(2).includes("*/");
      return "";
    }
    return t.startsWith("//") ? "" : line;
  });
}

const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/;
const UNDER_ATTRIBUTE = /\b(?:fn|fun|void)\s+(`[^`]+`|\w+)|(\w+)\s*\(/;
function declName(m, lines, i) {
  if (m[1]) return m[1];
  const lit = LITERAL.exec(lines[i].slice(m.index + m[0].length));
  if (lit) return lit[2];
  if (!/^\s*(@|#\[)/.test(lines[i])) return null;
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    if (!lines[j].trim() || /^\s*(@|#\[)/.test(lines[j])) continue;
    const u = UNDER_ATTRIBUTE.exec(lines[j]);
    return u ? (u[1] ?? u[2]).replace(/`/g, "") : null;
  }
  return null;
}

const count = (line, list) => list.reduce((n, src) => n + (line.match(rx(src, "g"))?.length ?? 0), 0);
const squeeze = (text) => text.replace(/\s+/g, "");

// C++ flag and tolerance checks read the whole file with comment lines blanked; a `return;` early-out is not one
// (it is not an assert and not a skip). AddExpectedError is an assertion above, so removing one is asserts-removed.
const FLAG_MACROS = /(?<![\w])(?:IMPLEMENT_SIMPLE_AUTOMATION_TEST|IMPLEMENT_COMPLEX_AUTOMATION_TEST|BEGIN_DEFINE_SPEC)\s*\(/;
const FLAG_KEEP = ["EngineFilter", "ProductFilter", "ApplicationContextMask", "ClientContext", "EditorContext", "ServerContext"];
const FLAG_GAIN = ["Disabled", "Negative"];
const TOLERANCE = Object.freeze({
  SMALL_NUMBER: 1e-8,
  KINDA_SMALL_NUMBER: 1e-4,
  BIG_NUMBER: 3.4e38,
  UE_SMALL_NUMBER: 1e-8,
  UE_KINDA_SMALL_NUMBER: 1e-4,
  UE_DOUBLE_SMALL_NUMBER: 1e-8,
  UE_DOUBLE_KINDA_SMALL_NUMBER: 1e-4,
  DOUBLE_SMALL_NUMBER: 1e-8,
  DOUBLE_KINDA_SMALL_NUMBER: 1e-4,
});

function readBalanced(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\"" || c === "'") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

function splitArgs(body) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\"" || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      args.push(body.slice(start, i));
      start = i + 1;
    }
  }
  args.push(body.slice(start));
  return args;
}

function eachCall(src, re, fn) {
  const rxg = new RegExp(re.source, "g");
  let m;
  while ((m = rxg.exec(src))) {
    const open = m.index + m[0].length - 1;
    if (src[open] !== "(") continue;
    const body = readBalanced(src, open);
    if (body === null) continue;
    fn(body);
    rxg.lastIndex = open + body.length + 2;
  }
}

const hasToken = (expr, token) => new RegExp(`(?:^|[^A-Za-z0-9])${token}(?![A-Za-z0-9])`).test(expr);

function flagFindings(baseText, nowText) {
  const scan = (text) => {
    const out = [];
    eachCall(codeLines(text, "c").join("\n"), FLAG_MACROS, (body) => {
      const args = splitArgs(body);
      const name = /^\s*([A-Za-z_]\w*)/.exec(args[0] ?? "");
      if (name) out.push({ name: name[1], flags: args.slice(2).join(",") });
    });
    return out;
  };
  const nowBy = new Map();
  for (const e of scan(nowText)) (nowBy.get(e.name) ?? nowBy.set(e.name, []).get(e.name)).push(e);
  const used = new Map();
  const found = [];
  for (const e of scan(baseText)) {
    const list = nowBy.get(e.name);
    const i = used.get(e.name) ?? 0;
    if (!list || i >= list.length) continue;
    used.set(e.name, i + 1);
    const lost = FLAG_KEEP.filter((t) => hasToken(e.flags, t) && !hasToken(list[i].flags, t));
    const gained = FLAG_GAIN.filter((t) => hasToken(list[i].flags, t) && !hasToken(e.flags, t));
    if (!lost.length && !gained.length) continue;
    const bits = [...(lost.length ? [`lost ${lost.join(", ")}`] : []), ...(gained.length ? [`gained ${gained.join(", ")}`] : [])];
    found.push({ kind: "flags-narrowed", detail: `${e.name}: flag expression ${bits.join("; ")}` });
  }
  return found;
}

function toleranceValue(expr) {
  const t = expr.trim().replace(/\s+/g, "");
  const num = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[fF]?$/.exec(t);
  if (num) return Number(num[1]);
  const id = /^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/.exec(t);
  return id && Object.hasOwn(TOLERANCE, id[1]) ? TOLERANCE[id[1]] : null;
}

function nearlyCalls(text) {
  const out = [];
  eachCall(codeLines(text, "c").join("\n"), /(?<![\w])TestNearlyEqual\s*\(/, (body) => {
    const args = splitArgs(body).map((a) => a.trim());
    const explicit = args.length >= 4;
    out.push({
      key: (args[0] ?? "").replace(/\s+/g, ""),
      tol: explicit ? toleranceValue(args[args.length - 1]) : TOLERANCE.KINDA_SMALL_NUMBER,
      shown: explicit ? args[args.length - 1].replace(/\s+/g, " ") : "KINDA_SMALL_NUMBER (default)",
    });
  });
  return out;
}

function toleranceFindings(baseText, nowText) {
  const now = nearlyCalls(nowText);
  const used = new Set();
  const found = [];
  for (const e of nearlyCalls(baseText)) {
    const i = now.findIndex((n, idx) => !used.has(idx) && n.key === e.key);
    if (i < 0 || e.tol === null || now[i].tol === null) continue;
    used.add(i);
    const scale = Math.max(Math.abs(e.tol), 1e-12);
    if (now[i].tol > e.tol && (now[i].tol - e.tol) / scale > 1e-6) {
      found.push({ kind: "tolerance-widened", detail: `TestNearlyEqual ${e.key || "(call)"} tolerance ${e.shown} -> ${now[i].shown}` });
    }
  }
  return found;
}

function cppExtras(baseText, nowText) {
  if (baseText === null || nowText === null) return [];
  return [...flagFindings(baseText, nowText), ...toleranceFindings(baseText, nowText)];
}

/** The test declarations (names, null when unnamed), assertion and skip counts of one file's text, and the line (1-based) and
 * text of each counted skip marker. A skip marker on a line holding one of rules.guards (whitespace ignored) is not counted. */
export function analyze(text, rules) {
  const lines = codeLines(text, rules.comment);
  const guards = (rules.guards ?? []).map(squeeze);
  const decls = [];
  const markers = [];
  let asserts = 0;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    for (const src of rules.test_decl) {
      const m = rx(src).exec(line);
      if (m) { decls.push(declName(m, lines, i)); break; }
    }
    asserts += count(line, rules.assert);
    const n = count(line, rules.skip);
    if (n && !guards.some((g) => squeeze(line).includes(g))) for (let k = 0; k < n; k++) markers.push({ line: i + 1, text: line.trim().slice(0, 100) });
  });
  return { decls, asserts, skips: markers.length, markers };
}

const stackOf = (rel) => STACKS.find((s) => s.ext.includes(path.posix.extname(rel).toLowerCase())) ?? null;
const rulesOf = (stack, checks) => ({ comment: stack.comment, ...Object.fromEntries(KINDS.map((k) => [k, checks[k] ?? stack[k]])) });

// The skip guards that apply to a stack's files: a blank guard, or one that holds a skip marker itself, would hide real skips.
function guardsOf(rules, stack, checks, notes) {
  return (checks.skip_guards ?? []).filter((g) => {
    const why = !squeeze(g) ? "" : count(g, rules.skip) ? ` for ${stack.name} files` : null;
    if (why === null) return true;
    const note = `adapter.checks.skip_guards ${JSON.stringify(g)} is ignored${why}: ${why ? "it holds a skip marker itself" : "it is blank"}`;
    if (!notes.includes(note)) notes.push(note);
    return false;
  });
}

// A changed file is a check file when adapter.checks.paths (or, when null, its stack's paths) match it; a Rust file whose
// base holds a test is one too (inline tests). With project paths, a file of no stack is a gate file: any change counts.
function classify(rel, checks, baseText) {
  const stack = stackOf(rel);
  if (checks.paths) return checks.paths.some((g) => matchesGlob(rel, g)) ? (stack ? { stack } : { gate: true }) : null;
  if (!stack) return null;
  if (stack.paths.some((g) => matchesGlob(rel, g))) return { stack };
  if (stack.inline && baseText !== null && rulesOf(stack, checks).test_decl.some((src) => rx(src, "m").test(baseText))) return { stack };
  return null;
}

// Kit feedback 102: a file a test runner runs, by the same paths (adapter.checks.paths, else its stack's), of a stack's extension.
export function isTestFile(rel, checks = {}) {
  const stack = stackOf(toSlash(rel));
  return Boolean(stack && (checks.paths ?? stack.paths).some((g) => matchesGlob(toSlash(rel), g)));
}

// Tracked changes since the base (deletions too, renames as delete + add) and untracked files that are not ignored.
function changedFiles(root, base, skipDir) {
  const out = new Map();
  if (base) {
    const parts = git(root, ["diff", "--name-status", "--no-renames", "-z", base, "--"]).out.split("\0").filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i += 2) out.set(toSlash(parts[i + 1]), parts[i][0]);
  }
  for (const p of git(root, ["ls-files", "-o", "--exclude-standard", "-z"]).out.split("\0").filter(Boolean)) if (!p.endsWith("/")) out.set(toSlash(p), "?");
  for (const p of [...out.keys()]) if (p.startsWith(".planning/") || p.startsWith("_workspace/") || (skipDir && (p === skipDir || p.startsWith(`${skipDir}/`)))) out.delete(p);
  return out;
}

const baseText = (root, base, rel) => {
  if (!base) return null;
  const g = git(root, ["show", `${base}:${rel}`], { allowFail: true });
  return g.code === 0 ? g.out : null;
};
const nowText = (root, rel) => {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? lf(fs.readFileSync(abs, "utf8")) : null;
};

const tally = (names) => {
  const m = new Map();
  for (const n of names) if (n !== null) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);

// The skip markers of a file now whose text the base did not have (as many times).
function added(base, now) {
  const left = tally(base.map((m) => m.text));
  return now.filter((m) => {
    if (!left.get(m.text)) return true;
    left.set(m.text, left.get(m.text) - 1);
    return false;
  });
}

// Removed tests by name: a name kept in its file is no change; a name that leaves one file and appears new in another changed
// file is a move (the two files are judged together); the rest pairs with new names of the same file (renames). What is left
// is a removed test. Assertion and skip counts are compared over each group of files joined by moves, so splitting a file
// keeps its assertions, while another plan's new tests never hide a removed one.
function weakenings(entries) {
  const parent = new Map(entries.map((e) => [e.rel, e.rel]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  const union = (a, b) => parent.set(find(a), find(b));
  for (const e of entries) {
    const b = tally(e.base?.decls ?? []);
    const n = tally(e.now?.decls ?? []);
    e.gone = new Map();
    e.added = new Map();
    for (const [name, c] of b) if (c > (n.get(name) ?? 0)) e.gone.set(name, c - (n.get(name) ?? 0));
    for (const [name, c] of n) if (c > (b.get(name) ?? 0)) e.added.set(name, c - (b.get(name) ?? 0));
    e.unnamed = (e.now?.decls ?? []).filter((x) => x === null).length - (e.base?.decls ?? []).filter((x) => x === null).length;
  }
  for (const e of entries) for (const [name, c] of e.gone) {
    let left = c;
    for (const f of entries) {
      if (f === e || !left || !f.added.get(name)) continue;
      const t = Math.min(left, f.added.get(name));
      f.added.set(name, f.added.get(name) - t);
      left -= t;
      union(e.rel, f.rel);
    }
    if (left) e.gone.set(name, left);
    else e.gone.delete(name);
  }
  const found = [];
  const groups = new Map();
  for (const e of entries) {
    e.lost = sum(e.gone) - sum(e.added) - e.unnamed;
    (groups.get(find(e.rel)) ?? groups.set(find(e.rel), []).get(find(e.rel))).push(e);
  }
  for (const group of groups.values()) {
    const total = (k) => group.reduce((n, e) => n + (e[k] ?? 0), 0);
    if (total("lost") > 0) for (const e of group.filter((x) => x.lost > 0)) {
      const names = [...e.gone.keys()];
      const what = `${e.lost} test(s) removed${names.length ? ` (${names.slice(0, 8).join(", ")}${names.length > 8 ? ", ..." : ""}${sum(e.gone) > e.lost ? "; the others renamed" : ""})` : ""}`;
      found.push({ path: e.rel, kind: e.now ? "tests-removed" : "test-file-deleted", detail: e.now ? what : `deleted: ${what}` });
    }
    const asserts = (side) => group.reduce((n, e) => n + (e[side]?.asserts ?? 0), 0);
    if (asserts("now") < asserts("base")) for (const e of group.filter((x) => (x.now?.asserts ?? 0) < (x.base?.asserts ?? 0))) {
      if (!e.now && found.some((f) => f.path === e.rel)) continue;
      found.push({ path: e.rel, kind: e.now ? "asserts-removed" : "test-file-deleted", detail: `assertions ${e.base?.asserts ?? 0} -> ${e.now?.asserts ?? 0}${e.now ? "" : " (deleted)"}` });
    }
    // A group no file of which existed at the base (new files, no test moved in from a base file) has no skips to weaken.
    const skips = (side) => group.reduce((n, e) => n + (e[side]?.skips ?? 0), 0);
    if (group.some((e) => e.base) && skips("now") > skips("base")) for (const e of group.filter((x) => (x.now?.skips ?? 0) > (x.base?.skips ?? 0))) {
      const markers = added(e.base?.markers ?? [], e.now.markers);
      const at = markers.slice(0, 5).map((m) => `line ${m.line}: ${m.text}`).join("; ");
      found.push({ path: e.rel, kind: "skips-added", detail: `skip markers ${e.base?.skips ?? 0} -> ${e.now.skips} at ${at}${markers.length > 5 ? ` and ${markers.length - 5} more` : ""}`, markers });
    }
  }
  return found;
}

// Same canonical form as harness/gsd/allow.mjs, so a reordered object is no difference.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));

// Kit feedback 103. A command argv that still contains the old argv, in order, and only adds flags from this set is stricter
// (a hang fails sooner, a failure stops the run, a reporter or a verbosity flag changes no result), so it is a note, not a
// weakening. `value` is required, optional or none. adapter.commands.non_weakening_flags on the baseline extends the set.
const STRICTNESS = new Map([
  ["--timeout", "required"], ["--test-timeout", "required"], ["--timeout-ms", "required"],
  ["--fail-fast", "none"], ["--bail", "optional"], ["--maxfail", "required"], ["--max-failures", "required"], ["--exitfirst", "none"],
  ["--reporter", "required"], ["--reporters", "required"], ["--format", "required"], ["--output", "required"], ["--output-file", "required"], ["--out", "required"],
  ["--verbose", "none"], ["--quiet", "none"], ["-v", "none"], ["-vv", "none"], ["-vvv", "none"],
]);
const SKIP_FLAGS = new Set(["--exclude", "--exclude-tags", "--exclude-tag", "--skip", "--skip-test", "--ignore", "--ignore-pattern", "--ignore-glob", "--testPathIgnorePatterns"]);
const FILTER_FLAGS = new Set(["--name", "--plain-name", "--filter", "--testNamePattern", "--test-name-pattern", "--testPathPattern", "-k"]);
const COMMAND_KEYS = new Set(["build", "test", "build_timeout_s", "test_timeout_s", "gates", "verify", "smoke_builds", "test_case_timeout_s", "test_case_timeout_arg", "non_weakening_flags"]);

const flagOf = (tok) => { const s = String(tok); const eq = s.indexOf("="); return eq === -1 ? s : s.slice(0, eq); };
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// Tokens of `extra` that are only strictness flags (and their values). Anything else is a weakening, named.
function parseAdded(extra, declared) {
  const decl = new Set(declared.filter((f) => typeof f === "string" && f.startsWith("-")));
  const shown = [];
  for (let i = 0; i < extra.length; i++) {
    const tok = String(extra[i]);
    const name = flagOf(tok);
    const inline = tok.includes("=");
    const kit = STRICTNESS.get(name);
    if (kit === undefined && !decl.has(name)) {
      if (SKIP_FLAGS.has(name)) return { ok: false, why: `added a skip/exclude flag (${name})` };
      if (FILTER_FLAGS.has(name)) return { ok: false, why: `narrowed a test filter (${name})` };
      return { ok: false, why: `added an argument (${tok})` };
    }
    const mode = kit ?? "optional";
    if (inline || mode === "none") { shown.push(inline ? tok : name); continue; }
    const next = extra[i + 1];
    const take = next !== undefined && !String(next).startsWith("-");
    if (mode === "required" && !take) return { ok: false, why: `added an argument (${tok})` };
    if (take) { shown.push(`${name} ${next}`); i++; }
    else shown.push(name);
  }
  return { ok: true, shown };
}

// The old argv kept, in order, with the tokens the new argv added around it; null when an old token was dropped or changed.
function addedAround(oldArgv, newArgv) {
  const extra = [];
  let i = 0;
  for (const tok of newArgv) {
    if (i < oldArgv.length && tok === oldArgv[i]) i++;
    else extra.push(tok);
  }
  return i === oldArgv.length ? extra : null;
}

const multisetMinus = (a, b) => {
  const left = new Map();
  for (const t of b) left.set(t, (left.get(t) ?? 0) + 1);
  const out = [];
  for (const t of a) {
    if (left.get(t)) left.set(t, left.get(t) - 1);
    else out.push(t);
  }
  return out;
};

const looksPath = (t) => typeof t === "string" && !t.startsWith("-") && (t.includes("/") || t.includes("\\") || /\.[A-Za-z0-9]+$/.test(t));
const normPath = (t) => String(t).replace(/\\/g, "/").replace(/\/+$/, "");

// One command argv against the one the baseline ran. `strict` is a note; `weak` names why it still stops.
function classifyArgv(oldArgv, newArgv, declared) {
  if (canonical(oldArgv ?? null) === canonical(newArgv ?? null)) return { kind: "same" };
  if (!Array.isArray(oldArgv) || !Array.isArray(newArgv)) {
    if (Array.isArray(oldArgv) && newArgv == null) return { kind: "weak", why: "removed the command" };
    if (oldArgv == null && Array.isArray(newArgv)) return { kind: "weak", why: "set where it was unset" };
    return { kind: "weak", why: "changed the command" };
  }
  if (oldArgv[0] !== newArgv[0]) return { kind: "weak", why: "changed the executable" };
  const extra = addedAround(oldArgv, newArgv);
  if (extra) {
    if (!extra.length) return { kind: "same" };
    const parsed = parseAdded(extra, declared);
    return parsed.ok ? { kind: "strict", shown: parsed.shown } : { kind: "weak", why: parsed.why };
  }
  const missing = multisetMinus(oldArgv, newArgv);
  const added = multisetMinus(newArgv, oldArgv);
  const skip = added.map(flagOf).find((n) => SKIP_FLAGS.has(n));
  if (skip) return { kind: "weak", why: `added a skip/exclude flag (${skip})` };
  const filter = added.map(flagOf).find((n) => FILTER_FLAGS.has(n));
  if (filter) return { kind: "weak", why: `narrowed a test filter (${filter})` };
  if (missing.length && added.length && missing.every(looksPath) && added.every(looksPath) && added.every((a) => missing.some((m) => { const A = normPath(a); const M = normPath(m); return A !== M && A.startsWith(`${M}/`); }))) {
    return { kind: "weak", why: `narrowed a test path (${missing.join(" ")} -> ${added.join(" ")})` };
  }
  if (missing.length) return { kind: "weak", why: `removed an argument (${missing.join(" ")})` };
  if (added.length) return { kind: "weak", why: `added an argument (${added.join(" ")})` };
  return { kind: "weak", why: "changed an argument" };
}

function judgeArgv(label, oldArgv, newArgv, declared, weakenings, notes) {
  const judged = classifyArgv(oldArgv, newArgv, declared);
  if (judged.kind === "weak") weakenings.push(`${label} ${judged.why}`);
  else if (judged.kind === "strict") notes.push(`${label} keeps its argv and adds strictness (${judged.shown.join(", ")}); not a weakening`);
}

// Gates pair by name (a pure reorder is a note). A verify runner and a smoke argv pair by key and by index.
function judgeSlots(oldC, newC, declared, weakenings, notes) {
  judgeArgv("adapter.commands.build", oldC.build ?? null, newC.build ?? null, declared, weakenings, notes);
  judgeArgv("adapter.commands.test", oldC.test ?? null, newC.test ?? null, declared, weakenings, notes);
  judgeArgv("adapter.commands.test_case_timeout_arg", oldC.test_case_timeout_arg ?? null, newC.test_case_timeout_arg ?? null, declared, weakenings, notes);
  for (const k of ["build_timeout_s", "test_timeout_s", "test_case_timeout_s"]) {
    if ((oldC[k] ?? null) !== (newC[k] ?? null)) weakenings.push(`adapter.commands.${k} differs`);
  }
  if (canonical(oldC.gates ?? null) !== canonical(newC.gates ?? null)) {
    if (!Array.isArray(oldC.gates) || !Array.isArray(newC.gates)) weakenings.push("adapter.commands.gates differs");
    else {
      const used = new Set();
      let reorder = false;
      const before = weakenings.length;
      oldC.gates.forEach((g, i) => {
        const at = newC.gates.findIndex((n, idx) => !used.has(idx) && n?.name === g?.name);
        if (at < 0) { weakenings.push(`adapter.commands.gates.${g?.name ?? i} removed`); return; }
        used.add(at);
        if (at !== i) reorder = true;
        judgeArgv(`adapter.commands.gates.${g?.name ?? i}`, g?.argv ?? null, newC.gates[at]?.argv ?? null, declared, weakenings, notes);
      });
      newC.gates.forEach((n, i) => { if (!used.has(i)) weakenings.push(`adapter.commands.gates.${n?.name ?? i} added`); });
      if (reorder && weakenings.length === before && used.size === oldC.gates.length && used.size === newC.gates.length) notes.push("adapter.commands.gates reordered; not a weakening");
    }
  }
  if (canonical(oldC.verify ?? null) !== canonical(newC.verify ?? null)) {
    if (!isObj(oldC.verify) || !isObj(newC.verify)) weakenings.push("adapter.commands.verify differs");
    else {
      for (const k of Object.keys(oldC.verify)) {
        if (!Object.hasOwn(newC.verify, k)) { weakenings.push(`adapter.commands.verify.${k} removed`); continue; }
        judgeArgv(`adapter.commands.verify.${k}`, oldC.verify[k]?.argv ?? null, newC.verify[k]?.argv ?? null, declared, weakenings, notes);
        if ((oldC.verify[k]?.timeout_s ?? null) !== (newC.verify[k]?.timeout_s ?? null)) weakenings.push(`adapter.commands.verify.${k} timeout_s differs`);
      }
      for (const k of Object.keys(newC.verify)) if (!Object.hasOwn(oldC.verify, k)) weakenings.push(`adapter.commands.verify.${k} added`);
    }
  }
  const oldSmoke = Array.isArray(oldC.smoke_builds) ? oldC.smoke_builds : [];
  const newSmoke = Array.isArray(newC.smoke_builds) ? newC.smoke_builds : [];
  if (canonical(oldSmoke) !== canonical(newSmoke)) {
    const n = Math.max(oldSmoke.length, newSmoke.length);
    for (let i = 0; i < n; i++) {
      if (i >= oldSmoke.length) weakenings.push(`adapter.commands.smoke_builds[${i}] added`);
      else if (i >= newSmoke.length) weakenings.push(`adapter.commands.smoke_builds[${i}] removed`);
      else judgeArgv(`adapter.commands.smoke_builds[${i}]`, oldSmoke[i], newSmoke[i], declared, weakenings, notes);
    }
  }
  for (const k of [...new Set([...Object.keys(oldC), ...Object.keys(newC)])].sort()) {
    if (COMMAND_KEYS.has(k)) continue;
    if (canonical(oldC[k] ?? null) !== canonical(newC[k] ?? null)) weakenings.push(`adapter.commands.${k} differs`);
  }
}

/** How a gate-configuration object changed since the baseline one. verify_vocabulary and checks are never reclassified;
 * a command argv is a note only when it kept the old argv and added strictness flags. An empty weakening with no note
 * means the difference was not recognised (the caller stops, fail closed). */
export function judgeGateConfig(was, now) {
  const weakenings = [];
  const notes = [];
  const oldC = isObj(was?.commands) ? was.commands : {};
  const newC = isObj(now?.commands) ? now.commands : {};
  if (!isObj(was?.commands) || !isObj(now?.commands)) weakenings.push("adapter.commands differs");
  else {
    const oldFlags = Array.isArray(oldC.non_weakening_flags) ? oldC.non_weakening_flags : [];
    const newFlags = Array.isArray(newC.non_weakening_flags) ? newC.non_weakening_flags : [];
    if (canonical(oldFlags) !== canonical(newFlags)) notes.push("adapter.commands.non_weakening_flags changed; a flag newly named there does not cover a command change in the same comparison");
    judgeSlots(oldC, newC, oldFlags, weakenings, notes);
  }
  if (canonical(was?.verify_vocabulary ?? null) !== canonical(now?.verify_vocabulary ?? null)) weakenings.push("adapter.verify_vocabulary differs");
  if (canonical(was?.checks ?? null) !== canonical(now?.checks ?? null)) weakenings.push("adapter.checks differs");
  return { weakenings, notes };
}

// The object whose hash the baseline recorded: the stored body when it still hashes to gateConfig, else the overlay of
// the baseline commit merged with the current kit defaults when that merge does. A dirty overlay an older kit recorded
// only as a hash cannot be classified.
function priorBody(root, baseline, wasHash) {
  const stored = baseline?.gateConfigBody;
  if (isObj(stored) && gateConfigHash({ adapter: stored }) === wasHash) return stored;
  const rev = typeof baseline?.head === "string" ? baseline.head : null;
  if (!rev) return null;
  const at = git(root, ["show", `${rev}:${OVERLAY_REL}`], { allowFail: true });
  if (at.code !== 0) return null;
  try {
    const merged = gateConfig(mergeOverlay(loadKitConfig(), JSON.parse(at.out)));
    return gateConfigHash({ adapter: merged }) === wasHash ? merged : null;
  } catch {
    return null;
  }
}

// The gate configuration against the hash execute-baseline.json recorded before the phase's first agent; a baseline without one
// (written by an older kit) and the debug flow compare with the overlay of the base commit, merged with the current kit defaults.
// Kit feedback 103: a difference is classified per command. An argv that only adds strictness flags is a note; a removed
// argument, a narrowed filter or path, an added skip, a changed executable, and any verify_vocabulary or checks change, stop.
function configChange(root, dir, cfg, base, baseline, notes) {
  const nowBody = gateConfig(cfg);
  const now = gateConfigHash(cfg);
  let wasHash = typeof baseline?.gateConfig === "string" ? baseline.gateConfig : null;
  let wasBody = null;
  let source = "the phase baseline (execute-baseline.json)";
  if (wasHash) wasBody = priorBody(root, baseline, wasHash);
  else {
    const at = base ? git(root, ["show", `${base}:${OVERLAY_REL}`], { allowFail: true }) : { code: 1 };
    if (at.code !== 0 && fs.existsSync(path.join(root, OVERLAY_REL))) {
      notes.push(`gate configuration not compared: ${OVERLAY_REL} is not in the base commit and the phase baseline records no gateConfig`);
      return null;
    }
    try {
      wasBody = gateConfig(mergeOverlay(loadKitConfig(), at.code === 0 ? JSON.parse(at.out) : {}));
      wasHash = gateConfigHash({ adapter: wasBody });
    } catch (e) {
      notes.push(`gate configuration not compared: ${OVERLAY_REL} of the base does not load (${e.message})`);
      return null;
    }
    source = `${OVERLAY_REL} at ${base.slice(0, 7)}`;
  }
  if (wasHash === now) return null;
  const stop = (detail) => ({ path: OVERLAY_REL, kind: "config-changed", detail, config: now });
  if (!wasBody) return stop(`adapter.commands, adapter.verify_vocabulary or adapter.checks differ from ${source}`);
  const judged = judgeGateConfig(wasBody, nowBody);
  for (const n of judged.notes) notes.push(n);
  if (!judged.weakenings.length) {
    if (judged.notes.length) return null;
    return stop(`adapter.commands, adapter.verify_vocabulary or adapter.checks differ from ${source}`);
  }
  return stop(`${judged.weakenings.join("; ")}; differ from ${source}`);
}

// What may weaken: <check_changes> lines of the phase's plans, and the owner's `allow` answers of the phase.
function permits(dir) {
  const declared = new Map();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => /-PLAN\.md$/i.test(x)).sort()) {
    for (const c of checkChanges(fs.readFileSync(path.join(dir, f), "utf8"))) if (c.path && c.reason.trim() && !declared.has(key(c.path))) declared.set(key(c.path), { by: "plan", plan: f.replace(/-PLAN\.md$/i, ""), reason: c.reason.trim() });
  }
  const answers = readAnswers(path.join(dir, OWNER_ANSWERS_FILE)).answers.filter((x) => x.kind === "allow" && typeof x.path === "string");
  return { declared, answers };
}

/** check-weakening: {status: ok|weakened|off, base, compared, weakened, allowed, notes}; exit 1 when a weakening stands. */
export function checkWeakening(root, phaseDir, { base = "HEAD", files } = {}) {
  const cfg = loadConfig(root);
  const checks = { enabled: true, paths: null, test_decl: null, assert: null, skip: null, ...(cfg.adapter.checks ?? {}) };
  const dir = resolveInside(root, phaseDir);
  const notes = [];
  const rev = git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { allowFail: true });
  const baseSha = rev.code === 0 ? rev.out.trim() : null;
  if (!baseSha) notes.push(`no base commit ${base}: every file counts as new`);
  let baseline = null;
  try { baseline = readJsonIf(path.join(dir, "execute-baseline.json"), null); } catch { baseline = null; }
  const found = [];
  const cc = configChange(root, dir, cfg, baseSha, baseline, notes);
  if (cc) found.push(cc);
  const compared = [];
  if (checks.enabled === false) notes.push("adapter.checks.enabled is false: test and gate files are not compared");
  else {
    // A file the owner changed before the phase began (dirty in the baseline, same content now) is not this phase's change.
    const before = new Map((baseline?.dirty ?? []).map((d) => [d.path, d.sha256]));
    const only = files ? new Set(files.map((f) => key(toSlash(f).replace(/^\.\//, "")))) : null;
    const entries = [];
    for (const [rel, code] of changedFiles(root, baseSha, cfg.worktree_dir)) {
      if (only && !only.has(key(rel))) continue;
      if (before.has(rel) && before.get(rel) === contentHash(path.join(root, rel))) continue;
      const was = code === "A" || code === "?" ? null : baseText(root, baseSha, rel);
      const kind = classify(rel, checks, was);
      if (!kind) continue;
      compared.push(rel);
      const now = nowText(root, rel);
      if (kind.gate) {
        if (was !== null && (now === null || lf(was) !== now)) found.push({ path: rel, kind: "gate-file-changed", detail: now === null ? "gate file deleted" : "gate file changed" });
        continue;
      }
      const rules = rulesOf(kind.stack, checks);
      rules.guards = guardsOf(rules, kind.stack, checks, notes);
      const entry = { rel, base: was === null ? null : analyze(was, rules), now: now === null ? null : analyze(now, rules) };
      if (kind.stack.extra && was !== null && now !== null) entry.extra = kind.stack.extra(was, now);
      entries.push(entry);
    }
    found.push(...weakenings(entries));
    for (const e of entries) for (const x of e.extra ?? []) found.push({ path: e.rel, ...x });
  }
  const { declared, answers } = permits(dir);
  const weakened = [];
  const allowed = [];
  for (const w of found) {
    const answer = answers.find((a) => key(a.path) === key(w.path) && (w.kind !== "config-changed" || a.config === w.config));
    const plan = w.kind === "config-changed" ? null : declared.get(key(w.path));
    if (plan) allowed.push({ ...w, ...plan });
    else if (answer) allowed.push({ ...w, by: "owner", answer: answer.id, reason: answer.reason });
    else {
      if (w.kind === "config-changed" && answers.some((a) => key(a.path) === key(OVERLAY_REL))) notes.push(`the owner's allow of ${OVERLAY_REL} was for another gate configuration`);
      weakened.push(w);
    }
  }
  const status = weakened.length ? "weakened" : checks.enabled === false ? "off" : "ok";
  return { status, base: baseSha, compared, weakened, allowed, notes, ...(weakened.length ? { code: 1 } : {}) };
}

// The phase a gate's directory answers to in `ph gsd allow`: its number, `debug`, or the directory itself.
export function allowRef(phaseDir) {
  const p = toSlash(phaseDir).replace(/\/+$/, "");
  if (p === DEBUG_DIR) return "debug";
  const m = /^(\d+(?:\.\d+)*)-/.exec(path.posix.basename(p));
  return m ? m[1].replace(/^0+(?=\d)/, "") : p;
}

/** The needs-owner answer of a weakening: stage Checks, one allow command per path. */
export function checksStop(phaseDir, weakened) {
  const ref = allowRef(phaseDir);
  const paths = [...new Set(weakened.map((w) => w.path))];
  return {
    stage: "Checks",
    reason: `checks weakened without a <check_changes> declaration or an owner allow: ${weakened.map((w) => `${w.path} (${w.kind}: ${w.detail})`).join("; ")}`,
    options: [
      ...paths.map((p) => `ph gsd allow ${ref} --path ${/\s/.test(p) ? JSON.stringify(p) : p} --reason "<why this is no weakening, or why it is accepted>", then rerun with the same args`),
      "restore the tests, assertions, skip markers, flags, tolerances or gate settings, then rerun with the same args",
      "declare the change in the plan's <check_changes> block (`<path>: <reason>`), have the plan reviewed, then rerun with the same args",
    ],
  };
}
