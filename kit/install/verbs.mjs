// install, update, status and pull over the kit's units and the project's ownership record (INST-06..13, INST-32, INST-33).
import { byCodePoint, hookNameOfKey, isBlockKey } from "./units.mjs";
import { readManifest, requireManifest, writeManifest } from "./manifest.mjs";
import { classify, reason } from "./state.mjs";
import { copyToKit, copyToProject, deleteFromProject, digests, linkedPart, linkProblem, MALFORMED, malformedLine } from "./parts.mjs";
import { checkWiringTargets, wire } from "./wiring.mjs";
import { checkHookSettings } from "./hooks.mjs";
import { checkModGates } from "./mod.mjs";
import { overlayLines } from "./overlay.mjs";
import { fail } from "./failure.mjs";

const LINK_CONFLICT = (key, prefix) => `conflict ${key}: ${linkProblem(prefix)}`;
const BLOCK_WARNING = (key) => `warning ${key}: text inside the kit block; project text belongs outside the markers`;

const allKeys = (kit, files) => [...new Set([...kit.units.keys(), ...Object.keys(files)])].sort(byCodePoint);

// Block text differing from the shipped body is flagged whatever its state (INST-13).
const blockDiffers = (key, { P, K }) => isBlockKey(key) && P != null && P !== MALFORMED && K != null && P !== K;

function finishInstallOrUpdate(ctx, { records, installedAt }) {
  const problems = wire({ ...ctx, records });
  writeManifest(ctx.project, { version: ctx.kit.version, installedAt, files: records }, ctx.now());
  return problems;
}

export function install(ctx) {
  if (readManifest(ctx.project)) fail(".agents/harness-kit.json exists: already installed; use update");
  checkWiringTargets(ctx.project);
  checkHookSettings(ctx.project, ctx.kit.template);
  if (ctx.enablePlugin) checkModGates(ctx.env);
  const records = {};
  let conflicts = 0;
  for (const key of [...ctx.kit.units.keys()].sort(byCodePoint)) {
    const linked = linkedPart(ctx.kit, ctx.project, key);
    if (linked) {
      ctx.out(LINK_CONFLICT(key, linked));
      conflicts++;
      continue;
    }
    const { P, K } = digests(ctx.kit, ctx.project, key);
    if (P === MALFORMED) {
      ctx.out(malformedLine(key));
      conflicts++;
      continue;
    }
    if (P !== null && P !== K && !ctx.force) {
      ctx.out(`conflict ${key}: the project has a different version and kept it (install --force replaces it)`);
      conflicts++;
      continue;
    }
    if (P !== K) copyToProject(ctx.kit, ctx.project, key);
    if (P !== null && P !== K) ctx.out(`updated ${key}`);
    records[key] = K;
  }
  const blocked = finishInstallOrUpdate(ctx, { records, installedAt: null });
  ctx.out(`installed paseo-kit ${ctx.kit.version}; machine setup (once per machine): node "${ctx.kitScript}" machine check`);
  return conflicts + blocked ? 2 : 0;
}

export function update(ctx) {
  const manifest = requireManifest(ctx.project);
  checkWiringTargets(ctx.project);
  checkHookSettings(ctx.project, ctx.kit.template);
  if (ctx.enablePlugin) checkModGates(ctx.env);
  const records = { ...manifest.files };
  const retiredHooks = new Set();
  let changed = 0;
  let kept = 0;
  for (const key of allKeys(ctx.kit, records)) {
    const linked = linkedPart(ctx.kit, ctx.project, key);
    if (linked) {
      ctx.out(LINK_CONFLICT(key, linked));
      kept++;
      continue;
    }
    const { P, K } = digests(ctx.kit, ctx.project, key);
    if (P === MALFORMED) {
      ctx.out(malformedLine(key));
      kept++;
      continue;
    }
    const state = classify(P, K, records[key] ?? null);
    if (state === "same") records[key] = K;
    else if (state === "gone") delete records[key];
    else if (state === "missing" || state === "kit-newer" || (ctx.force && (state === "local" || state === "both"))) {
      copyToProject(ctx.kit, ctx.project, key);
      records[key] = K;
      ctx.out(`updated ${key}`);
      changed++;
    } else if (state === "removed") {
      deleteFromProject(ctx.project, key);
      delete records[key];
      const hook = hookNameOfKey(key);
      if (hook) retiredHooks.add(hook);
      ctx.out(`deleted ${key} (no longer in the kit)`);
      changed++;
    } else {
      ctx.out(`kept ${key} (${reason(state)})`);
      kept++;
    }
  }
  kept += finishInstallOrUpdate({ ...ctx, retiredHooks }, { records, installedAt: manifest.installedAt });
  const refused = overlayLines(ctx, manifest.version);
  ctx.out(`update: ${changed} part(s) changed, ${kept} kept; kit ${ctx.kit.version}`);
  return kept || refused ? 2 : 0;
}

