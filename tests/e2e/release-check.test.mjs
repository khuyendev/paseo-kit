// HARN-15: the release check (CHANGELOG section vs kit.json version; prompt-text commits need a CHANGELOG line).
import { test } from "node:test";
import assert from "node:assert/strict";
import { commitProblems, isPromptFile, releaseCheck, versionProblems } from "../../kit/release-check.mjs";
import { makeTempProject } from "../helpers/temp.mjs";

test("HARN-15 the shipped CHANGELOG matches kit.json and keeps an Unreleased section", () => {
  assert.deepEqual(releaseCheck(), []);
});

test("HARN-15 a version mismatch, a missing Unreleased section or an undated release fails", () => {
  assert.deepEqual(versionProblems("0.0.2", "## [Unreleased]\n\n## [0.0.1] - 2026-10-20\n"), ["top released CHANGELOG section 0.0.1 != kit.json version 0.0.2"]);
  assert.deepEqual(versionProblems("0.0.1", "## [0.0.1] - 2026-10-20\n"), ["CHANGELOG.md has no ## [Unreleased] section"]);
  assert.deepEqual(versionProblems("0.0.1", "## [Unreleased]\n## [0.0.1]\n"), ["CHANGELOG section 0.0.1 has no date"]);
});

test("HARN-15 a commit touching shipped prompt files without a CHANGELOG line fails; with one it passes", () => {
  assert.ok(isPromptFile("ship/blocks/AGENTS.md") && isPromptFile("ship/.claude/skills/ph/SKILL.md") && isPromptFile("ship/.agents/harness/workflow/watchdog.mjs"));
  assert.ok(!isPromptFile("ship/.agents/harness/ph.mjs"));
  const p = makeTempProject({ git: true, files: { "kit.json": JSON.stringify({ version: "0.0.1" }), "CHANGELOG.md": "## [Unreleased]\n\n## [0.0.1] - 2026-10-20\n" } });
  const base = p.git("rev-parse", "HEAD").trim();
  p.write("ship/blocks/AGENTS.md", "rule\n");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "prompt change");
  const bad = releaseCheck({ kitDir: p.root, range: `${base}..HEAD` });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /changes shipped prompt text \(ship\/blocks\/AGENTS\.md\) without a CHANGELOG\.md line$/);
  const mid = p.git("rev-parse", "HEAD").trim();
  p.write("ship/blocks/AGENTS.md", "rule 2\n");
  p.write("CHANGELOG.md", "## [Unreleased]\n\n- rule 2 (owner approval 2026-10-20)\n\n## [0.0.1] - 2026-10-20\n");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "prompt change with changelog");
  assert.deepEqual(releaseCheck({ kitDir: p.root, range: `${mid}..HEAD` }), []);
  assert.deepEqual(commitProblems([{ sha: "abcdef0123", files: ["ship/.agents/harness/ph.mjs"] }]), []);
});
