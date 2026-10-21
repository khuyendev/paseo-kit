import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { TESTED_PASEO_CLI } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const PLUGINS = path.join(KIT_DIR, "plugins");
const IDS = ["planning-panel", "office"];
const SOURCE_DIRS = ["client", "server", "shared"];
// Paseo version each plugin is pinned to (manifest requirement and @getpaseo/plugin): office targets the 0.12.0 daemon, which
// refuses a 0.11.2 plugin; planning-panel stays on the tested CLI version.
const PASEO_PIN = { "planning-panel": TESTED_PASEO_CLI, office: "0.12.0" };

function sources(id, dirs = SOURCE_DIRS) {
  const root = path.join(PLUGINS, id);
  const files = ["index.client.tsx", "index.server.ts"].map((f) => path.join(root, f));
  for (const d of dirs) for (const f of fs.readdirSync(path.join(root, d), { recursive: true })) files.push(path.join(root, d, String(f)));
  return files.filter((f) => fs.statSync(f).isFile()).map((f) => [path.relative(PLUGINS, f), fs.readFileSync(f, "utf8")]);
}

test("PANL-01 manifests: id = directory, tested Paseo version, files exist, pinned toolchain, strict noEmit", () => {
  for (const id of IDS) {
    const dir = path.join(PLUGINS, id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "paseo-plugin.json"), "utf8"));
    assert.equal(manifest.id, id);
    assert.ok(manifest.description);
    assert.equal(manifest.requirements.paseo, PASEO_PIN[id], `${id}: requirements.paseo`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const f of pkg.files) assert.ok(fs.existsSync(path.join(dir, f)), `${id}: files entry ${f} missing`);
    for (const dep of ["@getpaseo/plugin", "react", "react-native", "@tanstack/react-query", "zod", "typescript", "@types/node"]) assert.ok(pkg.devDependencies[dep], `${id}: ${dep}`);
    assert.equal(pkg.devDependencies["@getpaseo/plugin"], PASEO_PIN[id], `${id}: @getpaseo/plugin pin`);
    const ts = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8")).compilerOptions;
    assert.deepEqual([ts.strict, ts.noEmit], [true, true]);
    assert.ok(fs.existsSync(path.join(dir, "package-lock.json")), `${id}: package-lock.json for npm ci`);
  }
  assert.match(fs.readFileSync(path.join(PLUGINS, ".gitignore"), "utf8"), /^node_modules\/$/m);
});

test("PANL-01 tsc --noEmit passes in both plugins", { timeout: 300_000 }, () => {
  for (const id of IDS) {
    const dir = path.join(PLUGINS, id);
    const tsc = path.join(dir, "node_modules", "typescript", "bin", "tsc");
    assert.ok(fs.existsSync(tsc), `${id}: run npm install --ignore-scripts first`);
    const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", dir], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, `${id}: ${r.stdout}${r.stderr}`);
  }
});

// The forbidden write patterns of PANL-05, in module scope so a fixture can prove each one (OFFC-04).
const FORBIDDEN_WRITE_PATTERNS = [
  /child_process/,
  /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
  /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
  // fs.open only for reading; paseo.workspaces.open would create a workspace.
  /\bfs\.open\([^)]*,\s*"(?!r")|workspaces\.open\s*\(/,
  /\b(spawnProcess|execCommand|terminateProcess)\b/,
  /\bfs\.promises\.(write|append|mkdir|rm|unlink|rename)/,
];

// The source of each forbidden pattern a text matches, full-line comments dropped.
function readOnlyViolations(text) {
  const code = text.replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
  return FORBIDDEN_WRITE_PATTERNS.filter((re) => re.test(code)).map((re) => String(re));
}

test("PANL-05 read-only gate: no write, spawn, archive or send call, no fs write API, no child_process", () => {
  for (const id of IDS) {
    for (const [file, text] of sources(id)) assert.deepEqual(readOnlyViolations(text), [], file);
  }
});

test("PANL-06 client gate: React Native primitives only, theme colours for text", () => {
  for (const id of IDS) {
    for (const [file, text] of sources(id, ["client"]).filter(([f]) => f.includes(`${path.sep}client${path.sep}`))) {
      assert.doesNotMatch(text, /<div\b|<span\b|<svg\b|\bdocument\.|\bwindow\./, file);
      for (const m of text.matchAll(/<Text\b[^>]*?style=\{\{([^}]*)\}\}/gs)) {
        const color = /\bcolor:\s*([^,}]+)/.exec(m[1])?.[1];
        if (color) assert.match(color, /\b(c|colors)\.[a-zA-Z]+/, `${file}: Text colour ${color.trim()} is not from theme.colors`);
      }
      assert.doesNotMatch(text.replace(/^.*DECOR.*$/gm, ""), /<Text[^>]*color:\s*["'](#|rgb)/, file);
    }
  }
});

