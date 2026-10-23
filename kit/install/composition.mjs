// Composition parts (kit feedback 87): the workflow scripts kit.json lists under `composition`. The kit ships the
// default; once the project edits its copy the project owns it: update keeps it (also with --force), status says so,
// pull still offers it back to the kit. The manifest keeps per part the digest it was seeded from and that kit version.
import path from "node:path";
import { toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { checkCompositionVerbs, problemText } from "../../ship/.agents/harness/gsd/verb-check.mjs";
import { kitDigest } from "./units.mjs";

const EDITED = new Set(["local", "both"]);

// A part is composition when the kit lists it now or the manifest recorded it as one (a part the kit stopped shipping).
export const isComposition = (kit, manifest, key) => kit.composition.has(key) || Object.hasOwn(manifest?.composition ?? {}, key);

export const isEdited = (state) => EDITED.has(state);

// The manifest entries after a verb: an entry whose seeded digest still matches the record is kept as it was; a new
// one gets the kit version when the record is the kit's current default, else null (an older manifest did not say).
export function compositionEntries(kit, records, previous = {}) {
  const out = {};
  for (const key of kit.composition) {
    const seeded = records[key];
    if (!seeded) continue;
    const prev = previous[key];
    out[key] = prev?.seeded === seeded ? prev : { seeded, version: seeded === kitDigest(kit.units.get(key)) ? kit.version : null };
  }
  return out;
}

const since = (entry) => entry?.version ?? "the copy it was seeded from (kit version not recorded)";

export const diffCommand = (kit, project, key) => `git diff --no-index -- "${toSlash(path.join(kit.dir, "ship", key))}" "${toSlash(path.join(project, key))}"`;

// update's line for an edited composition part it keeps.
export function keptLine(ctx, key, state, entry) {
  const head = `composition kept: ${key} (edited by the project)`;
  if (state !== "both") return head;
  return `${head}; kit default changed since ${since(entry)}; see the diff: ${diffCommand(ctx.kit, ctx.project, key)}; to take the kit default, delete the project copy and run update`;
}

export const droppedLine = (key) => `composition kept: ${key} (edited by the project); the kit no longer ships it, so it is now the project's own file`;

// status: the state of one composition part in words, and whether update has work for it.
export function statusLine(ctx, key, state, entry) {
  const label = {
    same: "kit default",
    "kit-newer": "kit default; update takes the new kit default",
    missing: "missing; update adds the kit default",
    local: "edited by project",
    both: `edited by project; kit default changed since ${since(entry)} (see the diff: ${diffCommand(ctx.kit, ctx.project, key)})`,
  }[state];
  return label ? { line: `composition ${key}: ${label}`, differs: state === "kit-newer" || state === "missing" } : null;
}

// update's verb compatibility check: after the copy, like the F62 argument checks, the project's compositions are
// scanned for flow and gsd verbs the running kit does not serve. Returns how many it found.
export function verbLines(ctx) {
  const { problems } = checkCompositionVerbs(ctx.project);
  for (const p of problems) ctx.out(`problem ${problemText(p)}`);
  return problems.length;
}
