// Icon names the planning-panel and office clients use, read from their source for smoke.mjs (PANL-10, OFFC-23).
// Found: a quoted name after name=/icon= or a colon; every quoted name inside a name={...} or icon={...} (a ternary); and
// the value of a const in the same file that is passed as icon: NAME or icon={NAME}. Other expressions, such as props.icon
// or a lookup like COMPLETION_ICON[state], are not followed.
import fs from "node:fs";
import path from "node:path";

const PLUGINS = ["planning-panel", "office"];

export function iconNames(pluginsDir) {
  const names = new Set();
  for (const plugin of PLUGINS) {
    const dir = path.join(pluginsDir, plugin, "client");
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      const file = path.join(dir, String(f));
      if (!/\.tsx?$/.test(file) || !fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:name|icon)[=:]\s*\{?"([A-Z][A-Za-z0-9]+)"/g)) names.add(m[1]);
      for (const m of text.matchAll(/:\s*"([A-Z][A-Za-z0-9]+)",?\s*$/gm)) names.add(m[1]);
      for (const m of text.matchAll(/\b(?:name|icon)=\{([^}]*)\}/g)) for (const lit of m[1].matchAll(/"([A-Z][A-Za-z0-9]+)"/g)) names.add(lit[1]);
      const consts = new Map();
      for (const m of text.matchAll(/const (\w+) = "([A-Z][A-Za-z0-9]+)"/g)) consts.set(m[1], m[2]);
      for (const m of text.matchAll(/\bicon(?::\s*|=\{)([A-Za-z_]\w*)\b/g)) if (consts.has(m[1])) names.add(consts.get(m[1]));
    }
  }
  return [...names].sort();
}
