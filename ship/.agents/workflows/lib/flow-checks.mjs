// Kit feedback 87 C1: checks may not be weakened silently. `check-weakening <phaseDir>` {base?, files?} compares the test and gate
// files changed since the base (HEAD by default) with their base content and reports a deleted test file, removed tests, fewer
// assertions, added skip markers, a changed gate file, and a gate configuration (adapter.commands, verify_vocabulary, checks)
// that differs from the hash the phase baseline recorded. A weakening stands only when a plan of the phase declares its path in
// a <check_changes> block or the owner answered `ph gsd allow`. flow-gate.mjs runs it in every gate, so no composition skips it.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadKitConfig, mergeOverlay, OVERLAY_REL } from "../../harness/config.mjs";
import { matchesGlob } from "../../harness/adapter/contract.mjs";
import { DEBUG_DIR, gateConfigHash } from "../../harness/gsd/allow.mjs";
import { checkChanges } from "../../harness/gsd/planning.mjs";
import { readJsonIf } from "../../harness/lib/io.mjs";
import { OWNER_ANSWERS_FILE, readAnswers } from "../../harness/lib/owner-answers.mjs";
import { resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { git } from "./flow-git.mjs";
import { contentHash } from "./flow-owns.mjs";

const r = String.raw;
// The stack defaults: which files are tests (paths are matched only for the stack's extensions) and the regexes of a test
// declaration (group 1, else the first string literal after it, else the function under an attribute line, is its name), an
// assertion and a skip marker. Comment lines never count, so a commented-out assertion is a removed one.
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

/** The test declarations (names, null when unnamed), assertion and skip counts of one file's text. */
export function analyze(text, rules) {
  const lines = codeLines(text, rules.comment);
  const decls = [];
  let asserts = 0;
  let skips = 0;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    for (const src of rules.test_decl) {
      const m = rx(src).exec(line);
      if (m) { decls.push(declName(m, lines, i)); break; }
    }
    asserts += count(line, rules.assert);
    skips += count(line, rules.skip);
  });
  return { decls, asserts, skips };
}

const stackOf = (rel) => STACKS.find((s) => s.ext.includes(path.posix.extname(rel).toLowerCase())) ?? null;
const rulesOf = (stack, checks) => ({ comment: stack.comment, ...Object.fromEntries(KINDS.map((k) => [k, checks[k] ?? stack[k]])) });

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
    const skips = (side) => group.reduce((n, e) => n + (e[side]?.skips ?? 0), 0);
    if (skips("now") > skips("base")) for (const e of group.filter((x) => (x.now?.skips ?? 0) > (x.base?.skips ?? 0))) found.push({ path: e.rel, kind: "skips-added", detail: `skip markers ${e.base?.skips ?? 0} -> ${e.now.skips}` });
  }
  return found;
}

// The gate configuration against the hash execute-baseline.json recorded before the phase's first agent; a baseline without one
// (written by an older kit) and the debug flow compare with the overlay of the base commit, merged with the current kit defaults.
function configChange(root, dir, cfg, base, baseline, notes) {
  const now = gateConfigHash(cfg);
  let was = typeof baseline?.gateConfig === "string" ? baseline.gateConfig : null;
  let source = "the phase baseline (execute-baseline.json)";
  if (!was) {
    const at = base ? git(root, ["show", `${base}:${OVERLAY_REL}`], { allowFail: true }) : { code: 1 };
    if (at.code !== 0 && fs.existsSync(path.join(root, OVERLAY_REL))) {
      notes.push(`gate configuration not compared: ${OVERLAY_REL} is not in the base commit and the phase baseline records no gateConfig`);
      return null;
    }
    try {
      was = gateConfigHash(mergeOverlay(loadKitConfig(), at.code === 0 ? JSON.parse(at.out) : {}));
    } catch (e) {
      notes.push(`gate configuration not compared: ${OVERLAY_REL} of the base does not load (${e.message})`);
      return null;
    }
    source = `${OVERLAY_REL} at ${base.slice(0, 7)}`;
  }
  return was === now ? null : { path: OVERLAY_REL, kind: "config-changed", detail: `adapter.commands, adapter.verify_vocabulary or adapter.checks differ from ${source}`, config: now };
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
      entries.push({ rel, base: was === null ? null : analyze(was, rules), now: now === null ? null : analyze(now, rules) });
    }
    found.push(...weakenings(entries));
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
      "restore the tests, assertions, skip markers or gate settings, then rerun with the same args",
      "declare the change in the plan's <check_changes> block (`<path>: <reason>`), have the plan reviewed, then rerun with the same args",
    ],
  };
}
