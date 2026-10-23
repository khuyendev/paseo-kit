// Kit Paseo plugins, registered only with --enable-paseo-plugins; a user entry elsewhere is kept (MACH-15).
import fs from "node:fs";
import path from "node:path";
import { readJson } from "../../ship/.agents/harness/lib/io.mjs";
import { samePath } from "../../ship/.agents/harness/lib/paths.mjs";

export const KIT_PLUGIN_FOLDERS = ["planning-panel", "office"];

// [{folder, dir, id, error}] for the kit's plugin folders.
export function kitPlugins(pluginsDir) {
  return KIT_PLUGIN_FOLDERS.map((folder) => {
    const dir = path.join(pluginsDir, folder);
    try {
      const id = readJson(path.join(dir, "paseo-plugin.json")).id;
      if (typeof id !== "string" || !id) return { folder, dir, id: null, error: "its paseo-plugin.json has no id" };
      return { folder, dir, id, error: null };
    } catch (e) {
      return { folder, dir, id: null, error: e.code === "ENOENT" ? "no paseo-plugin.json" : e.message };
    }
  });
}

const isKitEntry = (have, p) => have?.source === "directory" && typeof have.path === "string" && samePath(have.path, p.dir);
// Written only after `npm ci` exits 0: a node_modules folder alone can be a partial install.
const DEPS_DONE = ".npm-ci-done";
const hasDeps = (p) => fs.existsSync(path.join(p.dir, DEPS_DONE));
export const markDeps = (p) => fs.writeFileSync(path.join(p.dir, DEPS_DONE), "");
// A failed `npm ci` leaves no marker, so the next apply retries; its partial node_modules goes too.
export const dropDeps = (p) => fs.rmSync(path.join(p.dir, "node_modules"), { recursive: true, force: true });

// Check lines: `ok`/`problem` when this run enables plugins, else every line is a `note`.
export function pluginLines(live, plugins, enabling) {
  const lines = [];
  const add = (good, text) => lines.push({ level: enabling ? (good ? "ok" : "problem") : "note", text });
  add(live.pluginsEnabled === true, `Paseo plugins ${live.pluginsEnabled === true ? "on" : "off (pluginsEnabled)"}`);
  for (const p of plugins) {
    if (p.error) {
      add(false, `kit Paseo plugin folder ${p.folder}: ${p.error}`);
      continue;
    }
    const have = live.plugins?.[p.id];
    if (!have) add(false, `Paseo plugin ${p.id} is not registered (kit.mjs machine apply --enable-paseo-plugins)`);
    else if (!isKitEntry(have, p)) add(false, `Paseo plugin ${p.id} runs from ${have.path ?? have.source} (user entry), not from the kit`);
    else if (have.enabled === false) add(false, `Paseo plugin ${p.id} is disabled`);
    else add(true, `Paseo plugin ${p.id} runs from the kit`);
    add(hasDeps(p), `Paseo plugin ${p.id} dependencies ${hasDeps(p) ? "installed" : "missing (apply --enable-paseo-plugins runs npm ci)"}`);
  }
  return lines;
}

// Patch `next` in memory: {changes, conflicts, registered} (registered = the plugins whose entry is the kit's).
export function patchPlugins(next, plugins) {
  const changes = [];
  const conflicts = [];
  const registered = [];
  if (next.pluginsEnabled !== true) {
    next.pluginsEnabled = true;
    changes.push("turned Paseo plugins on (pluginsEnabled)");
  }
  next.plugins ??= {};
  for (const p of plugins) {
    const have = next.plugins[p.id];
    if (have && !isKitEntry(have, p)) {
      conflicts.push(`conflict Paseo plugin ${p.id}: user entry kept`);
      continue;
    }
    registered.push(p);
    if (have && have.enabled !== false) continue;
    next.plugins[p.id] = { ...(have ?? {}), source: "directory", path: p.dir, enabled: true };
    changes.push(`registered Paseo plugin ${p.id} from ${p.dir}`);
  }
  return { changes, conflicts, registered };
}

export const needsDeps = (p) => !hasDeps(p);
