// Prompt templates of the compositions (THIN.md item 2, kit feedback 87). A prompt that is a contract with a verb or a
// schema is kit text in `.agents/workflows/prompts/<name>.md`, shipped next to this module; a project adds its own
// templates as `project/<name>` in `.agents/workflows/prompts/project/` (never shipped). A kit name always reads the kit
// file: a project writes a new template instead of replacing a contract silently.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../../harness/lib/io.mjs";

export const PROMPTS_REL = ".agents/workflows/prompts";
export const KIT_PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));
const NAME = /^(project\/)?[a-z0-9][a-z0-9-]*$/;
const VAR = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const VALUE_TYPES = ["string", "number", "boolean"];

// {file, rel} of a template name; throws on a name that is not one.
export function templateFile(root, name) {
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`prompt name '${name}' must be <name> or project/<name> (lowercase letters, digits, -)`);
  const rel = `${PROMPTS_REL}/${name}.md`;
  return { rel, file: name.startsWith("project/") ? path.join(root, rel) : path.join(KIT_PROMPTS_DIR, `${name}.md`) };
}

// The prompt text of a template: CRLF read as LF (a Windows checkout gives the same prompt, so the same cache key),
// a leading `<!-- ... -->` comment (the template's contract notes) and one final line break are not part of it.
export function templateText(raw) {
  let t = String(raw).replace(/\r\n/g, "\n");
  if (t.startsWith("<!--")) {
    const end = t.indexOf("-->");
    if (end < 0) throw new Error("unterminated <!-- comment at the start of the template");
    t = t.slice(end + 3).replace(/^\n/, "");
  }
  return t.endsWith("\n") ? t.slice(0, -1) : t;
}

// Optional parts (THIN stage 2): `{{#name}}...{{/name}}` is kept when the value of name is true, a non-empty string or a
// non-zero number, `{{^name}}...{{/name}}` when it is not; a tag alone on its line takes its line break with it. Sections
// do not nest.
const BLOCK = /^\{\{([#^])([A-Za-z_][A-Za-z0-9_]*)\}\}\n([\s\S]*?)^\{\{\/\2\}\}(?:\n|$)/gm;
const INLINE = /\{\{([#^])([A-Za-z_][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const given = (vars, n) => Object.hasOwn(vars, n) && vars[n] !== null && vars[n] !== undefined;

// `{{name}}` -> the value, in one pass (a value is never expanded again). Every variable the text names (sections first:
// a variable only a dropped section names needs no value) needs a string, number or boolean value; lists and objects
// are formatted by the composition.
export function fillTemplate(text, vars) {
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) throw new Error("prompt variables must be a JSON object");
  const flags = [...new Set([...text.matchAll(BLOCK), ...text.matchAll(INLINE)].map((m) => m[2]))];
  const noFlag = flags.filter((n) => !given(vars, n));
  if (noFlag.length) throw new Error(`no value for ${noFlag.map((n) => `{{#${n}}}`).join(", ")}`);
  const badFlag = flags.filter((n) => !VALUE_TYPES.includes(typeof vars[n]));
  if (badFlag.length) throw new Error(`${badFlag.map((n) => `{{#${n}}}`).join(", ")} must be a string, number or boolean`);
  const on = (n) => vars[n] === true || (typeof vars[n] === "string" && vars[n] !== "") || (typeof vars[n] === "number" && vars[n] !== 0);
  const keep = (_, op, n, inner) => (on(n) === (op === "#") ? inner : "");
  const shaped = text.replace(BLOCK, keep).replace(INLINE, keep);
  const names = [...new Set([...shaped.matchAll(VAR)].map((m) => m[1]))];
  const missing = names.filter((n) => !given(vars, n));
  if (missing.length) throw new Error(`no value for ${missing.map((n) => `{{${n}}}`).join(", ")}`);
  const bad = names.filter((n) => !VALUE_TYPES.includes(typeof vars[n]));
  if (bad.length) throw new Error(`${bad.map((n) => `{{${n}}}`).join(", ")} must be a string, number or boolean`);
  const used = [...new Set([...flags, ...names])];
  return { text: shaped.replace(VAR, (_, n) => String(vars[n])), used, unused: Object.keys(vars).filter((k) => !used.includes(k)).sort() };
}

// Flow verb `prompt <name>` {vars} -> {name, path, text, unused}.
export function renderPrompt(root, name, vars = {}) {
  const { rel, file } = templateFile(root, name);
  if (!fs.existsSync(file)) throw new Error(`prompt template ${rel} not found`);
  try {
    const { text, unused } = fillTemplate(templateText(readText(file)), vars);
    return { name, path: rel, text, unused };
  } catch (e) {
    throw new Error(`prompt ${name}: ${e.message}`);
  }
}