test("PANL-08 docs describe ph only and reference only files that exist", () => {
  const banned = /paseo_tool\.py|paseo\.md|paseo\.sh|%TEMP%|tmpdir|temp[- ]dir run|preview harness|sim harness|tempDir|runMaxAgeHours/i;
  for (const id of IDS) {
    const readme = fs.readFileSync(path.join(PLUGINS, id, "README.md"), "utf8");
    for (const step of ["npm install", "node node_modules/typescript/bin/tsc --noEmit", "paseo plugin install", "paseo plugin reload", "paseo plugin ls", "paseo plugin logs", "--enable-paseo-plugins", "pluginsEnabled"]) assert.ok(readme.includes(step), `${id} README lacks ${step}`);
    assert.doesNotMatch(readme, banned);
    for (const m of readme.matchAll(/`([^`\s<>]+\.(?:mjs|json|ts|tsx|md))`/g)) {
      const ref = m[1];
      const found = [path.join(PLUGINS, id, ref), path.join(KIT_DIR, ref)].some((p) => fs.existsSync(p));
      assert.ok(found || ref.includes("args.json"), `${id} README references missing ${ref}`);
    }
    for (const [file, text] of sources(id)) assert.doesNotMatch(text, banned, file);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(PLUGINS, "smoke.mjs"), "utf8"), banned);
});

test("PANL-57 the suite covers every named pure module", () => {
  const tests = fs.readdirSync(path.join(KIT_DIR, "tests", "ui")).filter((f) => f.endsWith(".test.mjs")).map((f) => fs.readFileSync(path.join(KIT_DIR, "tests", "ui", f), "utf8")).join("\n");
  const named = {
    parseFrontmatter: "planning-panel/server/frontmatter.ts",
    parseMarkdown: "planning-panel/client/markdown.ts",
    buildTree: "planning-panel/client/tree.ts",
    computeStats: "planning-panel/client/stats.ts",
    withAlpha: "planning-panel/client/color.ts",
    formatRelative: "planning-panel/client/format.ts",
    encodePng: "office/server/png.ts",
    renderSpriteKey: "office/server/sprites.ts",
    spriteKey: "office/shared/sprites-rpc.ts",
    PixelBuf: "office/server/art/core/pixbuf.ts",
    WaveLinker: "office/server/wave-link.ts",
    createWaveHandler: "office/server/wave-link.ts",
  };
  for (const [name, file] of Object.entries(named)) {
    const loaded = new RegExp(`\\bload\\(\\s*${file.split("/").slice(1).map((p) => `"${p.replace(/\./g, "\\.")}"`).join("\\s*,\\s*")}\\s*\\)`);
    assert.ok(tests.includes(`plugins/${file}`) || loaded.test(tests), `${file} not imported by a test`);
    assert.ok(new RegExp(`\\b${name}\\(|new ${name}\\(`).test(tests), `${name} not exercised`);
  }
});

test("PANL-09 the machine opt-in registers exactly these plugin folders, each ready for npm ci", async () => {
  const machine = path.join(KIT_DIR, "kit", "machine", "plugins.mjs");
  const { KIT_PLUGIN_FOLDERS } = await import(pathToFileURL(machine).href);
  assert.deepEqual([...KIT_PLUGIN_FOLDERS].sort(), [...IDS].sort());
  for (const id of IDS) assert.ok(fs.existsSync(path.join(PLUGINS, id, "package-lock.json")));
  assert.ok(!fs.existsSync(path.join(PLUGINS, "backlog-plugin")), "no Backlog plugin ships");
});

test("PANL-10 the smoke script checks every SDK call the plugins use, read-only", () => {
  const smoke = fs.readFileSync(path.join(PLUGINS, "smoke.mjs"), "utf8");
  for (const call of ["agents.list(", "timeline.refetch(", ".refresh()", "workspaces.list(", "ref.current()", "ref.directory", "checkIcons(", "agents.subscribe", "workspaces.subscribe", "projects.subscribe", "observeEvents", "timeline.subscribe"]) assert.ok(smoke.includes(call), call);
  assert.doesNotMatch(smoke, /listUsage/);
  for (const event of ["agent.created", "agent.archived", "agent.turn_started", "agent.turn_ended", "agent.permission_requested", "agent.permission_resolved"]) assert.ok(smoke.includes(`"${event}"`), event);
  assert.doesNotMatch(smoke.replace(/^\s*\/\/.*$/gm, ""), /\.(send|run|archive|create|respondToPermission|setTitle|cancel)\s*\(/);
});

// The deployed loading path (CR-PNL-01): Paseo compiles each plugin from its own folder into one CommonJS bundle
// and evaluates the string, so `import.meta`, imports from outside the folder and run-time imports of kit files
// all break there while plain Node imports work. Uses the installed Paseo compiler offline (no daemon).
async function hostCompiler() {
  const { findCliDir } = await import(pathToFileURL(path.join(KIT_DIR, "ship", ".agents", "harness", "paseo-client", "locate.mjs")).href);
  let cli;
  try {
    cli = findCliDir(process.env);
  } catch {
    return null;
  }
  const dir = path.join(cli, "node_modules", "@getpaseo", "server", "dist", "server", "server", "plugins");
  if (!fs.existsSync(path.join(dir, "compiler.js"))) return null;
  const version = JSON.parse(fs.readFileSync(path.join(cli, "package.json"), "utf8")).version;
  const { compilePlugin } = await import(pathToFileURL(path.join(dir, "compiler.js")).href);
  const { evaluateBundle } = await import(pathToFileURL(path.join(dir, "bundle-evaluator.js")).href);
  return { version, compilePlugin, evaluateBundle };
}

test("PANL-02 both plugins compile and load through the Paseo host bundler and register their handlers", { timeout: 120_000 }, async (t) => {
  const host = await hostCompiler();
  if (!host) return t.skip("the npm-installed Paseo CLI is not present");
  if (host.version !== TESTED_PASEO_CLI) return t.skip(`installed Paseo ${host.version} is not the tested ${TESTED_PASEO_CLI}`);
  const { fakeServer } = await import("./fake-paseo.mjs");
  const want = { "planning-panel": ["planning.board", "planning.file", "planning.index", "planning.plan"], office: ["office.sprites", "office.wave"] };
  for (const id of IDS) {
    const root = path.join(PLUGINS, id);
    const bundles = await host.compilePlugin({ client: path.join(root, "index.client.tsx"), server: path.join(root, "index.server.ts") });
    assert.ok(bundles.clientBundle, `${id}: client bundle`);
    const server = fakeServer();
    const dispose = host.evaluateBundle(bundles.serverBundle)(server);
    const names = [...server.handlers.keys()].sort();
    assert.deepEqual(names, want[id], id);
    dispose();
  }
});

test("PANL-14 the office frontmatter parser is the planning panel's, byte for byte", () => {
  const read = (id) => fs.readFileSync(path.join(PLUGINS, id, "server", "frontmatter.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(read("office"), read("planning-panel"), "copy plugins/planning-panel/server/frontmatter.ts to plugins/office/server/");
});

const normalise = (text) => text.replace(/\r\n/g, "\n");
const officeFiles = (dir) => sources("office", [dir]).filter(([f]) => f.includes(`${path.sep}${dir}${path.sep}`));
const importSpecs = (text) => [...normalise(text).matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

// A client file may only use host primitives: no DOM-like element, no document or window access, a short list of react-native values.
// useWindowDimensions (2026-10-22, phone layout): the reactive device pixel ratio for the narrow fit (client/narrow.ts); it exists
// in react-native and react-native-web alike, unlike window.devicePixelRatio. The static Dimensions module stays out.
const RN_ALLOWED = ["View", "Text", "Image", "Pressable", "Animated", "ScrollView", "Easing", "Platform", "useWindowDimensions"];
function primitiveViolations(text) {
  const code = normalise(text).replace(/^\s*\/\/.*$/gm, "");
  const found = [];
  if (/<\s*(canvas|iframe|webview|svg)\b/i.test(code)) found.push("element");
  if (importSpecs(code).some((s) => /react-native-svg|webview|canvas|iframe/i.test(s))) found.push("import");
  if (/\b(document|window)\.[A-Za-z_]/.test(code)) found.push("global");
  if (/import\s+(?!type\b)[A-Za-z_*][^{;]*from\s*["']react-native["']/.test(code)) found.push("default import");
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react-native["']/g)) {
    for (const part of m[1].split(",").map((p) => p.trim()).filter(Boolean)) {
      if (part.startsWith("type ")) continue;
      const name = part.split(/\s+as\s+/)[0];
      if (!RN_ALLOWED.includes(name)) found.push(`react-native value ${name}`);
    }
  }
  return found;
}

test("OFFC-04 office client uses host primitives only", () => {
  const forbidden = [
    "const a = <canvas />;",
    'const a = <iframe src="x" />;',
    "const a = <WebView />;",
    "const a = <svg></svg>;",
    'import Svg from "react-native-svg";',
    "const t = document.title;",
    "const w = window.innerWidth;",
    'import { View, Dimensions } from "react-native";',
    'import RN from "react-native";',
  ];
  for (const fixture of forbidden) assert.ok(primitiveViolations(fixture).length > 0, fixture);
  assert.deepEqual(primitiveViolations('import { View, Text, Animated, type ViewProps } from "react-native";\nimport type { ViewStyle } from "react-native";\nconst a = <View />;'), []);
  const files = [["index.client.tsx", fs.readFileSync(path.join(PLUGINS, "office", "index.client.tsx"), "utf8")], ...officeFiles("client")];
  assert.ok(files.length >= 3);
  for (const [file, text] of files) assert.deepEqual(primitiveViolations(text), [], file);
});

test("OFFC-03 office RPC names and purity", () => {
  const shared = officeFiles("shared");
  const names = shared.flatMap(([, text]) => [...normalise(text).matchAll(/defineRpc\(\s*\{[^}]*?name:\s*["']([^"']+)["']/gs)].map((m) => m[1]));
  assert.ok(names.length > 0);
  for (const name of names) assert.match(name, /^office\.[a-z][a-z0-9._-]*$/, name);
  for (const [file, text] of shared) {
    for (const spec of importSpecs(text)) assert.doesNotMatch(spec, /^node:|^react($|-native)|(^|\/)server(\/|$)/, `${file}: ${spec}`);
  }
  const clients = [["index.client.tsx", fs.readFileSync(path.join(PLUGINS, "office", "index.client.tsx"), "utf8")], ...officeFiles("client")];
  for (const [file, text] of clients) {
    for (const spec of importSpecs(text).filter((s) => s.startsWith("."))) assert.doesNotMatch(spec, /(^|\/)server(\/|$)/, `${file}: ${spec}`);
  }
});

test("OFFC-01 office registers with the current host calls", () => {
  const text = normalise(fs.readFileSync(path.join(PLUGINS, "office", "client", "register.ts"), "utf8"));
  assert.match(text, /\baddScreen\(/);
  assert.match(text, /\baddSidebarHeaderItem\(/);
  assert.doesNotMatch(text, /\baddSurface\b|\baddSidebarItem\b/);
});

// ---- OFFC-23 smoke: the script against a fake CLI directory and a fake daemon -------------------------------------
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])(\d)/g, "$1-$2").toLowerCase();

// The icon names smoke.mjs looks for: same two expressions, every client file of both plugins, found recursively.
function clientIconNames() {
  const names = new Set();
  for (const id of IDS) {
    for (const [file, text] of sources(id, ["client"])) {
      if (!file.includes(`${path.sep}client${path.sep}`) || !/\.tsx?$/.test(file)) continue;
      for (const m of text.matchAll(/(?:name|icon)[=:]\s*\{?"([A-Z][A-Za-z0-9]+)"/g)) names.add(m[1]);
      for (const m of text.matchAll(/:\s*"([A-Z][A-Za-z0-9]+)",?\s*$/gm)) names.add(m[1]);
    }
  }
  return [...names].sort();
}

// The fake client module: a daemon whose api answers the read calls of smoke.mjs; FAKE_SMOKE_OMIT holds dotted names to remove.
const FAKE_CLIENT_JS = [
  "export async function connectToDaemon() {",
  '  const omit = (process.env.FAKE_SMOKE_OMIT ?? "").split(",").filter(Boolean);',
  "  const wide = (obj) => new Proxy(obj, { has: () => true });",
  '  const agent = wide({ id: "agent-1" });',
  "  const subscribe = () => () => {};",
  "  const timeline = {",
  '    refetch: async () => ({ entries: [{ item: { type: "tool_call", detail: { type: "read" } }, timestamp: 1, seqStart: 1 }] }),',
  "    subscribe,",
  "  };",
  "  const api = {",
  "    agents: { list: async () => ({ entries: [{ agent }], pageInfo: {} }), ref: () => ({ timeline, refresh: async () => ({ agent }) }), subscribe },",
  '    workspaces: { list: async () => ({ entries: [wide({ id: "ws-1" })] }), ref: () => ({ current: () => ({ workspaceDirectory: "/work" }), refresh: async () => ({}), directory: "/work" }), subscribe },',
  "    projects: { subscribe },",
  "    observeEvents: subscribe,",
  "  };",
  "  for (const name of omit) {",
  '    if (name === "timeline.subscribe") delete timeline.subscribe;',
  "    else {",
  '      const parts = name.split(".");',
  "      const last = parts.pop();",
  "      delete parts.reduce((o, k) => o[k], api)[last];",
  "    }",
  "  }",
  "  return { api, close: async () => {} };",
  "}",
  "",
].join("\n");

function writeSmokeFakes() {
  const root = makeTempDir("paseo kit smoke ");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text, "utf8");
  };
  write("cli/package.json", '{ "type": "module" }\n');
  write("cli/dist/utils/client.js", FAKE_CLIENT_JS);
  write("cli/node_modules/@getpaseo/client/package.json", '{ "type": "module" }\n');
  write("cli/node_modules/@getpaseo/client/dist/index.js", "export function createPaseoApi(daemon) { return daemon.api; }\n");
  write("app/resources/app-dist/icons.js", `export default [${clientIconNames().map((n) => JSON.stringify(kebab(n))).join(", ")}];\n`);
  return { cli: path.join(root, "cli"), app: path.join(root, "app") };
}

function runSmoke(fakes, omit = []) {
  return spawnSync(process.execPath, [path.join(PLUGINS, "smoke.mjs"), "--app-dir", fakes.app], {
    cwd: KIT_DIR,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, PASEO_CLI_DIR: fakes.cli, PASEO_HOST: "127.0.0.1:1", FAKE_SMOKE_OMIT: omit.join(",") },
  });
}

test("OFFC-23 smoke: the script passes against a fake daemon with office loaded and fails when a subscribe surface is missing", { timeout: 180_000 }, () => {
  assert.ok(clientIconNames().length > 0, "the client folders name no icon");
  const good = runSmoke(writeSmokeFakes());
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /smoke passed/);
  for (const name of ["agents.subscribe", "workspaces.subscribe", "projects.subscribe", "observeEvents", "timeline.subscribe"]) {
    assert.match(good.stdout, new RegExp(`^ok +office SDK: (agents\\.ref\\(\\)\\.)?${name.replace(/\./g, "\\.")}`, "m"), name);
  }
  for (const omitted of ["agents.subscribe", "timeline.subscribe"]) {
    const bad = runSmoke(writeSmokeFakes(), [omitted]);
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stdout, new RegExp(`^FAILED +office SDK: (agents\\.ref\\(\\)\\.)?${omitted.replace(/\./g, "\\.")}`, "m"));
    assert.match(bad.stdout, /smoke failed/);
  }
});

// ---- OFFC-23 / OFFC-24 docs ---------------------------------------------------------------------------------------
const DESKTOP_ONLY = "Desktop only; mobile not tested; one host.";
const OFFICE_HEADINGS = ["## What it shows", "## What it reads", "## What it never does", "## Stale registration", "## Licence"];
const staleNoteLine = (line) => line.includes("paseo plugin ls") && line.includes("paseo plugin remove");

function docsProblems(rootReadme, officeReadme) {
  const problems = [];
  const root = normalise(rootReadme);
  const office = normalise(officeReadme);
  if (!/\boffice\b/i.test(root)) problems.push("README.md does not name office");
  if (!root.split("\n").some(staleNoteLine)) problems.push("README.md lacks the stale-registration note on one line");
  if (!office.includes(DESKTOP_ONLY)) problems.push("the office README lacks the desktop-only sentence");
  for (const heading of OFFICE_HEADINGS) if (!office.split("\n").includes(heading)) problems.push(`the office README lacks the heading ${heading}`);
  if (!office.includes("harness.run")) problems.push("the office README does not name harness.run");
  if (!office.includes("LICENSES/habblaud-MIT.txt")) problems.push("the office README does not name LICENSES/habblaud-MIT.txt");
  if (!office.split("\n").some(staleNoteLine)) problems.push("the office README lacks the stale-registration note on one line");
  return problems;
}

const read = (...parts) => fs.readFileSync(path.join(KIT_DIR, ...parts), "utf8");

test("OFFC-23 docs: both READMEs describe office and carry the stale-registration note", () => {
  const rootText = read("README.md");
  const officeText = read("plugins", "office", "README.md");
  const stale = "If `paseo plugin ls` lists it, run `paseo plugin remove x`.";
  const good = `# office\n\n${DESKTOP_ONLY}\nharness.run LICENSES/habblaud-MIT.txt\n${OFFICE_HEADINGS.join("\n")}\n${stale}\n`;
  assert.deepEqual(docsProblems(`office\n${stale}\n`, good), []);
  assert.deepEqual(docsProblems(`UI\n${stale}\n`, good), ["README.md does not name office"]);
  assert.deepEqual(docsProblems("office\nrun `paseo plugin ls`\nthen `paseo plugin remove x`\n", good), ["README.md lacks the stale-registration note on one line"]);
  assert.deepEqual(docsProblems(`office\n${stale}\n`, good.replace(DESKTOP_ONLY, "")), ["the office README lacks the desktop-only sentence"]);
  for (const heading of OFFICE_HEADINGS) assert.ok(docsProblems(`office\n${stale}\n`, good.replace(`${heading}\n`, "")).length > 0, heading);
  assert.ok(docsProblems(`office\n${stale}\n`, good.replace("harness.run", "")).length > 0);
  assert.ok(docsProblems(`office\n${stale}\n`, good.replace("LICENSES/habblaud-MIT.txt", "")).length > 0);
  assert.ok(docsProblems(`office\n${stale}\n`, good.replace(stale, "")).length > 0);
  assert.deepEqual(docsProblems(rootText, officeText), []);
});

test("OFFC-24 scope: 07-SPIKE.md and the plugin README state desktop only", () => {
  assert.ok(normalise(read(".planning", "phases", "07-office", "07-SPIKE.md")).includes(DESKTOP_ONLY), "07-SPIKE.md");
  assert.ok(normalise(read("plugins", "office", "README.md")).includes(DESKTOP_ONLY), "plugins/office/README.md");
});

// ---- OFFC-04 / OFFC-18 / OFFC-16: read-only fixtures, the only file reader, no provider usage API ------------------
const posix = (file) => file.replace(/\\/g, "/");
// Full-line comments only; a block comment inside a string must not hide code.
const stripComments = (text) => normalise(text).replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, "");

test("OFFC-04 read-only fixtures: every forbidden pattern has a fixture that fails the gate and the clean fixture passes", () => {
  const fixtures = [
    'import { spawn } from "node:child_process";',
    'await writeFile(file, "x");',
    'await agent.send("hi");',
    'const h = fs.open(file, "w");',
    "spawnProcess(command);",
    'await fs.promises.writeFile(file, "x");',
  ];
  assert.equal(fixtures.length, FORBIDDEN_WRITE_PATTERNS.length);
  fixtures.forEach((fixture, i) => {
    assert.match(fixture, FORBIDDEN_WRITE_PATTERNS[i], `fixture ${i + 1}`);
    assert.ok(readOnlyViolations(fixture).includes(String(FORBIDDEN_WRITE_PATTERNS[i])), `fixture ${i + 1} is not reported`);
  });
  assert.ok(readOnlyViolations("await paseo.workspaces.open({});").length > 0);
  assert.deepEqual(readOnlyViolations('const h = fs.open(file, "r");'), []);
  assert.deepEqual(readOnlyViolations("await paseo.agents.list({});"), []);
  assert.deepEqual(readOnlyViolations('// await agent.send("x");\nconst a = 1;'), []);
});

const READ_PATTERNS = [
  /\bimport\b[^;]*?\bfrom\s*["'](?:node:)?fs(?:\/promises)?["']/,
  /\bimport\s*\(?\s*["'](?:node:)?fs(?:\/promises)?["']/,
  /\brequire\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/,
  /\b(?:readFile|readFileSync|readdir|readdirSync|readlink|readlinkSync|realpath|realpathSync|opendir|opendirSync|createReadStream|statSync|lstatSync|existsSync|accessSync)\s*\(/,
  /\bfs\.(?:open|promises|read)\b/,
];

// [relative path, reading pattern] for each file that reads outside server/wave-link.ts (OFFC-18).
function readerViolations(files) {
  const found = [];
  for (const [file, text] of files) {
    const rel = posix(file);
    if (rel.endsWith("office/server/wave-link.ts")) continue;
    const code = stripComments(text);
    for (const re of READ_PATTERNS) if (re.test(code)) found.push(`${rel}: ${re}`);
  }
  return found;
}

test("OFFC-18 only reader: server/wave-link.ts is the only module of office that reads files", () => {
  const fixtures = [
    ["office/client/a.ts", 'import fs from "node:fs";'],
    ["office/client/b.tsx", 'import { readFileSync } from "fs";'],
    ["office/server/c.ts", 'const text = readFileSync(file, "utf8");'],
    ["office/server/d.ts", "const names = await readdir(dir);"],
    ["office/server/e.ts", "if (existsSync(file)) return;"],
    ["office/server/f.ts", "const text = await fs.promises.readFile(file);"],
    ["office/server/g.ts", 'const fs = require("node:fs");'],
    ["office/shared/h.ts", 'import { stat } from "node:fs/promises";'],
  ];
  for (const fixture of fixtures) assert.equal(readerViolations([fixture]).length > 0, true, fixture[0]);
  assert.deepEqual(readerViolations([["office/server/wave-link.ts", 'import fs from "node:fs";\nconst t = fs.readFileSync(p);']]), []);
  assert.deepEqual(readerViolations([["office\\server\\wave-link.ts", 'import fs from "node:fs";']]), []);
  assert.deepEqual(readerViolations([["office/client/ok.ts", '// readFileSync(file) is not called here\nexport const a = 1;']]), []);
  const tree = sources("office");
  assert.ok(tree.length > 10, "the office tree is empty");
  assert.deepEqual(readerViolations(tree), []);
  const wave = tree.find(([file]) => posix(file).endsWith("office/server/wave-link.ts"));
  assert.ok(wave, "server/wave-link.ts is missing");
  assert.match(wave[1], /\bfrom\s*["'](?:node:)?fs/, "wave-link.ts does not import fs");
});

const PROVIDER_PATTERNS = [/\blistUsage\b/, /\.providers\b/, /\bregisterProvider\b/, /\bregisterUsageSource\b/];
const providerViolations = (text) => PROVIDER_PATTERNS.filter((re) => re.test(normalise(text))).map(String);

function walkFiles(dir, skipDirs = ["node_modules", ".git"]) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) out.push(...walkFiles(full, skipDirs));
    } else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("OFFC-16 office never touches the provider usage API", () => {
  for (const fixture of ["await paseo.providers.listUsage();", "server.registerUsageSource(x);", "registerProvider(y);", "const p = paseo.providers;"]) {
    assert.ok(providerViolations(fixture).length > 0, fixture);
  }
  assert.deepEqual(providerViolations("const usage = agent.lastUsage;\nawait paseo.agents.list({});"), []);
  const files = walkFiles(path.join(PLUGINS, "office")).filter((f) => /\.(md|json|ts|tsx|mjs)$/.test(f) && path.basename(f) !== "package-lock.json");
  files.push(path.join(PLUGINS, "smoke.mjs"));
  assert.ok(files.length > 10);
  for (const file of files) assert.deepEqual(providerViolations(fs.readFileSync(file, "utf8")), [], path.relative(KIT_DIR, file));
});

// ---- OFFC-20: the licence, the notice and the headers of the ported art ---------------------------------------------
function habblaudSection(notice) {
  const lines = normalise(notice).split("\n");
  const start = lines.findIndex((l) => l.startsWith("## habblaud"));
  if (start < 0) return null;
  const next = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, next < 0 ? lines.length : next).join("\n");
}
const noticeCommit = (notice) => habblaudSection(notice)?.match(/\b[0-9a-f]{40}\b/)?.[0] ?? null;

function licenceProblems(licence, notice) {
  const problems = [];
  const lines = normalise(licence).replace(/^﻿/, "").split("\n");
  if (lines[0] !== "MIT License") problems.push("the licence does not start with the line MIT License");
  if (!lines.some((l) => /^Copyright \(c\) \d{4} \S/.test(l))) problems.push("the licence has no copyright line");
  if (!lines.join("\n").includes("Permission is hereby granted, free of charge")) problems.push("the licence lacks the permission paragraph");
  const noticeLines = normalise(notice).split("\n");
  for (const heading of ["## Harness v2", "## GSD core"]) if (!noticeLines.some((l) => l.startsWith(heading))) problems.push(`NOTICE.md lost the heading ${heading}`);
  const section = habblaudSection(notice);
  if (section === null) problems.push("NOTICE.md has no ## habblaud section");
  else {
    if (!section.includes("LICENSES/habblaud-MIT.txt")) problems.push("the habblaud section does not name LICENSES/habblaud-MIT.txt");
    if (!noticeCommit(notice)) problems.push("the habblaud section names no 40-character commit");
  }
  return problems;
}

test("OFFC-20 licence and notice: the MIT file, the NOTICE entry and its full commit", () => {
  const commit = "a".repeat(40);
  const licence = "MIT License\n\nCopyright (c) 2026 Someone\n\nPermission is hereby granted, free of charge, to any person\n";
  const notice = `## Harness v2 (x)\n\n## GSD core (MIT)\n\n## habblaud (MIT)\n\nat commit \`${commit}\` (\`LICENSES/habblaud-MIT.txt\`)\n\n## Pins\n\n| other | ${"b".repeat(40)} |\n`;
  assert.deepEqual(licenceProblems(licence, notice), []);
  assert.equal(noticeCommit(notice), commit);
  assert.equal(noticeCommit(notice.replace(commit, "c".repeat(39))), null, "the Pins table commit must not be taken");
  assert.equal(licenceProblems(licence.replace("MIT License", "The MIT License"), notice).length, 1);
  assert.equal(licenceProblems(licence.replace("Copyright (c) 2026 Someone", "Copyright Someone"), notice).length, 1);
  assert.equal(licenceProblems(licence.replace("Permission is hereby granted, free of charge", "Allowed"), notice).length, 1);
  assert.equal(licenceProblems(licence, notice.replace("## habblaud (MIT)", "## other (MIT)")).length, 1);
  assert.equal(licenceProblems(licence, notice.replace("LICENSES/habblaud-MIT.txt", "LICENSES/x.txt")).length, 1);
  assert.equal(licenceProblems(licence, notice.replace(commit, "c".repeat(39))).length, 1);
  assert.equal(licenceProblems(licence, notice.replace("## Harness v2", "## Harness")).length, 1);
  assert.equal(licenceProblems(licence, notice.replace("## GSD core", "## GSD")).length, 1);
  const realNotice = read("NOTICE.md");
  assert.deepEqual(licenceProblems(read("LICENSES", "habblaud-MIT.txt"), realNotice), []);
  assert.match(noticeCommit(realNotice) ?? "", /^[0-9a-f]{40}$/);
});

// The three header grammars the phase writes: Port of ... @ commit, Ported from ... at commit, Original code ... at commit.
const HEADER_GRAMMAR = /^(?:Port of habblaud|Ported from marmottajr\/habblaud|Original code\b.*?marmottajr\/habblaud)\s+(\S+\.ts(?:\s+and\s+\S+\.ts)*)\s+(?:@|at)\s+([0-9a-f]{40})\b/;
const commentText = (line) => line.trim().replace(/^(?:\/\/+|\/\*+|\*+)\s*/, "").trim();
const firstLines = (text, n) => normalise(text).replace(/^﻿/, "").split("\n").filter((l) => l.trim() !== "").slice(0, n);

function headerProblems(files, commit) {
  const problems = [];
  for (const [file, text] of files) {
    const rel = posix(file);
    if (!rel.startsWith("office/") || !/\.tsx?$/.test(rel)) continue;
    const lines = firstLines(text, 3);
    const hasNoUpstream = lines.some((l) => commentText(l).startsWith("No upstream"));
    if (rel.startsWith("office/server/art/spike/")) {
      if (!hasNoUpstream) problems.push(`${rel}: a spike file lacks "No upstream" in its first three lines`);
      continue;
    }
    const art = rel.startsWith("office/server/art/");
    if (!art && !/habblaud/i.test(lines[0] ?? "")) continue;
    if (hasNoUpstream) {
      problems.push(`${rel}: "No upstream" outside the spike folder`);
      continue;
    }
    const matches = lines.map((l) => HEADER_GRAMMAR.exec(commentText(l))).filter(Boolean);
    if (matches.length === 0) problems.push(`${rel}: no header naming an upstream .ts path and a commit`);
    else if (!matches.some((m) => m[2] === commit)) problems.push(`${rel}: the header commit ${matches[0][2]} is not the noticed ${commit}`);
  }
  return problems;
}

test("OFFC-20 headers: every ported art file names its upstream path and the noticed commit", () => {
  const c = "d".repeat(40);
  const other = "e".repeat(40);
  const good = [
    ["office/server/art/a.ts", `// Port of habblaud client/src/art/a.ts @ ${c} (MIT).\nexport const a = 1;`],
    ["office/server/art/b.ts", `// Port of habblaud client/src/art/b.ts and client/src/art/api.ts @ ${c} (MIT).`],
    ["office/server/art/c.ts", `// Ported from marmottajr/habblaud client/src/art/c.ts at ${c} (MIT).`],
    ["office/server/art/d.ts", `// Original code for plan 07-04 that draws the frames of marmottajr/habblaud client/src/art/d.ts at ${c} (MIT).`],
    ["office/server/art/spike/e.ts", "// No upstream: spike-grade drawing.\nexport const e = 1;"],
    ["office/shared/layout/f.ts", `// Port of habblaud client/src/world/f.ts @ ${c} (MIT).`],
    ["office/client/plain.ts", "export const plain = 1;"],
  ];
  assert.deepEqual(headerProblems(good, c), []);
  const bad = [
    ["office/server/art/a.ts", "export const a = 1;"],
    ["office/server/art/b.ts", `// Port of habblaud client/src/art/b.ts @ ${other} (MIT).`],
    ["office/server/art/spike/c.ts", "export const c = 1;"],
    ["office/server/art/d.ts", "// No upstream: but outside the spike folder.\nexport const d = 1;"],
    ["office/server/art/e.ts", `// Port of habblaud @ ${c} (MIT).`],
    ["office/shared/layout/f.ts", `// Port of habblaud client/src/world/f.ts @ ${other} (MIT).`],
  ];
  for (const fixture of bad) assert.equal(headerProblems([fixture], c).length, 1, fixture[0]);
  const commit = noticeCommit(read("NOTICE.md"));
  assert.ok(commit, "NOTICE.md names no commit");
  const tree = sources("office");
  assert.ok(tree.filter(([file]) => posix(file).startsWith("office/server/art/")).length > 10, "the art tree is empty");
  assert.deepEqual(headerProblems(tree, commit), []);
});

// ---- OFFC-25: the supersession ledger -------------------------------------------------------------------------------
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const LEDGER_SUPERSEDED = [34, 36, ...range(45, 54), 55];
const LEDGER_KEPT = [...range(1, 10), 56, 57, 61];
const pid = (n) => `PANL-${String(n).padStart(2, "0")}`;

function ledgerProblems(markdown) {
  const lines = normalise(markdown).split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Superseded ledger"));
  if (start < 0) return ["the Superseded ledger section is missing"];
  const problems = [];
  const seen = new Map();
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 2 || /^(Id\b|-+$)/.test(cells[0])) continue;
    const status = /^superseded/i.test(cells[1]) ? "superseded" : /^kept/i.test(cells[1]) ? "kept" : cells[1];
    for (const part of cells[0].split(",")) {
      const m = /^PANL-(\d+)(?:\.\.(\d+))?$/.exec(part.trim());
      if (!m) {
        problems.push(`unreadable id ${part.trim()}`);
        continue;
      }
      for (const n of range(Number(m[1]), Number(m[2] ?? m[1]))) seen.set(n, [...(seen.get(n) ?? []), status]);
    }
  }
  for (const [want, ids] of [["superseded", LEDGER_SUPERSEDED], ["kept", LEDGER_KEPT]]) {
    for (const n of ids) {
      const got = seen.get(n) ?? [];
      if (got.length === 0) problems.push(`${pid(n)} is missing`);
      else if (got.length > 1) problems.push(`${pid(n)} is listed ${got.length} times`);
      else if (got[0] !== want) problems.push(`${pid(n)} is ${got[0]}, not ${want}`);
    }
  }
  for (const n of seen.keys()) if (![...LEDGER_SUPERSEDED, ...LEDGER_KEPT].includes(n)) problems.push(`${pid(n)} is not part of the ledger`);
  return problems;
}

const PHASE_BASE_COMMIT = "88ac8fd4dd2379689085ce1b499107e355bb553f";
const LEDGER_FIXTURE = [
  "## Superseded ledger (D-10)",
  "",
  "| Id | Status | Replaced by |",
  "|----|--------|-------------|",
  "| PANL-45..54 | superseded | OFFC-06..19 |",
  "| PANL-34, PANL-36 | superseded where they rest on name heuristics | OFFC-05 |",
  "| PANL-55 | superseded where it reads project config | OFFC-16 |",
  "| PANL-01..10 | kept | OFFC-01..04 |",
  "| PANL-56, PANL-57 | kept | OFFC-06, 22 |",
  "| PANL-61 | kept as the one file-read exception | OFFC-18 |",
  "",
].join("\n");

test("OFFC-25 ledger: each superseded and kept requirement is listed once and tools.md is unchanged", (t) => {
  assert.deepEqual(ledgerProblems(LEDGER_FIXTURE), []);
  assert.deepEqual(ledgerProblems(`${LEDGER_FIXTURE}| PANL-61 | kept | x |\n`), ["PANL-61 is listed 2 times"]);
  assert.deepEqual(ledgerProblems(LEDGER_FIXTURE.replace("| PANL-55 | superseded where it reads project config | OFFC-16 |\n", "")), ["PANL-55 is missing"]);
  assert.deepEqual(ledgerProblems(LEDGER_FIXTURE.replace("PANL-61 | kept as", "PANL-61 | superseded as")), ["PANL-61 is superseded, not kept"]);
  assert.deepEqual(ledgerProblems(LEDGER_FIXTURE.replace("PANL-56, PANL-57 | kept", "PANL-56, PANL-57, PANL-58 | kept")), ["PANL-58 is not part of the ledger"]);
  assert.equal(ledgerProblems("# nothing\n").length, 1);
  const file = path.join(KIT_DIR, ".planning", "requirements", "office.md");
  assert.ok(fs.existsSync(file), ".planning/requirements/office.md is missing");
  assert.deepEqual(ledgerProblems(fs.readFileSync(file, "utf8")), []);
  const git = (...args) => spawnSync("git", args, { cwd: KIT_DIR, encoding: "utf8", windowsHide: true });
  const known = git("cat-file", "-e", `${PHASE_BASE_COMMIT}^{commit}`);
  if (known.error || known.status !== 0) return t.diagnostic("skipped: git or the phase base commit is unavailable, tools.md not compared");
  const diff = git("diff", "--quiet", PHASE_BASE_COMMIT, "--", ".planning/requirements/tools.md");
  assert.equal(diff.status, 0, "tools.md differs from the phase base commit");
});

// ---- OFFC-02: the retired plugin is gone everywhere ---------------------------------------------------------------
const RETIRED_ID = ["swarm", "map"].join("-");
const TEXT_EXTENSION = /\.(md|mjs|cjs|js|json|jsonl|ts|tsx|txt|yml|yaml|toml|html|css|sh)$/i;
const SCAN_MAX_BYTES = 2 * 1024 * 1024;

// [relative path, text] for a readable file; text is null and the reason is named for a link, a binary or an over-limit file.
function scanFile(root, rel) {
  const full = path.join(root, rel);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) return [rel, null, "link"];
  if (stat.size > SCAN_MAX_BYTES) return [rel, null, "over 2 MB"];
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) return [rel, null, "binary"];
  return [rel, bytes.toString("utf8").replace(/\r\n/g, "\n"), null];
}

// git tracked plus untracked non-ignored files; without git a directory walk that skips node_modules, .git, _workspace and .planning.
function repoFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (!r.error && r.status === 0) {
    const files = [...new Set(r.stdout.split("\0").filter(Boolean))].filter((rel) => {
      try {
        fs.lstatSync(path.join(root, rel));
        return true;
      } catch {
        return false; // deleted in the working tree
      }
    });
    return { via: "git", files };
  }
  const skip = ["node_modules", ".git", "_workspace", ".planning"];
  return { via: "walk", files: walkFiles(root, skip).map((f) => posix(path.relative(root, f))) };
}

