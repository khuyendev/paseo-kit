import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { TESTED_PASEO_CLI } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { KIT_DIR } from "../helpers/temp.mjs";

const PLUGINS = path.join(KIT_DIR, "plugins");
const IDS = ["planning-panel", "swarm-map"];
const SOURCE_DIRS = ["client", "server", "shared"];

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
    assert.equal(manifest.requirements.paseo, TESTED_PASEO_CLI);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const f of pkg.files) assert.ok(fs.existsSync(path.join(dir, f)), `${id}: files entry ${f} missing`);
    for (const dep of ["@getpaseo/plugin", "react", "react-native", "@tanstack/react-query", "zod", "typescript", "@types/node"]) assert.ok(pkg.devDependencies[dep], `${id}: ${dep}`);
    assert.equal(pkg.devDependencies["@getpaseo/plugin"], TESTED_PASEO_CLI);
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

test("PANL-05 read-only gate: no write, spawn, archive or send call, no fs write API, no child_process", () => {
  const forbidden = [
    /child_process/,
    /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
    /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
    // fs.open only for reading; paseo.workspaces.open would create a workspace.
    /fs\.open\([^)]*,\s*"(?!r")|workspaces\.open\s*\(/,
    /\b(spawnProcess|execCommand|terminateProcess)\b/,
    /\bfs\.promises\.(write|append|mkdir|rm|unlink|rename)/,
  ];
  for (const id of IDS) {
    for (const [file, text] of sources(id)) {
      const code = text.replace(/^\s*\/\/.*$/gm, "");
      for (const re of forbidden) assert.doesNotMatch(code, re, `${file}: ${re}`);
    }
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
    describeItem: "swarm-map/server/describe.ts",
    batchFilePaths: "swarm-map/server/file-input.ts",
    FileLedger: "swarm-map/server/files.ts",
    swarmName: "swarm-map/server/group.ts",
    assignSlots: "swarm-map/client/geometry.ts",
    EventLog: "swarm-map/server/events.ts",
    parseFrontmatter: "planning-panel/server/frontmatter.ts",
    parseMarkdown: "planning-panel/client/markdown.ts",
    buildTree: "planning-panel/client/tree.ts",
    computeStats: "planning-panel/client/stats.ts",
    withAlpha: "planning-panel/client/color.ts",
    formatRelative: "planning-panel/client/format.ts",
    shortModel: "swarm-map/client/format.ts",
  };
  for (const [name, file] of Object.entries(named)) {
    assert.ok(tests.includes(`plugins/${file}`), `${file} not imported by a test`);
    assert.ok(new RegExp(`\\b${name}\\(|new ${name}\\(`).test(tests), `${name} not exercised`);
  }
});

test("PANL-09 the machine opt-in registers exactly these plugin folders, each ready for npm ci", async () => {
  const machine = path.join(KIT_DIR, "kit", "machine", "plugins.mjs");
  const { KIT_PLUGIN_FOLDERS } = await import(pathToFileURL(machine).href);
  assert.deepEqual([...KIT_PLUGIN_FOLDERS].sort(), IDS);
  for (const id of IDS) assert.ok(fs.existsSync(path.join(PLUGINS, id, "package-lock.json")));
  assert.ok(!fs.existsSync(path.join(PLUGINS, "backlog-plugin")), "no Backlog plugin ships");
});

test("PANL-10 the smoke script checks every SDK call the plugins use, read-only", () => {
  const smoke = fs.readFileSync(path.join(PLUGINS, "smoke.mjs"), "utf8");
  for (const call of ["agents.list(", "timeline.refetch(", ".refresh()", "workspaces.list(", "ref.current()", "ref.directory", "checkIcons("]) assert.ok(smoke.includes(call), call);
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
  const want = { "planning-panel": ["planning.board", "planning.file", "planning.index", "planning.plan"], "swarm-map": ["swarm.agent-detail", "swarm.snapshot"] };
  for (const id of IDS) {
    const root = path.join(PLUGINS, id);
    const bundles = await host.compilePlugin({ client: path.join(root, "index.client.tsx"), server: path.join(root, "index.server.ts") });
    assert.ok(bundles.clientBundle, `${id}: client bundle`);
    const server = fakeServer();
    const dispose = host.evaluateBundle(bundles.serverBundle)(server);
    assert.deepEqual([...server.handlers.keys()].sort(), want[id], id);
    dispose();
  }
});

test("PANL-14 the swarm map's frontmatter parser is the planning panel's, byte for byte", () => {
  const read = (id) => fs.readFileSync(path.join(PLUGINS, id, "server", "frontmatter.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(read("swarm-map"), read("planning-panel"), "copy plugins/planning-panel/server/frontmatter.ts to plugins/swarm-map/server/");
});
