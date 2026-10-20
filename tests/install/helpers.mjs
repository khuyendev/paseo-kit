// Fixture kits, projects and an in-process kit runner for the install suite (INST-29: temp dirs with spaces, fake CLIs).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../kit/install/index.mjs";
import { listShipFiles } from "../../kit/install/units.mjs";
import { testEnv } from "../helpers/env.mjs";
import { KIT_DIR, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

export const FAKE_CLAUDE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
export const BLOCK_KEY = "AGENTS.md#paseo-harness-kit";

export const HOOKS = ["io_guard", "context_guard", "bash_long_command", "syntax_check"];

// A small kit: the real templates, a hook script per template entry, a skill, the mod assets and one block.
export function defaultKitFiles() {
  const files = {
    ".agents/harness/runtime/a.mjs": "export const a = 1;\n",
    ".claude/skills/demo/SKILL.md": "---\nname: demo\n---\nDemo skill.\n",
    ".claude/plugins/.claude-plugin/marketplace.json": '{"name":"paseo-harness-kit","plugins":[{"name":"harness-files","source":"./harness-files"}]}\n',
    ".claude/plugins/harness-files/.claude-plugin/plugin.json": '{"name":"harness-files"}\n',
    ".claude/plugins/harness-files/register.ts": "export default {};\n",
  };
  for (const name of HOOKS) files[`.claude/hooks/${name}.mjs`] = `// ${name}\n`;
  return files;
}

const writeFile = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

export function makeKit({ files = defaultKitFiles(), blocks = { "AGENTS.md": "## Kit rules\n\n- rule one\n" }, version = "1.0.0", units, template } = {}) {
  const dir = makeTempDir("paseo kit src ");
  const kit = {
    dir,
    ship: (rel) => path.join(dir, "ship", rel),
    write: (rel, text) => writeFile(kit.ship(rel), text),
    read: (rel) => fs.readFileSync(kit.ship(rel), "utf8"),
    remove: (rel) => fs.rmSync(kit.ship(rel)),
    setUnits: (list, v = version) => writeFile(path.join(dir, "kit.json"), `${JSON.stringify({ name: "paseo-kit", version: v, units: list }, null, 2)}\n`),
    sync: (v = version) => kit.setUnits(listShipFiles(dir), v),
  };
  for (const [rel, text] of Object.entries(files)) kit.write(rel, text);
  fs.cpSync(path.join(SHIP_DIR, "templates"), kit.ship("templates"), { recursive: true });
  if (template) kit.write("templates/settings.hooks.json", JSON.stringify(template, null, 2));
  for (const [name, text] of Object.entries(blocks)) kit.write(`blocks/${name}`, text);
  kit.setUnits(units ?? Object.keys(files).sort());
  return kit;
}

export function makeProject(files = {}) {
  const root = makeTempDir("paseo kit project ");
  const p = {
    root,
    path: (rel) => path.join(root, rel),
    write: (rel, text) => writeFile(p.path(rel), text),
    read: (rel) => fs.readFileSync(p.path(rel), "utf8"),
    bytes: (rel) => fs.readFileSync(p.path(rel)),
    exists: (rel) => fs.existsSync(p.path(rel)),
    json: (rel) => JSON.parse(p.read(rel)),
    manifest: () => p.json(".agents/harness-kit.json"),
  };
  for (const [rel, text] of Object.entries(files)) p.write(rel, text);
  return p;
}

const lines = (text) => text.split("\n").filter((l, i, all) => l !== "" || i < all.length - 1);

// Runs a kit verb in-process; `kit` is the running kit (default: the fixture's folder).
export async function runKit(argv, { kit, env = testEnv(), now } = {}) {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    out: (line) => (stdout += `${line}\n`),
    err: (line) => (stderr += `${line}\n`),
    env,
    kitDir: kit?.dir ?? kit ?? KIT_DIR,
    now,
  });
  return { code, stdout, stderr, out: lines(stdout), err: lines(stderr) };
}

// Environment with the fake Claude CLI and its log; `vars` sets FAKE_* switches.
export function claudeEnv(vars = {}, cli = FAKE_CLAUDE) {
  const log = path.join(makeTempDir("paseo kit log "), "claude log.jsonl");
  const env = testEnv({ CLAUDE_CLI: cli, FAKE_CLAUDE_LOG: log, ...vars });
  return { env, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []) };
}

// Digest of every path, byte and mtime under a folder: equal before and after = nothing written.
export function treeHash(dir) {
  const h = crypto.createHash("sha256");
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      const st = fs.statSync(childAbs);
      h.update(`${childRel}\0${st.mtimeMs}\0`);
      if (entry.isDirectory()) walk(childAbs, childRel);
      else h.update(fs.readFileSync(childAbs));
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

// Paths of the owner's live configuration that no test may touch (INST-29 guard).
export const LIVE_CONFIG_DIRS = [".claude", ".claude-circle", ".paseo"].map((d) => path.join(os.homedir(), d));

export { KIT_DIR, SHIP_DIR, testEnv };
