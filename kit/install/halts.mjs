// Kit feedback 90: after an update, the open halts of the project that `ph gsd halt clear --resume` will not take (the same check
// as the verb: a record of an older kit names no worktree and its tree is looked up). Information only: the owner answers such a
// halt without --resume (the plan runs again) or restores the tree; the update's exit code does not change.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { resumeCheck } from "../../ship/.agents/harness/gsd/halts.mjs";
import { phasesDir } from "../../ship/.agents/harness/gsd/planning.mjs";
import { readJsonIf } from "../../ship/.agents/harness/lib/io.mjs";
import { toSlash } from "../../ship/.agents/harness/lib/paths.mjs";

export function haltLines(ctx) {
  const dir = phasesDir(ctx.project);
  if (!fs.existsSync(dir)) return 0;
  let cfg = {};
  try { cfg = loadConfig(ctx.project); } catch { cfg = {}; }
  let n = 0;
  for (const name of fs.readdirSync(dir).sort()) {
    const phaseDir = path.join(dir, name);
    if (!fs.statSync(phaseDir).isDirectory()) continue;
    const phase = { dir: phaseDir, padded: name.split("-")[0] };
    for (const file of fs.readdirSync(phaseDir).filter((f) => f.endsWith("-HALT.json")).sort()) {
      const id = file.slice(0, -"-HALT.json".length);
      let halt = null;
      try { halt = readJsonIf(path.join(phaseDir, file), null); } catch { halt = null; }
      const check = resumeCheck(ctx.project, cfg, phase, id, halt);
      if (check.ok) continue;
      ctx.out(`note open halt ${id} (${toSlash(path.relative(ctx.project, phaseDir))}): ph gsd halt clear --resume will not take it: ${check.why}; answer it without --resume and the plan runs again`);
      n++;
    }
  }
  return n;
}
