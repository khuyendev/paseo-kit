import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TRUSTED_FIXED } from "../../ship/.agents/harness/files/backend.mjs";
import { FILE_PLUGIN_ID, MIN_CLAUDE_VERSION } from "../../ship/.agents/harness/platform.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { installRuntime, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { TRUSTED_FIXED as DISCOVER_FIXED, discover, trustedSet } from "../../ship/.claude/plugins/harness-files/scripts/discover.mjs";

const PLUGIN_SRC = path.join(SHIP_DIR, ".claude", "plugins", "harness-files");
const DISCOVER = path.join(PLUGIN_SRC, "scripts", "discover.mjs");

function project({ manifest = true } = {}) {
  const root = makeTempDir("paseo kit project ");
  installRuntime(root);
  if (manifest) writeManifest(root);
  return root;
}
function writeManifest(root, edit = (files) => files) {
  const files = {};
  for (const rel of trustedSet(root)) files[rel] = textDigest(fs.readFileSync(path.join(root, rel), "utf8"));
  fs.writeFileSync(path.join(root, ".agents/harness-kit.json"), JSON.stringify({ version: "0.0.1", files: edit(files) }, null, 2));
}
const cachePlugin = () => {
  const dir = path.join(makeTempDir("paseo kit cache "), "a", "b", "harness-files");
  fs.cpSync(PLUGIN_SRC, dir, { recursive: true });
  return dir;
};

test("FTOL-05 the trusted set equals the backend's static imports plus its own modules", () => {
  assert.deepEqual(DISCOVER_FIXED, [...TRUSTED_FIXED]);
  const harness = path.join(SHIP_DIR, ".agents", "harness");
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of fs.readFileSync(file, "utf8").matchAll(/^import [^;]*?from "(\.[^"]+)"/gm)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(harness, "files", "backend.mjs"));
  const rel = (f) => path.relative(path.dirname(harness), f).split(path.sep).join("/");
  const imported = [...seen].map((f) => `.agents/${rel(f)}`).sort();
  const own = fs.readdirSync(path.join(harness, "files")).filter((n) => n.endsWith(".mjs")).map((n) => `.agents/harness/files/${n}`);
  const expected = [...TRUSTED_FIXED.filter((r) => r.endsWith(".mjs")), ...own].sort();
  assert.deepEqual(imported, expected);
  assert.ok(fs.readFileSync(path.join(harness, "config.mjs"), "utf8").includes("harness.defaults.json"));
});

test("FTOL-05 an installed project's backend is found from a deep cwd and verified", () => {
  const root = project();
  const deep = path.join(root, "deep", "child");
  fs.mkdirSync(deep, { recursive: true });
  const found = discover("", deep, cachePlugin());
  assert.equal(found.backend, path.join(root, ".agents/harness/files/backend.mjs"));
  const r = spawnSync(process.execPath, [DISCOVER, "", deep, cachePlugin()], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).backend, found.backend);
});

test("FTOL-05 manifest problems and modified or untracked backend files fail closed", () => {
  const plugin = cachePlugin();
  const root = project();
  const fail = (re) => assert.throws(() => discover("", root, plugin), re);
  discover("", root, plugin);
  fs.appendFileSync(path.join(root, ".agents/harness/files/edit.mjs"), "\n// edited\n");
  fail(/harness backend differs from installed marker: \.agents\/harness\/files\/edit\.mjs/);
  writeManifest(root);
  fs.writeFileSync(path.join(root, ".agents/harness/files/extra.mjs"), "export {};\n");
  fail(/harness backend file not in installed marker: \.agents\/harness\/files\/extra\.mjs/);
  fs.rmSync(path.join(root, ".agents/harness/files/extra.mjs"));
  writeManifest(root, () => ({}));
  fail(/not in installed marker: \.agents\/harness\/config\.mjs/);
  writeManifest(root, (f) => { delete f[".agents/harness/files/backend.mjs"]; return f; });
  fail(/not in installed marker: \.agents\/harness\/files\/backend\.mjs/);
  writeManifest(root, (f) => { delete f[".agents/harness/config.mjs"]; return f; });
  fail(/not in installed marker: \.agents\/harness\/config\.mjs/);
  fs.writeFileSync(path.join(root, ".agents/harness-kit.json"), "{not json");
  fail(/harness install marker unreadable/);
  fs.writeFileSync(path.join(root, ".agents/harness-kit.json"), JSON.stringify({ files: {} }));
  fail(/harness install marker unreadable/);
  writeManifest(root);
  fs.writeFileSync(path.join(root, ".agents/harness/files/test_helper.mjs"), "x");
  assert.ok(discover("", root, plugin).backend);
});

test("FTOL-05 without a manifest only the plugin's own source project is trusted; no backend gives the not-found text", () => {
  const root = project({ manifest: false });
  assert.throws(() => discover("", root, cachePlugin()), /harness backend lacks trusted install marker/);
  const own = path.join(root, ".claude", "plugins", "harness-files");
  fs.cpSync(PLUGIN_SRC, own, { recursive: true });
  assert.equal(discover("", path.join(root), own).backend, path.join(root, ".agents/harness/files/backend.mjs"));
  const empty = makeTempDir("paseo kit empty ");
  assert.throws(() => discover("", empty, cachePlugin()), /harness-files backend not found: install project assets or set PASEO_HARNESS_ROOT/);
  const other = project();
  assert.equal(discover(other, empty, cachePlugin()).backend, path.join(other, ".agents/harness/files/backend.mjs"));
});

test("FTOL-05 every discovery re-reads the manifest and the digests; no earlier result is reused", () => {
  const plugin = cachePlugin();
  const root = project();
  discover("", root, plugin);
  const manifest = path.join(root, ".agents/harness-kit.json");
  const files = JSON.parse(fs.readFileSync(manifest, "utf8")).files;
  fs.writeFileSync(manifest, JSON.stringify({ version: "0.0.1", files: { bogus: "x" } }));
  assert.throws(() => discover("", root, plugin), /not in installed marker: \.agents\/harness\/config\.mjs/);
  fs.writeFileSync(manifest, JSON.stringify({ version: "0.0.1", files }));
  assert.equal(discover("", root, plugin).backend, path.join(root, ".agents/harness/files/backend.mjs"));
});

test("FTOL-04 the three plugin JSON files parse and reference each other", () => {
  const plugins = path.join(SHIP_DIR, ".claude", "plugins");
  const market = JSON.parse(fs.readFileSync(path.join(plugins, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(market.name, "paseo-harness-kit");
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["harness-files", "./harness-files"]]);
  const plugin = JSON.parse(fs.readFileSync(path.join(plugins, "harness-files", ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(plugin.name, "harness-files");
  const hooks = JSON.parse(fs.readFileSync(path.join(plugins, "harness-files", "hooks", "hooks.json"), "utf8"));
  assert.deepEqual(hooks, { modules: ["./register.ts"] });
  assert.ok(fs.existsSync(path.join(plugins, "harness-files", "hooks", "register.ts")));
  const src = fs.readFileSync(path.join(plugins, "harness-files", "hooks", "register.ts"), "utf8");
  assert.doesNotMatch(src, /from ['"]node:|require\(|\bfs\.|readFile|writeFile/);
  assert.equal(FILE_PLUGIN_ID, `${plugin.name}@${market.name}`);
  assert.equal(MIN_CLAUDE_VERSION, "2.1.296");
});

test("FTOL-05 discovery script is self-contained (no project import)", () => {
  const src = fs.readFileSync(DISCOVER, "utf8");
  for (const m of src.matchAll(/^import .* from "([^"]+)"/gm)) assert.match(m[1], /^node:/);
});