function retirementProblems(files, needle) {
  const problems = [];
  for (const [file, text] of files) {
    if (text == null) continue;
    const rel = posix(file);
    if (rel === "CHANGELOG.md" || rel.startsWith(".planning/")) continue;
    const readme = rel.split("/").pop() === "README.md";
    text.split("\n").forEach((line, i) => {
      if (!line.includes(needle)) return;
      if (!readme) problems.push(`${rel}:${i + 1}: names the retired plugin`);
      else if (!staleNoteLine(line)) problems.push(`${rel}:${i + 1}: names the retired plugin outside the stale-registration note`);
    });
  }
  return problems;
}

test("OFFC-02 retirement: the plugin, its tests and every reference are gone", (t) => {
  const note = `If \`paseo plugin ls\` lists ${RETIRED_ID}, run \`paseo plugin remove ${RETIRED_ID}\`.`;
  assert.equal(retirementProblems([["plugins/x/index.ts", `const id = "${RETIRED_ID}";`]], RETIRED_ID).length, 1);
  assert.equal(retirementProblems([["README.md", `The ${RETIRED_ID} plugin\n${note}`]], RETIRED_ID).length, 1);
  assert.equal(retirementProblems([["plugins/office/README.md", `paseo plugin ls shows ${RETIRED_ID}`]], RETIRED_ID).length, 1);
  assert.deepEqual(retirementProblems([["README.md", note], ["plugins/office/README.md", note]], RETIRED_ID), []);
  assert.deepEqual(retirementProblems([["CHANGELOG.md", RETIRED_ID], [".planning/phases/x.md", RETIRED_ID], ["a.bin", null]], RETIRED_ID), []);
  assert.equal(fs.existsSync(path.join(PLUGINS, RETIRED_ID)), false, "the plugin folder still exists");
  assert.deepEqual(fs.readdirSync(path.join(KIT_DIR, "tests", "ui")).filter((f) => /^swarm-.*\.test\.mjs$/.test(f)), []);
  const { via, files } = repoFiles(KIT_DIR);
  if (via !== "git") t.diagnostic("git is unavailable: the file list comes from a directory walk that skips node_modules, .git, _workspace and .planning");
  assert.ok(files.length > 100, `only ${files.length} files listed`);
  const scanned = files.map((rel) => scanFile(KIT_DIR, rel));
  const skipped = scanned.filter(([, text]) => text === null);
  for (const [rel, , reason] of skipped) t.diagnostic(`skipped ${rel}: ${reason}`);
  assert.deepEqual(skipped.filter(([rel]) => TEXT_EXTENSION.test(rel)).map(([rel, , reason]) => `${rel}: ${reason}`), [], "a text file was skipped");
  assert.deepEqual(retirementProblems(scanned.map(([rel, text]) => [rel, text]), RETIRED_ID), []);
});

