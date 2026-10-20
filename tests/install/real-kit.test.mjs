import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { HELP } from "../../kit/install/help.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { runNode, runPhProcess } from "../helpers/run.mjs";
import { KIT_DIR, makeProject, SHIP_DIR, testEnv } from "./helpers.mjs";

function grepTree(dir, needles) {
  const hits = [];
  const walk = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, e.name);
      if (e.isDirectory()) walk(child);
      else {
        const text = fs.readFileSync(child, "utf8").toLowerCase();
        if (needles.some((n) => text.includes(n.toLowerCase()))) hits.push(child);
      }
    }
  };
  walk(dir);
  return hits;
}

test("INST-25 a project installed from a kit copy runs ph with the kit folder gone and holds no kit path", () => {
  const kitCopy = path.join(makeTempDir("paseo kit copy "), "paseo kit");
  for (const rel of ["kit.json", "kit.mjs", "package.json", "kit", "ship"]) fs.cpSync(path.join(KIT_DIR, rel), path.join(kitCopy, rel), { recursive: true });
  const p = makeProject();
  const env = testEnv();
  const r = runNode(path.join(kitCopy, "kit.mjs"), ["install", p.root], { env });
  assert.ok(r.code === 0 || r.code === 2, r.stdout + r.stderr);
  assert.match(r.out.at(-1), /^installed paseo-kit /);
  fs.rmSync(kitCopy, { recursive: true, force: true });
  const cfg = runPhProcess(p.root, ["config"], { env: { ...env, PASEO_HARNESS_ROOT: p.root } });
  assert.equal(cfg.code, 0, cfg.stderr);
  const shown = JSON.parse(cfg.stdout);
  delete shown._provenance;
  assert.deepEqual(shown, loadKitConfig());
  const unknown = runPhProcess(p.root, ["skills-sync"], { env: { ...env, PASEO_HARNESS_ROOT: p.root } });
  assert.equal(unknown.code, 1);
  assert.deepEqual(grepTree(p.root, [kitCopy, toSlash(kitCopy), KIT_DIR.replace(/[\\/]$/, ""), toSlash(KIT_DIR).replace(/\/$/, "")]), []);
});

test("INST-28 kit help states verbs, requirements, ownership, --force limits, the 0.1.0 upgrade and the MCP removal", () => {
  const text = HELP.join("\n");
  for (const needle of [
    "install|update|status <project> [--force] [--enable-plugin]",
    "pull <project> [<part>...] [--force] [--kit DIR]",
    "Node 20.17+", "Claude Code >= 2.1.296", "Paseo CLI with a running daemon", "Git",
    ".agents/harness.config.json", ".agents/harness-history.md", ".planning/", ".agents/harness-kit.json", ".claude/settings.json",
    "install never edits Paseo settings", "machine apply carries the provider deny rules",
    "--force never overrides", "removed-local", "version gates",
    "move .agents/harness-kit.json aside",
    "claude mcp remove --scope user fsbatch", "claude mcp remove --scope user filesystem",
  ]) assert.ok(text.includes(needle), needle);
  assert.doesNotMatch(text, /backlog|codex|opencode/i);
});

test("HARN-14 the shipped AGENTS.md block carries the always-loaded rules and stays small", () => {
  const block = fs.readFileSync(path.join(SHIP_DIR, "blocks", "AGENTS.md"), "utf8");
  for (const anchor of [
    "Batch reads and edits with the available file tools",
    "Do not re-read a file solely to verify a successful write",
    "Correctness takes priority over fewer tool calls",
    "derive a Definition of Done",
    "Never hand-roll polling",
    "Follow the printed `next:` command and end the turn while waiting",
    "Never retry quota, credit, billing, auth or permission failures",
    "Never fabricate a stopped agent's judgment",
    "Use only verified facts",
    "Fix the product, not the fixture",
    "preflight 2-3 items through every stage",
    "Scripts own mechanical bookkeeping",
    "Pass paths, not content",
    "Clean up only what you created",
    "`[UNVERIFIED]`",
    "Write long documents in parts",
    "A worker never messages the main session",
  ]) assert.ok(block.includes(anchor), anchor);
  assert.ok(Buffer.byteLength(block) < 3000);
  assert.doesNotMatch(block, /PASEO-HARNESS-KIT/);
});
