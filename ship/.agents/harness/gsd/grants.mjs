// `ph gsd grant` (kit-feedback 53): the owner's grant of a file to the fixers of a phase. A review fix that needs a file a
// committed earlier-wave plan owns stops gsd-execute with this option; the next run hands the file to the phase's fixers
// and commits it with the wave as integration (commits.json). The record is <phase>/grants.json: one entry per path.
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { done, fail, rel } from "./common.mjs";
import { covers, ownsPath } from "./adapter-hooks.mjs";
import { normPlanId, readPlans } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

export const GRANTS = "grants.json";

export function grantPath(g, phase, filePath, planRef) {
  guardWriter(g.env);
  const file = String(filePath ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!file) throw fail("grant needs --path <file>");
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split("/").includes("..")) throw fail(`grant --path must be a path inside the code root: ${file}`);
  const forms = g.cfg.adapter.ownership.owns_forms;
  const owned = (entry) => {
    const mapped = ownsPath(entry, forms);
    return mapped !== null && covers(mapped, file);
  };
  const owners = readPlans(phase).filter((p) => p.owns.some(owned)).map((p) => p.id);
  const plan = planRef ? (/^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef)) : null;
  if (plan && !owners.includes(plan)) throw fail(`${plan} does not own ${file}${owners.length ? ` (owned by ${owners.join(", ")})` : ""}`);
  if (!plan && owners.length) throw fail(`${file} is owned by ${owners.join(", ")}; grant it with --plan <id>`);
  const grantsFile = path.join(phase.dir, GRANTS);
  const list = readJsonIf(grantsFile, []);
  if (!Array.isArray(list)) throw fail(`${rel(g.codeRoot, grantsFile)} is not a JSON array`);
  // A path is granted once: a new grant of the same path replaces the earlier entry.
  writeJsonAtomic(grantsFile, [...list.filter((x) => x.path !== file), { path: file, plan, at: new Date().toISOString() }]);
  return done({ granted: file, plan, grants: rel(g.codeRoot, grantsFile) });
}
