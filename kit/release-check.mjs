#!/usr/bin/env node
// Release check (HARN-15): the top released CHANGELOG section equals kit.json's version, the CHANGELOG keeps an
// Unreleased section, and every commit in the range that touches shipped prompt text also touches CHANGELOG.md.
// usage: node kit/release-check.mjs [<git revision range>]   (no range: only the version and section checks)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, readText } from "../ship/.agents/harness/lib/io.mjs";
import { isMain } from "../ship/.agents/harness/lib/cli.mjs";

const KIT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Shipped prompt text: the AGENTS.md block, skill texts, agent definitions and overlays, workflow lenses and overlays,
// and the watchdog steering texts.
const PROMPT_FILE = [
  /^ship\/blocks\/AGENTS\.md$/,
  /^ship\/\.claude\/skills\/.+\.md$/,
  /^ship\/\.agents\/agents\/.+\.md$/,
  /^ship\/\.agents\/gsd\/overlays\/.+\.md$/,
  /^ship\/\.agents\/workflows\/.+\.md$/,
  /^ship\/\.agents\/harness\/workflow\/watchdog\.mjs$/,
];
export const isPromptFile = (rel) => PROMPT_FILE.some((re) => re.test(rel));

// `## [Unreleased]` and `## [x.y.z] - YYYY-MM-DD` headings, top first.
export function changelogSections(text) {
  return [...String(text).matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/gm)].map((m) => ({ name: m[1], date: m[2] ?? null }));
}

export function versionProblems(version, changelog) {
  const sections = changelogSections(changelog);
  const problems = [];
  if (!sections.some((s) => s.name === "Unreleased")) problems.push("CHANGELOG.md has no ## [Unreleased] section");
  const released = sections.find((s) => s.name !== "Unreleased");
  if (!released) problems.push("CHANGELOG.md has no released section");
  else {
    if (released.name !== version) problems.push(`top released CHANGELOG section ${released.name} != kit.json version ${version}`);
    if (!released.date) problems.push(`CHANGELOG section ${released.name} has no date`);
  }
  return problems;
}

// commits: [{sha, files: [repo-relative paths]}]
export function commitProblems(commits) {
  return commits
    .filter((c) => c.files.some(isPromptFile) && !c.files.includes("CHANGELOG.md"))
    .map((c) => `commit ${c.sha.slice(0, 8)} changes shipped prompt text (${c.files.filter(isPromptFile).slice(0, 3).join(", ")}) without a CHANGELOG.md line`);
}

export function commitsOf(range, cwd = KIT_DIR) {
  const r = spawnSync("git", ["log", "--format=%x00%H", "--name-only", range], { cwd, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git log ${range}: ${String(r.stderr).trim().split("\n")[0]}`);
  return r.stdout.split("\0").filter((b) => b.trim()).map((block) => {
    const [sha, ...files] = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { sha, files };
  });
}

export function releaseCheck({ kitDir = KIT_DIR, range } = {}) {
  const version = readJson(path.join(kitDir, "kit.json")).version;
  const problems = versionProblems(version, readText(path.join(kitDir, "CHANGELOG.md")));
  if (range) problems.push(...commitProblems(commitsOf(range, kitDir)));
  return problems;
}

if (isMain(import.meta.url)) {
  try {
    const problems = releaseCheck({ range: process.argv[2] });
    for (const p of problems) console.log(`problem ${p}`);
    console.log(problems.length ? `release check: ${problems.length} problem(s)` : "release check: ok");
    process.exitCode = problems.length ? 2 : 0;
  } catch (e) {
    console.error(`failed: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exitCode = 1;
  }
}
