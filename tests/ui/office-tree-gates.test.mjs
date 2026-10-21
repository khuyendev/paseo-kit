// Tree-wide gates of the office plugin (07-12): module coverage (OFFC-22), JSX literals and string keys (OFFC-19), agent values
// in uri, source and style expressions (OFFC-14), and timers (OFFC-05). Each checker is first shown to fail on a fixture;
// the `tree` tests then apply it to the real files and need the finished tree.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { STRINGS } from "../../plugins/office/client/strings.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const OFFICE = path.join(KIT_DIR, "plugins", "office");

function loadTypescript() {
  try {
    return createRequire(path.join(OFFICE, "package.json"))("typescript");
  } catch {
    throw new Error("typescript is not installed in plugins/office: run npm ci --ignore-scripts there");
  }
}
const ts = loadTypescript();

const normalise = (text) => text.replace(/\r\n/g, "\n");
const posix = (file) => file.replace(/\\/g, "/");
// Full-line comments only; a block comment marker inside a string must not hide code.
const stripComments = (text) => normalise(text).replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, "");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...walk(full));
    } else if (entry.isFile()) out.push(full);
  }
  return out;
}

// [path relative to plugins/office with /, text] for the files of the given folders (and root files) matching the extension.
function officeFiles(folders, extension, roots = []) {
  const files = roots.map((f) => path.join(OFFICE, f)).filter((f) => fs.existsSync(f));
  for (const folder of folders) {
    const dir = path.join(OFFICE, folder);
    if (fs.existsSync(dir)) files.push(...walk(dir));
  }
  return files
    .filter((f) => extension.test(f) && !/\.d\.ts$/.test(f))
    .map((f) => [posix(path.relative(OFFICE, f)), normalise(fs.readFileSync(f, "utf8"))]);
}

// ---- OFFC-22: module coverage -----------------------------------------------------------------------------------------
function runtimeExports(text) {
  const code = stripComments(text);
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s+enum\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",").map((p) => p.trim()).filter(Boolean)) {
      if (!part.startsWith("type ")) names.add(part.split(/\s+as\s+/).pop().trim());
    }
  }
  if (/^export\s+default\b/m.test(code)) names.add("default");
  return [...names];
}

// A module bound to the host: a non-type import of react, react-native or a client module of @getpaseo/plugin.
function isHostBound(text) {
  const code = stripComments(text);
  for (const m of code.matchAll(/^import\s+(?!type\b)([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const clause = m[1].trim();
    const braces = /^\{([^}]*)\}$/.exec(clause);
    if (braces && braces[1].split(",").map((p) => p.trim()).filter(Boolean).every((p) => p.startsWith("type "))) continue;
    if (m[2] === "react" || m[2] === "react-native" || m[2].startsWith("@getpaseo/plugin/client")) return true;
  }
  return false;
}

// modules: [path relative to plugins/office, text]; testTexts: the texts of the office tests.
// A test reaches a module by its literal path or through the office tests' loader: load("server", "art", "x.ts").
function loaderPattern(rel) {
  const parts = posix(rel).split("/").map((p) => `"${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  return new RegExp(`\\bload\\(\\s*${parts.join("\\s*,\\s*")}\\s*\\)`);
}

// Relative specifiers a module imports, resolved to paths relative to plugins/office.
function relativeImports(rel, text) {
  const dir = path.posix.dirname(posix(rel));
  return [...stripComments(text).matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)].map((m) => path.posix.normalize(path.posix.join(dir, m[1])));
}

function coverageProblems(modules, testTexts) {
  const problems = [];
  const tests = testTexts.map(normalise);
  const direct = new Map();
  for (const [rel] of modules) {
    const needle = `plugins/office/${posix(rel)}`;
    const loader = loaderPattern(rel);
    direct.set(posix(rel), { needle, loader, importing: tests.filter((t) => t.includes(needle) || loader.test(t)) });
  }
  // A module no test names is covered when a covered module imports it: the test of the importer runs it.
  const reached = new Set([...direct].filter(([, d]) => d.importing.length > 0).map(([rel]) => rel));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [rel, text] of modules) {
      if (!reached.has(posix(rel))) continue;
      for (const dep of relativeImports(rel, text)) {
        if (direct.has(dep) && !reached.has(dep)) {
          reached.add(dep);
          grew = true;
        }
      }
    }
  }
  for (const [rel, text] of modules) {
    if (!/\.ts$/.test(rel) || /\.d\.ts$/.test(rel)) continue;
    const exported = runtimeExports(text);
    if (exported.length === 0 || isHostBound(text)) continue;
    const { needle, loader, importing } = direct.get(posix(rel));
    if (importing.length === 0) {
      if (!reached.has(posix(rel))) problems.push(`${rel}: not imported by literal path in an office test`);
      continue;
    }
    const names = exported.filter((n) => n !== "default");
    if (names.length === 0) continue;
    const used = importing.some((t) => {
      const body = t.split("\n").filter((line) => !line.includes(needle) && !loader.test(line)).join("\n");
      return names.some((n) => new RegExp(`(?<![\\w$])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(body));
    });
    if (!used) problems.push(`${rel}: imported, but none of ${names.join(", ")} is used in the test`);
  }
  return problems;
}

