// update's overlay check (F62): the gsd workflows' argument checks on the merged config, and the overlay keys the kit
// CHANGELOG names in entries newer than the installed version. It runs after the kit parts are written, so it reads the
// config the next run reads. Kit-side only: the CHANGELOG is not installed into projects.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, OVERLAY_REL } from "../../ship/.agents/harness/config.mjs";
import { workflowArgProblems } from "../../ship/.agents/harness/gsd/workflow-args.mjs";
import { ConfigError } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { readJsonIf } from "../../ship/.agents/harness/lib/io.mjs";
import { sha256 } from "../../ship/.agents/harness/lib/hash.mjs";

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

// Kit feedback 96: the adapter and gsd keys the kit defaults gained since the project's adapter was last written, that
// the overlay leaves at their default. The baseline is the default keys the project had installed when its overlay's
// adapter and gsd sections last changed: the manifest's `adapter` record {overlay: digest of those sections, keys} while
// they are unchanged, else the defaults installed before this update (read before the copy). Kit-side only.
const DEFAULTS_REL = ".agents/harness.defaults.json";
const adapterSections = (obj) => ({ adapter: obj?.adapter ?? {}, gsd: obj?.gsd ?? {} });

// [dotted path, value] of every key below the adapter and gsd sections, as overlayPaths walks them.
function sectionEntries(obj, prefix = "") {
  const out = [];
  for (const [name, value] of Object.entries(obj)) {
    if (name.startsWith("_")) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    if (prefix) out.push([key, value]);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(...sectionEntries(value, key));
  }
  return out;
}

function readOverlay(project) {
  try {
    return readJsonIf(path.join(project, OVERLAY_REL), {});
  } catch {
    return null;
  }
}

// The baseline record before the update copies parts; null when the overlay or the installed defaults cannot be read.
export function adapterBaseline(project, previous) {
  const overlay = readOverlay(project);
  if (!overlay) return null;
  const digest = sha256(JSON.stringify(adapterSections(overlay)));
  if (previous?.overlay === digest) return previous;
  let installed;
  try {
    installed = readJsonIf(path.join(project, DEFAULTS_REL), null);
  } catch {
    installed = null;
  }
  return installed ? { overlay: digest, keys: sectionEntries(adapterSections(installed)).map(([k]) => k) } : null;
}

// After the copy: one warning per added key (the top-most of an added subtree) the overlay does not set.
export function addedKeyLines(ctx, baseline) {
  const unit = ctx.kit.units.get(DEFAULTS_REL);
  const overlay = readOverlay(ctx.project);
  if (!baseline || !unit || !overlay) return;
  let defaults;
  try {
    defaults = readJsonIf(unit.src, null);
  } catch {
    return;
  }
  const known = new Set(baseline.keys);
  const set = new Set(overlayPaths(overlay));
  const added = sectionEntries(adapterSections(defaults ?? {})).filter(([k]) => !known.has(k) && !set.has(k));
  for (const [key, value] of added.filter(([k]) => !added.some(([o]) => k.startsWith(`${o}.`)))) {
    const shown = JSON.stringify(value);
    ctx.out(`warning adapter key ${key}: added by the kit since the adapter was last written, and the project leaves it at the default ${shown.length > 80 ? `${shown.slice(0, 77)}...` : shown}; set it in ${OVERLAY_REL} (the default value too) once decided`);
  }
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
