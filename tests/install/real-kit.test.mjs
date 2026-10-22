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

// Owner decision 2026-10-22: the block keeps only rules nothing else enforces. File I/O is restated by the io guard hook
// (HOOK-24), waiting and retries by ph's next: lines, the ph skill and NEVER_RETRY, prompt size by max_prompt_bytes,
// worker messaging by the worker deny list and first_prompt_note, preflight by the harness skill.
test("HARN-14 the shipped AGENTS.md block carries only the unenforced always-loaded rules and stays small", () => {
  const block = fs.readFileSync(path.join(SHIP_DIR, "blocks", "AGENTS.md"), "utf8");
  for (const anchor of [
    "**Blocked on me**",
    "**Changed**",
    "**Found**",
    "A worker's final reply follows the format its prompt asks for",
    "`[UNVERIFIED]` and say where you looked",
    "When an agent stops without a reply, say so",
    "Fix the product, not the fixture",
    "Clean up only what you created",
    "never edit those by hand",
  ]) assert.ok(block.includes(anchor), anchor);
  for (const gone of ["## File I/O", "Definition of Done", "## Agents and waiting", "Never hand-roll polling", "Pass paths, not content"]) assert.ok(!block.includes(gone), gone);
  assert.ok(Buffer.byteLength(block) < 1500);
  assert.doesNotMatch(block, /PASEO-HARNESS-KIT/);
});
