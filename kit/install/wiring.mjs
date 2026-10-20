// The untracked wiring steps of install and update, run in this order before the manifest is written (INST-18).
import fs from "node:fs";
import path from "node:path";
import { readText, writeTextAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { errText } from "../../ship/.agents/harness/lib/cli.mjs";
import { KitFailure } from "./failure.mjs";
import { reconcileHooks } from "./hooks.mjs";
import { activateMod } from "./mod.mjs";
import { addImport, putGitignoreBlock } from "./text.mjs";

const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

function ensureImport(ctx) {
  const file = path.join(ctx.project, "CLAUDE.md");
  const next = addImport(readIf(file));
  if (next == null) ctx.out("CLAUDE.md already imports AGENTS.md");
  else {
    writeTextAtomic(file, next);
    ctx.out("CLAUDE.md: added @AGENTS.md");
  }
  return 0;
}

function ensureGitignore(ctx) {
  const file = path.join(ctx.project, ".gitignore");
  const text = readIf(file);
  const next = putGitignoreBlock(text);
  if (next !== text) {
    writeTextAtomic(file, next);
    ctx.out(".gitignore: kit block written");
  }
  return 0;
}

// Project-owned seeds: created where missing, never read, recorded or overwritten (INST-17, INST-22).
export const SEEDS = [
  { rel: ".agents/harness.config.json", template: "harness.config.json" },
  { rel: ".agents/harness-history.md", template: "harness-history.md" },
];

function createSeeds(ctx) {
  for (const seed of SEEDS) {
    const file = path.join(ctx.project, seed.rel);
    if (fs.existsSync(file)) continue;
    writeTextAtomic(file, readText(path.join(ctx.kit.templatesDir, seed.template)));
    ctx.out(`created ${seed.rel}`);
  }
  const planning = path.join(ctx.project, ".planning");
  if (!fs.existsSync(planning)) {
    fs.mkdirSync(planning);
    ctx.out("created .planning/");
  }
  return 0;
}

export const WIRING = [
  { name: "hook reconcile", run: reconcileHooks },
  { name: "mod activation", run: activateMod },
  { name: "CLAUDE.md import", run: ensureImport },
  { name: ".gitignore block", run: ensureGitignore },
  { name: "seeds", run: createSeeds },
];

// Returns the number of problems left (blocked hooks); a throwing step fails the command naming the step.
export function wire(ctx, steps = WIRING) {
  let problems = 0;
  for (const step of steps) {
    try {
      problems += step.run(ctx) ?? 0;
    } catch (e) {
      throw new KitFailure(`${step.name}: ${errText(e)}`);
    }
  }
  return problems;
}
