// Seeded block parts (kit feedback 87): a kit.json unit whose shipped text holds the kit block (the gsd workflow skills).
// The kit owns the block; the rest of the file (front matter, the project section) is the project's: install writes the
// whole shipped file once (the seed), update replaces only the block, pull copies only the block back. An older kit
// recorded such a file whole (a manifest key without the block suffix); the pre-pass below migrates it. loadKit marks
// these units (`seed: true`).
import fs from "node:fs";
import { readText } from "../../ship/.agents/harness/lib/io.mjs";
import { fileDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { resolveInside } from "../../ship/.agents/harness/lib/paths.mjs";
import { byCodePoint, kitDigest } from "./units.mjs";
import { copyToProject, linkedPart } from "./parts.mjs";
import { findBlock } from "./text.mjs";

const MOVE = "move the project's text below the kit markers (see the kit's ship/";
const unmarkedWhy = (rel, unedited) => (unedited === null
  ? `${rel} has no kit block markers (the project's own file or an older kit's whole file)`
  : `${rel} has no kit block markers: an edited copy of an older kit's whole file`);

// Handles the seeded parts the verb's loop must leave alone and returns {skip, changed, kept}: an older kit's whole-file
// record is never classified by the loop (the generic rule would delete the file), and a project file without kit
// markers is migrated when it is an unedited whole-file copy, else kept and reported until the owner moves the text or
// runs --force. Mutates `records` as the loop does. verb: install | update | status | pull; `named`: pull's part names.
export function seededPass(ctx, records, verb, named = []) {
  const skip = new Set();
  let changed = 0;
  let kept = 0;
  const units = [...ctx.kit.units.values()].filter((u) => u.seed).sort((a, b) => byCodePoint(a.key, b.key));
  for (const unit of units) {
    const { key, rel } = unit;
    const recorded = Object.hasOwn(records, rel) ? records[rel] : null;
    if (recorded !== null) skip.add(rel);
    if (named.length && !named.includes(key) && !named.includes(rel)) continue;
    if (linkedPart(ctx.kit, ctx.project, key)) continue;
    const file = resolveInside(ctx.project, rel);
    const text = fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? readText(file) : null;
    if (text === null || findBlock(text).status !== "none") {
      if (recorded !== null && verb !== "status") delete records[rel];
      continue;
    }
    skip.add(key);
    const unedited = recorded === null ? null : fileDigest(file) === recorded;
    if (verb === "status") {
      ctx.out(unedited
        ? `${"migrate".padEnd(13)} ${key}  (an older kit's whole file; update rewrites it as the kit block plus the project section)`
        : `${"no-markers".padEnd(13)} ${key}  (${unmarkedWhy(rel, unedited)}; ${MOVE}${rel}), or update --force replaces it)`);
      kept++;
    } else if (verb === "pull") {
      ctx.out(`skipped ${key} (${rel} has no kit block markers; run update first)`);
      kept++;
    } else if (unedited || ctx.force) {
      copyToProject(ctx.kit, ctx.project, key);
      delete records[rel];
      records[key] = kitDigest(unit);
      ctx.out(unedited
        ? `migrated ${rel}: an older kit's whole file, unedited; rewritten as the kit block plus the project section`
        : `updated ${key} (--force replaced ${rel}, which had no kit block markers)`);
      changed++;
    } else {
      const why = unmarkedWhy(rel, unedited);
      ctx.out(verb === "install"
        ? `conflict ${key}: ${why}; kept it (install --force replaces it with the kit's)`
        : `kept ${key} (${why}; ${MOVE}${rel}) and run update, or update --force replaces it)`);
      kept++;
    }
  }
  return { skip, changed, kept };
}
