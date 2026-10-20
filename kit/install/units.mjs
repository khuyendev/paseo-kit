// The shipped units: files kit.json lists (paths relative to ship/) plus one block unit per file in ship/blocks/ (INST-03).
import fs from "node:fs";
import path from "node:path";
import { readJson, readText, writeJsonAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { fileDigest, textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { isMain } from "../../ship/.agents/harness/lib/cli.mjs";
import { fileURLToPath } from "node:url";
import { fail, KitFailure } from "./failure.mjs";

export const BLOCK_SUFFIX = "#paseo-harness-kit";
export const KIT_SIDE_DIRS = ["blocks", "templates"];
export const HOOK_TEMPLATE_REL = "templates/settings.hooks.json";

const TEST_SEGMENTS = new Set(["tests", "__tests__", "node_modules"]);
const TEST_FILE = /\.(test|spec)\.(mjs|cjs|js|ts|mts|cts|jsx|tsx)$/;

export function isTestPath(rel) {
  const parts = rel.split("/");
  const base = parts.at(-1);
  return parts.some((p) => TEST_SEGMENTS.has(p)) || base.startsWith("test_") || TEST_FILE.test(base);
}

export const isBlockKey = (key) => key.endsWith(BLOCK_SUFFIX);
export const blockFileOf = (key) => key.slice(0, -BLOCK_SUFFIX.length);

// Every file under ship/ that would be installed (kit-side blocks/ and templates/ excluded), forward-slash and sorted.
export function listShipFiles(kitDir) {
  const ship = path.join(kitDir, "ship");
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && KIT_SIDE_DIRS.includes(entry.name)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile() && !isTestPath(childRel)) out.push(childRel);
    }
  };
  walk(ship, "");
  return out.sort(byCodePoint);
}

export const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function checkListed(kitDir, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || path.isAbsolute(rel) || rel.split("/").some((p) => p === ".." || p === "." || p === "")) {
    fail(`kit.json lists an invalid unit path: ${JSON.stringify(rel)}`);
  }
  if (KIT_SIDE_DIRS.includes(rel.split("/")[0])) fail(`kit.json lists a kit-side file: ${rel}`);
  if (isTestPath(rel)) fail(`kit.json lists a test file: ${rel}`);
  if (!fs.statSync(path.join(kitDir, "ship", rel), { throwIfNoEntry: false })?.isFile()) fail(`kit.json lists a missing file: ${rel}`);
}

// Script names a hook template registers: `command` hooks referencing `.claude/hooks/<name>.mjs` (HOOK-02).
export function templateScripts(template) {
  const names = new Set();
  for (const groups of Object.values(template?.hooks ?? {})) {
    for (const group of groups ?? []) for (const hook of group?.hooks ?? []) {
      const name = hookScript(hook);
      if (name) names.add(name);
    }
  }
  return names;
}

export function hookScript(hook) {
  if (hook?.type !== "command" || typeof hook.command !== "string") return null;
  return /\.claude[\\/]hooks[\\/]([^\\/"'\s]+)\.mjs/.exec(hook.command)?.[1] ?? null;
}

export const hookUnitKey = (name) => `.claude/hooks/${name}.mjs`;

// Loads and self-checks a kit folder: {dir, version, units: Map key -> unit, template}.
export function loadKit(kitDir) {
  const manifestFile = path.join(kitDir, "kit.json");
  if (!fs.existsSync(manifestFile)) fail(`${kitDir} is not a paseo-kit folder (no kit.json)`);
  let kitJson;
  try {
    kitJson = readJson(manifestFile);
  } catch (e) {
    throw new KitFailure(e.message);
  }
  if (typeof kitJson.version !== "string" || !Array.isArray(kitJson.units)) fail("kit.json needs a version string and a units list");
  const units = new Map();
  for (const rel of kitJson.units) {
    checkListed(kitDir, rel);
    units.set(rel, { key: rel, kind: "file", rel, src: path.join(kitDir, "ship", rel) });
  }
  const blocksDir = path.join(kitDir, "ship", "blocks");
  for (const entry of fs.existsSync(blocksDir) ? fs.readdirSync(blocksDir, { withFileTypes: true }) : []) {
    if (!entry.isFile()) continue;
    const key = `${entry.name}${BLOCK_SUFFIX}`;
    units.set(key, { key, kind: "block", rel: entry.name, src: path.join(blocksDir, entry.name) });
  }
  const templateFile = path.join(kitDir, "ship", HOOK_TEMPLATE_REL);
  const template = fs.existsSync(templateFile) ? readJson(templateFile) : { hooks: {} };
  for (const name of templateScripts(template)) {
    if (!units.has(hookUnitKey(name))) fail(`${HOOK_TEMPLATE_REL} names ${hookUnitKey(name)}, which kit.json does not list`);
  }
  return { dir: kitDir, version: kitJson.version, units, template, templatesDir: path.join(kitDir, "ship", "templates") };
}

export const shippedBlockBody = (unit) => readText(unit.src).trim();

export const kitDigest = (unit) => (unit.kind === "block" ? textDigest(shippedBlockBody(unit)) : fileDigest(unit.src));

// Release helper: `node kit/install/units.mjs --write` sets kit.json units to every shippable file under ship/.
if (isMain(import.meta.url)) {
  const kitDir = fileURLToPath(new URL("../../", import.meta.url));
  const files = listShipFiles(kitDir);
  if (process.argv.includes("--write")) {
    const file = path.join(kitDir, "kit.json");
    writeJsonAtomic(file, { ...readJson(file), units: files });
    console.log(`kit.json: ${files.length} unit(s)`);
  } else {
    for (const rel of files) console.log(rel);
  }
}
