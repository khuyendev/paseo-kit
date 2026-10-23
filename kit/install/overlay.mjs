// update's overlay check (F62): the gsd workflows' argument checks on the merged config, and the overlay keys the kit
// CHANGELOG names in entries newer than the installed version. It runs after the kit parts are written, so it reads the
// config the next run reads. Kit-side only: the CHANGELOG is not installed into projects.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, OVERLAY_REL } from "../../ship/.agents/harness/config.mjs";
import { workflowArgProblems } from "../../ship/.agents/harness/gsd/workflow-args.mjs";
import { ConfigError } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { readJsonIf } from "../../ship/.agents/harness/lib/io.mjs";

const SECTION = /^## \[([^\]]+)\]/;
const DOTTED_KEY = /`([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+)`/g;

// Dotted path of every key in an overlay object; arrays are leaves; `_`-prefixed notes are skipped.
export function overlayPaths(obj, prefix = "") {
  const out = [];
  for (const [name, value] of Object.entries(obj)) {
    if (name.startsWith("_")) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    out.push(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(...overlayPaths(value, key));
  }
  return out;
}

// The overlay keys a CHANGELOG names in the sections above the installed version's header (every section when that
// header is missing). [Unreleased] always counts: the CHANGELOG does not record which of its entries the install has.
export function changedOverlayKeys(changelog, installedVersion, overlay) {
  const sections = [];
  for (const line of changelog.split(/\r?\n/)) {
    const m = SECTION.exec(line);
    if (m) sections.push({ name: m[1], text: "" });
    else if (sections.length) sections.at(-1).text += `${line}\n`;
  }
  const at = sections.findIndex((s) => s.name === installedVersion);
  const newer = at === -1 ? sections : sections.slice(0, at);
  const paths = new Set(overlayPaths(overlay));
  const named = new Map();
  for (const s of newer) {
    for (const m of s.text.matchAll(DOTTED_KEY)) {
      if (paths.has(m[1])) named.set(m[1], [...(named.get(m[1]) ?? []), s.name]);
    }
  }
  return [...named].map(([key, names]) => ({ key, sections: [...new Set(names)] }));
}

// Prints the refused overlay values and the changed keys; returns how many values the next run would refuse.
export function overlayLines(ctx, installedVersion) {
  let cfg;
  try {
    cfg = loadConfig(ctx.project);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    ctx.out(`note workflow arguments not checked: ${e.message} (ph doctor names it)`);
    return 0;
  }
  const problems = workflowArgProblems(cfg);
  for (const p of problems) ctx.out(`problem ${p}`);
  const changelog = path.join(ctx.kit.dir, "CHANGELOG.md");
  if (fs.existsSync(changelog)) {
    const overlay = readJsonIf(path.join(ctx.project, OVERLAY_REL), {});
    for (const { key, sections } of changedOverlayKeys(fs.readFileSync(changelog, "utf8"), installedVersion, overlay)) {
      const where = sections.map((s) => `[${s}]`).join(", ");
      ctx.out(`warning overlay key ${key}: the CHANGELOG names it in ${where} (since ${installedVersion}); check its value still means what you set`);
    }
  }
  return problems.length;
}