// ---- OFFC-23 / HARN-15: the owner-approved office entry at the top of the Unreleased section --------------------------
const CHANGELOG_PREFIX = "- Owner-approved Office plugin, ";
const CHANGELOG_WORDS = ["office", "habblaud", "OFFC-", "Measured check:", "paseo plugin remove"];

// Bullets of a text: each runs from a line starting `- ` to the next line starting `- ` or the next blank line; wrapped lines are joined by one space.
function changelogBullets(lines) {
  const bullets = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("- ")) {
      current = line.trimEnd();
      bullets.push(current);
    } else if (line.trim() === "") current = null;
    else if (current !== null) bullets[bullets.length - 1] = current = `${current} ${line.trim()}`;
  }
  return bullets;
}

function changelogProblems(text) {
  const lines = normalise(text).split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "## [Unreleased]");
  const problems = [];
  const isOffice = (b) => b.startsWith(CHANGELOG_PREFIX.slice(0, CHANGELOG_PREFIX.indexOf(",")));
  let section = [];
  if (start < 0) problems.push("CHANGELOG.md has no ## [Unreleased] section");
  else {
    const next = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
    section = lines.slice(start + 1, next < 0 ? lines.length : next);
  }
  const entries = changelogBullets(section).filter(isOffice);
  if (start >= 0 && entries.length === 0) {
    problems.push(changelogBullets(lines).some(isOffice) ? "the office entry is outside the Unreleased section" : "the Unreleased section has no Owner-approved Office plugin bullet");
  }
  if (entries.length > 1) problems.push(`the Unreleased section has ${entries.length} office bullets, not one`);
  for (const entry of entries.slice(0, 1)) {
    const dated = /^- Owner-approved Office plugin, (\d{4}-\d{2}-\d{2}):/.exec(entry);
    if (!dated) problems.push("the office bullet has a missing or malformed date (want `Owner-approved Office plugin, YYYY-MM-DD:`)");
    const body = dated ? entry.slice(dated[0].length) : entry.slice(entry.indexOf(":") + 1);
    for (const word of CHANGELOG_WORDS) {
      if (!(word === "office" ? body.toLowerCase() : body).includes(word)) problems.push(`the office bullet lacks the word ${word}`);
    }
  }
  return problems;
}

