// Budget test helper of the default composition (THIN.md item 4): the line count of a composition script (comments
// included) and the helpers it defines although the workflow engine provides them as globals.
import fs from "node:fs";
import path from "node:path";
import { KIT_HELPER_NAMES } from "../../ship/.agents/harness/workflow/script.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";

export const WORKFLOWS_DIR = path.join(SHIP_DIR, ".agents", "workflows");
export const COMPOSITION_LINE_BUDGET = 700;

// A top-level declaration (column 0) of a helper name; a local of the same name inside a function only shadows it there.
const DEFINITION = new RegExp(`^(?:export\\s+)?(?:(?:const|let|var)\\s+(${KIT_HELPER_NAMES.join("|")})\\s*=|(?:async\\s+)?function\\s*\\*?\\s*(${KIT_HELPER_NAMES.join("|")})\\s*\\()`, "gm");

// {file, lines, helperDefinitions: [{name, line}]}; a reassignment (`call = ...`) is no definition.
export function compositionBudget(file) {
  const abs = path.isAbsolute(file) ? file : path.join(WORKFLOWS_DIR, file);
  const text = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  const helperDefinitions = [...text.matchAll(DEFINITION)].map((m) => ({ name: m[1] ?? m[2], line: text.slice(0, m.index).split("\n").length }));
  return { file: path.basename(abs), lines, helperDefinitions };
}

export const compositionScripts = () => fs.readdirSync(WORKFLOWS_DIR).filter((f) => /^gsd-.*\.js$/.test(f)).sort();
