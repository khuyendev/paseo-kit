// Throwaway directories and projects for offline tests; every path contains a space (INV-52, INV-57).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const SHIP_DIR = path.join(KIT_DIR, "ship");

const created = [];
process.on("exit", () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

export function makeTempDir(prefix = "paseo kit ") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.error}`);
  return r.stdout.trim();
}

// The files ph needs at run time in a project: the runtime tree and the kit defaults.
export function installRuntime(root) {
  fs.cpSync(path.join(SHIP_DIR, ".agents", "harness"), path.join(root, ".agents", "harness"), { recursive: true });
  fs.copyFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), path.join(root, ".agents", "harness.defaults.json"));
}

export function makeTempProject({ git: withGit = true, files = {}, overlay, runtime = false } = {}) {
  const root = makeTempDir("paseo kit project ");
  const abs = (rel) => path.join(root, rel);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), text, "utf8");
  };
  const project = {
    root,
    path: abs,
    write,
    read: (rel) => fs.readFileSync(abs(rel), "utf8"),
    writeJson: (rel, value) => write(rel, `${JSON.stringify(value, null, 2)}\n`),
    readJson: (rel) => JSON.parse(fs.readFileSync(abs(rel), "utf8")),
    git: (...args) => git(root, ...args),
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  if (overlay !== undefined) project.writeJson(".agents/harness.config.json", overlay);
  if (runtime) installRuntime(root);
  if (withGit) {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "config", "user.name", "test");
    git(root, "config", "core.autocrlf", "false");
    git(root, "add", "-A");
    git(root, "commit", "-q", "--allow-empty", "-m", "initial");
  }
  return project;
}
