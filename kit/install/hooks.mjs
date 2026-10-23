// Reconciles the kit's hook registrations in .claude/settings.json against ship/templates/settings.hooks.json (INST-14).
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { fileDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { errText } from "../../ship/.agents/harness/lib/cli.mjs";
import { fail } from "./failure.mjs";
import { hookScript, hookUnitKey, templateScripts } from "./units.mjs";

export const SETTINGS_REL = ".claude/settings.json";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Preflight for install and update, run before any kit file is copied: a settings file that the wiring step cannot
// reconcile, or would overwrite, fails here naming the file and the event, so nothing is written.
export function checkHookSettings(project, template) {
  const file = path.join(project, SETTINGS_REL);
  let settings;
  try {
    settings = fs.existsSync(file) ? readJson(file) : {};
  } catch (e) {
    fail(errText(e));
  }
  if (!isPlainObject(settings)) fail(`${SETTINGS_REL} is not a JSON object`);
  if (settings.hooks !== undefined && !isPlainObject(settings.hooks)) fail(`${SETTINGS_REL}: "hooks" is not an object; fix it by hand`);
  for (const event of Object.keys(template.hooks ?? {})) {
    const groups = settings.hooks?.[event];
    if (groups !== undefined && !Array.isArray(groups)) fail(`${SETTINGS_REL}: hooks.${event} is not a list of hook groups; fix it by hand`);
  }
}

// Pure: removes every registration of the managed, unblocked scripts and of the retired ones (scripts this update deleted
// as unchanged kit files, CR-INS-04), and appends the template groups for the managed ones.
export function reconcileSettings(settings, template, blocked = new Set(), retired = new Set()) {
  const managed = new Set([...templateScripts(template), ...retired].filter((name) => !blocked.has(name)));
  const owned = (hook) => managed.has(hookScript(hook));
  const next = structuredClone(settings);
  const hooks = isPlainObject(next.hooks) ? next.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((group) => (Array.isArray(group?.hooks) && group.hooks.some(owned) ? { ...group, hooks: group.hooks.filter((h) => !owned(h)) } : group))
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  for (const [event, groups] of Object.entries(template.hooks ?? {})) {
    for (const group of groups) {
      const ours = group.hooks.filter(owned);
      if (ours.length) (hooks[event] ??= []).push(structuredClone({ ...group, hooks: ours }));
    }
  }
  if (Object.keys(hooks).length || isPlainObject(next.hooks)) next.hooks = hooks;
  return next;
}

// Wiring step: a managed script whose project file does not match the prospective record is blocked (INST-33).
export function reconcileHooks(ctx) {
  const file = path.join(ctx.project, SETTINGS_REL);
  const settings = fs.existsSync(file) ? readJson(file) : {};
  if (!isPlainObject(settings)) throw new Error(`${SETTINGS_REL} is not a JSON object`);
  const blocked = new Set();
  for (const name of templateScripts(ctx.kit.template)) {
    const key = hookUnitKey(name);
    const abs = path.join(ctx.project, key);
    const recorded = ctx.records[key];
    if (!recorded || !fs.existsSync(abs) || fileDigest(abs) !== recorded) {
      blocked.add(name);
      ctx.out(`conflict ${key}: local script differs; its registrations were kept unchanged`);
    }
  }
  const next = reconcileSettings(settings, ctx.kit.template, blocked, ctx.retiredHooks);
  if (JSON.stringify(next) !== JSON.stringify(settings)) {
    writeJsonAtomic(file, next);
    ctx.out(`reconciled kit hook registrations in ${SETTINGS_REL} (unrelated hooks preserved)`);
  } else {
    ctx.out(`${SETTINGS_REL}: kit hook registrations unchanged`);
  }
  return blocked.size;
}