test("OFFC-22 checker: a pure module no test imports, or whose exports no test uses, is reported", () => {
  const pure = ["export function alpha() { return 1; }", "export const BETA = 2;"].join("\n");
  const importLine = 'import { alpha } from "../../plugins/office/client/pure.ts";';
  assert.deepEqual(runtimeExports('export function a() {}\nexport async function b() {}\nexport class C {}\nexport const D = 1;\nexport { e, type F, g as H };\nexport type T = 1;\nexport interface I {}\nexport default 1;').sort(), ["C", "D", "H", "a", "b", "default", "e"]);
  assert.deepEqual(coverageProblems([["client/pure.ts", pure]], ["// nothing"]), ["client/pure.ts: not imported by literal path in an office test"]);
  assert.equal(coverageProblems([["client/pure.ts", pure]], [importLine]).length, 1, "the import line alone is not a use");
  assert.deepEqual(coverageProblems([["client/pure.ts", pure]], [`${importLine}\nassert.equal(alpha(), 1);`]), []);
  assert.deepEqual(coverageProblems([["client\\pure.ts", pure]], [`${importLine}\nalpha();`]), [], "backslashes in the module path");
  assert.deepEqual(coverageProblems([["client/types.ts", "export type A = string;\nexport interface B {}"]], []), [], "a type-only module is skipped");
  assert.deepEqual(coverageProblems([["client/view.tsx", pure]], []), [], "a .tsx module is left to the host mount");
  assert.deepEqual(coverageProblems([["client/host.ts", `import { View } from "react-native";\n${pure}`]], []), [], "a host-bound module is skipped");
  assert.deepEqual(coverageProblems([["client/host.ts", `import { useQuery } from "@getpaseo/plugin/client";\n${pure}`]], []), []);
  assert.equal(coverageProblems([["client/typed.ts", `import type { View } from "react-native";\nimport { type Props } from "react";\n${pure}`]], []).length, 1, "type-only imports do not bind to the host");
  assert.deepEqual(coverageProblems([["client/def.ts", "export default function make() {}"]], ['import make from "../../plugins/office/client/def.ts";']), [], "a default-only module needs the import only");
  assert.equal(isHostBound('import React from "react";'), true);
  assert.equal(isHostBound('import { x } from "./local.ts";'), false);
});

// ---- OFFC-19: no user-visible literal in JSX, every string key exists -------------------------------------------------
const LABEL_ATTRIBUTES = new Set(["accessibilityLabel", "title", "placeholder", "alt", "aria-label"]);

function jsxLiteralProblems(text, fileName = "x.tsx") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  const report = (node, what) => problems.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${what}`);
  const isLiteral = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);
  const visit = (node) => {
    if (ts.isJsxText(node) && node.text.trim() !== "") report(node, `JSX text literal "${node.text.trim().slice(0, 30)}"`);
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && isLiteral(node.expression)) {
      report(node, "string literal as a JSX child");
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const init = node.initializer;
      if (LABEL_ATTRIBUTES.has(name) && init && (ts.isStringLiteral(init) || (ts.isJsxExpression(init) && init.expression && isLiteral(init.expression)))) {
        report(node, `string-literal ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