test("OFFC-23 changelog checker: every malformed or missing entry is reported and one good entry passes", () => {
  const good = [
    `- Owner-approved Office plugin, 2026-10-21: the \`office\` plugin replaces ${RETIRED_ID}, art ported from habblaud (OFFC-01..25).`,
    `  Measured check: \`tsc\` clean. Operator: \`paseo plugin ls\`, then \`paseo plugin remove ${RETIRED_ID}\`.`,
    "",
  ].join("\n");
  const older = "- Owner-approved tier policy, 2026-10-20: older text.\n\n";
  const doc = (unreleased, released = "- First release.\n") => `# Changelog\n\n## [Unreleased]\n\n${unreleased}## [0.0.1] - 2026-10-20\n\n${released}`;
  const withBullet = (b) => doc(`${b}\n`);
  assert.deepEqual(changelogProblems(doc(good + older)), []);
  assert.deepEqual(changelogProblems(doc(older + good)), [], "the position inside the section is not judged");
  assert.deepEqual(changelogProblems(doc(good).replace(/\n/g, "\r\n")), [], "CRLF");
  // a wrapped phrase still counts
  assert.deepEqual(changelogProblems(withBullet(good.replace("Measured check:", "Measured\n  check:").replace("paseo plugin remove", "paseo plugin\n  remove").trimEnd())), []);
  // no section, no bullet, wrong section
  assert.deepEqual(changelogProblems(good), ["CHANGELOG.md has no ## [Unreleased] section"]);
  assert.deepEqual(changelogProblems(doc(older)), ["the Unreleased section has no Owner-approved Office plugin bullet"]);
  assert.deepEqual(changelogProblems(doc("", good)), ["the office entry is outside the Unreleased section"]);
  assert.deepEqual(changelogProblems(doc(older, good)), ["the office entry is outside the Unreleased section"]);
  // dates
  for (const bad of ["soon", "2026-1-5", "21-10-2026", ""]) {
    const problems = changelogProblems(withBullet(good.replace("2026-10-21", bad)));
    assert.equal(problems.length, 1, bad);
    assert.match(problems[0], /missing or malformed date/, bad);
  }
  assert.match(changelogProblems(withBullet(good.replace("2026-10-21:", "2026-10-21")))[0], /malformed date/);
  // each required word, named
  const lacking = { office: good.replace("`office`", "the plugin"), habblaud: good.replace("habblaud", "upstream"), "OFFC-": good.replace("OFFC-01..25", "all"), "Measured check:": good.replace("Measured check:", "Check:"), "paseo plugin remove": good.replace("paseo plugin remove", "remove") };
  for (const [word, bullet] of Object.entries(lacking)) assert.deepEqual(changelogProblems(withBullet(bullet.trimEnd())), [`the office bullet lacks the word ${word}`], word);
  // two entries
  assert.deepEqual(changelogProblems(doc(good + good)), ["the Unreleased section has 2 office bullets, not one"]);
  // the bullet ends at the blank line: a required word after it does not count
  assert.deepEqual(changelogProblems(doc(good.replace(" Operator:", "\n\n  Operator:"))), ["the office bullet lacks the word paseo plugin remove"]);
});

test("OFFC-23 changelog: the Unreleased section holds the owner-approved office entry with a date", () => {
  assert.deepEqual(changelogProblems(read("CHANGELOG.md")), []);
});