export function status(ctx) {
  const manifest = requireManifest(ctx.project);
  let differ = 0;
  for (const key of allKeys(ctx.kit, manifest.files)) {
    const linked = linkedPart(ctx.kit, ctx.project, key);
    if (linked) {
      ctx.out(LINK_CONFLICT(key, linked));
      differ++;
      continue;
    }
    const d = digests(ctx.kit, ctx.project, key);
    if (d.P === MALFORMED) {
      ctx.out(`${"malformed".padEnd(13)} ${key}  (malformed kit block markers; fix by hand)`);
      differ++;
      continue;
    }
    const state = classify(d.P, d.K, manifest.files[key] ?? null);
    if (state !== "same" && state !== "gone") {
      ctx.out(`${state.padEnd(13)} ${key}  (${reason(state).slice(state.length + 2)})`);
      differ++;
    }
    if (blockDiffers(key, d)) ctx.out(BLOCK_WARNING(key));
  }
  const versions = `project on kit ${manifest.version}, kit now ${ctx.kit.version}`;
  ctx.out(differ ? `status: ${differ} part(s) differ; ${versions}` : `status: every kit part is the same; ${versions}`);
  return differ ? 2 : 0;
}

export const normalizePart = (name) => name.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

export function pull(ctx, partNames) {
  const manifest = requireManifest(ctx.project);
  checkWiringTargets(ctx.project);
  const records = { ...manifest.files };
  const known = new Set(allKeys(ctx.kit, records));
  const named = partNames.map(normalizePart);
  const unknown = named.filter((name) => !known.has(name));
  if (unknown.length) {
    for (const name of unknown) ctx.err(`failed pull ${name}: not a kit part`);
    return 1;
  }
  let copied = 0;
  let skipped = 0;
  for (const key of named.length ? [...new Set(named)] : [...known]) {
    const linked = linkedPart(ctx.kit, ctx.project, key, { kitSide: true });
    if (linked) {
      ctx.out(`skipped ${key} (${linkProblem(linked)})`);
      skipped++;
      continue;
    }
    const d = digests(ctx.kit, ctx.project, key);
    if (d.P === MALFORMED) {
      ctx.out(`skipped ${key} (malformed kit block markers; fix by hand)`);
      skipped++;
      continue;
    }
    if (blockDiffers(key, d)) ctx.out(BLOCK_WARNING(key));
    const state = classify(d.P, d.K, records[key] ?? null);
    if (state === "same") continue;
    if (state === "gone") delete records[key];
    else if (state === "local" || (state === "both" && ctx.force)) {
      copyToKit(ctx.kit, ctx.project, key);
      records[key] = d.P;
      ctx.out(`pulled ${key}`);
      copied++;
    } else {
      ctx.out(`skipped ${key} (${reason(state)})`);
      skipped++;
    }
  }
  writeManifest(ctx.project, { version: ctx.kit.version, installedAt: manifest.installedAt, files: records }, ctx.now());
  const reminder = copied ? "; record them in the kit CHANGELOG.md and commit the kit, then update the other projects" : "";
  ctx.out(`pull: ${copied} part(s) copied into the kit${reminder}`);
  return skipped ? 2 : 0;
}