// files: [name, text]; keys: the keys of STRINGS.
function keyProblems(files, keys) {
  const known = new Set(keys);
  const problems = [];
  for (const [name, text] of files) {
    const code = stripComments(text);
    for (const m of code.matchAll(/\bSTRINGS\.([A-Za-z_$][\w$]*)/g)) if (!known.has(m[1])) problems.push(`${name}: STRINGS.${m[1]} is not a key`);
    for (const m of code.matchAll(/\btext\(\s*["']([^"']+)["']/g)) if (!known.has(m[1])) problems.push(`${name}: text("${m[1]}") is not a key`);
  }
  return problems;
}

test("OFFC-19 checker: JSX literals and string-literal labels are reported, text(key) children are not", () => {
  const wrap = (body) => `export const A = () => (${body});`;
  assert.equal(jsxLiteralProblems(wrap("<Text>Hello</Text>")).length, 1);
  assert.equal(jsxLiteralProblems(wrap('<Text>{"Hello"}</Text>')).length, 1);
  assert.equal(jsxLiteralProblems(wrap("<Text>{`Hello`}</Text>")).length, 1);
  assert.equal(jsxLiteralProblems(wrap("<Text>{`Hello ${name}`}</Text>")).length, 1);
  assert.equal(jsxLiteralProblems(wrap('<View accessibilityLabel="Close" />')).length, 1);
  assert.equal(jsxLiteralProblems(wrap('<View title={"Close"} />')).length, 1);
  assert.equal(jsxLiteralProblems(wrap('<Image alt="x" />')).length, 1);
  assert.deepEqual(jsxLiteralProblems(wrap('<Text>{text("sidebarTitle")}</Text>')), []);
  assert.deepEqual(jsxLiteralProblems(wrap("<View accessibilityLabel={label} testID={id}><Text>{a}</Text>\n  </View>")), []);
  assert.deepEqual(jsxLiteralProblems(wrap('<View testID="root" style={{ left: 1 }} />')), []);
});

test("OFFC-19 checker: unknown STRINGS keys and unknown text(\"key\") calls are reported", () => {
  const keys = ["sidebarTitle", "statusIdle"];
  assert.deepEqual(keyProblems([["a.tsx", "const t = STRINGS.sidebarTitle + text('statusIdle');"]], keys), []);
  assert.deepEqual(keyProblems([["a.tsx", "STRINGS.nope"]], keys), ["a.tsx: STRINGS.nope is not a key"]);
  assert.deepEqual(keyProblems([["b.ts", 'text("missing", { count: 1 })']], keys), ['b.ts: text("missing") is not a key']);
  assert.deepEqual(keyProblems([["c.ts", "// STRINGS.nope in a comment\ntext(key)"]], keys), []);
});

// ---- OFFC-14: no agent-provided value in a uri, source or style expression --------------------------------------------
const AGENT_STRING_FIELDS = new Set(["title", "label", "labels", "displayName", "projectDisplayName", "lastError", "cwd", "branch", "provider", "model", "name", "message"]);
const AGENT_TEXT_ROOTS = new Set(["agent", "child", "todo", "item", "entry", "row", "node", "drawn", "ws", "workspace", "project"]);
const THEME_ROOTS = new Set(["styles", "style", "colors", "theme", "c", "palette", "layout", "STRINGS"]);
const REGION_ATTRIBUTES = new Set(["source", "uri", "src", "style"]);

function uriStyleProblems(text, fileName = "x.tsx") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  const seen = new Set();
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const isAccess = (n) => ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n);
  const leafOf = (n) => (ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : null);
  const rootOf = (n) => {
    let e = n;
    while (isAccess(e) || ts.isCallExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isIdentifier(e) ? e.text : null;
  };
  const check = (region, chain) => {
    const leaf = leafOf(chain);
    if (leaf === null) return;
    const root = rootOf(chain);
    if (root !== null && THEME_ROOTS.has(root)) return;
    const key = `${chain.getStart(source)}`;
    if (seen.has(key)) return;
    if (AGENT_STRING_FIELDS.has(leaf) || (leaf === "text" && root !== null && AGENT_TEXT_ROOTS.has(root))) {
      seen.add(key);
      problems.push(`${fileName}:${lineOf(chain)}: ${chain.getText(source)} (an agent-provided value) is read in ${region}`);
    }
  };
  const scan = (region, node) => {
    const visit = (n) => {
      if (isAccess(n)) {
        const p = n.parent;
        const innerObject = isAccess(p) && p.expression === n;
        if (!innerObject) {
          // A method call on a chain reads the chain before the method name: agent.title.trim() reads agent.title.
          if (ts.isCallExpression(p) && p.expression === n && isAccess(n.expression)) check(region, n.expression);
          else if (!(ts.isCallExpression(p) && p.expression === n)) check(region, n);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };
  const visitAll = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "uri") scan("a uri", node.initializer);
    if (ts.isJsxAttribute(node) && REGION_ATTRIBUTES.has(node.name.getText(source)) && node.initializer) scan(`the ${node.name.getText(source)} attribute`, node.initializer);
    ts.forEachChild(node, visitAll);
  };
  visitAll(source);
  return problems;
}

test("OFFC-14 checker: agent values in uri, source and style are reported; theme colours, layout numbers and lookup keys are not", () => {
  const wrap = (body) => `export const A = () => (${body});`;
  const bad = [
    "<View style={{ color: node.label }} />",
    "<Image source={{ uri: `/sprites/${agent.title}.png` }} />",
    "<View style={{ width: row.text }} />",
    "<Image source={{ uri: spriteUri(agent.model) }} />",
    "<View style={{ color: agent.title.trim() }} />",
    '<View style={{ color: agent["title"] }} />',
  ];
  for (const body of bad) assert.equal(uriStyleProblems(wrap(body)).length, 1, body);
  assert.equal(uriStyleProblems("export const f = (agent) => ({ uri: agent.cwd });").length, 1, "a uri property outside JSX");
  const good = [
    "<Image source={{ uri: sprite.uri }} />",
    "<View style={{ width: `${model.percent}%` }} />",
    "<Text style={{ color: colors.text }} />",
    "<Text style={styles.title} />",
    "<View style={{ left: model.x }} />",
    "<View style={{ left: positions[agent.id] }} />",
    "<View style={{ color: theme.colors.name }} />",
    "<Text>{agent.title}</Text>",
  ];
  for (const body of good) assert.deepEqual(uriStyleProblems(wrap(body)), [], body);
});

// ---- OFFC-05: no client interval polls the daemon, no server file starts a timer --------------------------------------
const DAEMON_CALL = /\busePaseo\b|\.agents\.|\.workspaces\.|\.projects\.|\bobserveEvents\s*\(|\bwaveRpc\b/;

function intervalDaemonProblems(text, fileName = "x.tsx") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  const locals = new Map();
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) locals.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) locals.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const callsDaemon = (fn, visited = new Set()) => {
    if (visited.has(fn)) return false;
    visited.add(fn);
    if (DAEMON_CALL.test(fn.getText(source))) return true;
    let found = false;
    const walk = (n) => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && locals.has(n.expression.text) && callsDaemon(locals.get(n.expression.text), visited)) found = true;
      else ts.forEachChild(n, walk);
    };
    walk(fn);
    return found;
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isInterval = (ts.isIdentifier(callee) && callee.text === "setInterval") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "setInterval");
      const arg = node.arguments[0];
      if (isInterval && arg) {
        const fn = ts.isArrowFunction(arg) || ts.isFunctionExpression(arg) ? arg : ts.isIdentifier(arg) ? locals.get(arg.text) : undefined;
        if (fn && callsDaemon(fn)) problems.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: an interval callback calls the daemon`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

// files: [relative path, text] of the server files and index.server.ts.
function timerProblems(files) {
  const problems = [];
  for (const [file, text] of files) {
    for (const m of stripComments(text).matchAll(/\b(setInterval|setTimeout)\s*\(/g)) problems.push(`${posix(file)}: ${m[1]} in a server file`);
  }
  return problems;
}

test("OFFC-05 checker: an interval callback that calls the daemon and a server timer are reported", () => {
  assert.equal(intervalDaemonProblems("setInterval(() => { paseo.agents.list({}); }, 1000);").length, 1);
  assert.equal(intervalDaemonProblems("const refreshAll = () => paseo.agents.list({});\nsetInterval(() => refreshAll(), 1000);").length, 1, "through a local function");
  assert.equal(intervalDaemonProblems("function refreshAll() { return paseo.workspaces.list(); }\nsetInterval(refreshAll, 1000);").length, 1, "a local function as the callback");
  assert.equal(intervalDaemonProblems("window.setInterval(() => observeEvents(handler), 500);").length, 1);
  assert.deepEqual(intervalDaemonProblems("setInterval(() => setNow(Date.now()), 1000);"), [], "a clock tick that only changes state");
  assert.deepEqual(intervalDaemonProblems("const tick = (fn, ms) => setInterval(fn, ms);"), [], "a callback that is a function parameter");
  assert.deepEqual(intervalDaemonProblems("function start(fn) { return setInterval(fn, 10); }"), []);
  assert.equal(timerProblems([["server/a.ts", "const t = setInterval(() => {}, 1);"]]).length, 1);
  assert.equal(timerProblems([["index.server.ts", "setTimeout(() => {}, 1);"]]).length, 1);
  assert.deepEqual(timerProblems([["server/b.ts", "// setInterval in a comment\nexport const a = 1;"]]), []);
});

// ---- the real tree (run once 07-11 has landed) ------------------------------------------------------------------------
const CLIENT_ROOTS = ["index.client.tsx"];
const SERVER_ROOTS = ["index.server.ts"];

test("OFFC-22 tree: every pure runtime .ts module of office is imported and exercised by an office test", () => {
  const modules = officeFiles(["client", "server", "shared"], /\.ts$/, SERVER_ROOTS);
  assert.ok(modules.length > 20, `only ${modules.length} modules found`);
  const testDir = path.join(KIT_DIR, "tests", "ui");
  const tests = fs.readdirSync(testDir).filter((f) => /^office-.*\.test\.mjs$/.test(f) && f !== "office-tree-gates.test.mjs").map((f) => fs.readFileSync(path.join(testDir, f), "utf8"));
  assert.ok(tests.length > 5, "the office tests are missing");
  assert.deepEqual(coverageProblems(modules, tests), []);
});

test("OFFC-19 tree: no JSX text literal outside client/strings.ts", () => {
  const files = officeFiles(["client"], /\.tsx$/, CLIENT_ROOTS);
  assert.ok(files.length > 3, `only ${files.length} .tsx files found`);
  assert.deepEqual(files.flatMap(([rel, text]) => jsxLiteralProblems(text, rel)), []);
});

test("OFFC-19 tree: every STRINGS key used in the client exists", () => {
  const files = officeFiles(["client"], /\.tsx?$/, CLIENT_ROOTS).filter(([rel]) => rel !== "client/strings.ts");
  assert.ok(files.length > 10, `only ${files.length} client files found`);
  assert.ok(Object.keys(STRINGS).length > 20);
  assert.deepEqual(keyProblems(files, Object.keys(STRINGS)), []);
});

test("OFFC-14 tree: no agent-provided value in a uri, source or style expression", () => {
  const files = officeFiles(["client"], /\.tsx?$/, CLIENT_ROOTS);
  assert.ok(files.length > 10, `only ${files.length} client files found`);
  assert.deepEqual(files.flatMap(([rel, text]) => uriStyleProblems(text, rel)), []);
});

test("OFFC-05 tree: no client interval polls the daemon and no server file starts a timer", () => {
  const client = officeFiles(["client"], /\.tsx?$/, CLIENT_ROOTS);
  const server = officeFiles(["server"], /\.ts$/, SERVER_ROOTS);
  assert.ok(client.length > 10 && server.length > 5, `${client.length} client and ${server.length} server files found`);
  assert.deepEqual(client.flatMap(([rel, text]) => intervalDaemonProblems(text, rel)), []);
  assert.deepEqual(timerProblems(server), []);
});
