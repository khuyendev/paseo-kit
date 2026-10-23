// Composition policies (kit feedback 87): the gsd.* and adapter.* settings that only a workflow script reads (or, `via:
// "skill"`, only a skill's main-session text) to pick a step, an order or a step's bound. Every other gsd.* and adapter.*
// key is read by a kit verb, the flow lib, the runtime, a hook, doctor or lint: a verb or invariant setting
// (docs/INTERFACES.md section 4). The kit keeps the policies for its default composition; a project whose own script no
// longer reads one may drop it, and ph doctor notes a policy the overlay sets that no script (or skill) of the project names.
import fs from "node:fs";
import path from "node:path";
import { OVERLAY_REL } from "../config.mjs";
import { readJsonIf, readText } from "../lib/io.mjs";

const WORKFLOWS_REL = ".agents/workflows";
const SKILLS_REL = ".claude/skills";
const script = (...names) => ({ via: "script", readers: names.map((n) => `${WORKFLOWS_REL}/${n}.js`) });
const skill = (...names) => ({ via: "skill", readers: names.map((n) => `${SKILLS_REL}/${n}/SKILL.md`) });

// dotted key -> {via, readers: the files of the kit default that read it}
export const COMPOSITION_POLICIES = Object.freeze({
  "gsd.granularity": script("gsd-plan"),
  "gsd.execute_schedule": script("gsd-execute"),
  "gsd.request_check": script("gsd-execute"),
  "gsd.batch_review": script("gsd-execute"),
  "gsd.fixer_verifies_itself": script("gsd-execute"),
  "gsd.max_verify_rounds": script("gsd-execute"),
  "gsd.branching": script("gsd-execute"),
  "gsd.protected_branches": script("gsd-execute"),
  "gsd.research": skill("gsd-discuss"),
  "gsd.plan_review": script("gsd-plan"),
  "gsd.plan_review_check": script("gsd-plan-review"),
  "gsd.plan_flow": script("gsd-plan"),
  "gsd.checker_reallocate": script("gsd-plan"),
  "gsd.checker_recheck": script("gsd-plan"),
  "gsd.skeleton_lanes": script("gsd-plan"),
  "gsd.max_skeleton_passes": script("gsd-plan"),
  "gsd.max_check_iterations": script("gsd-plan"),
  "gsd.drift_threshold": script("gsd-plan"),
  "gsd.map_mode": script("gsd-map-codebase"),
  "gsd.debug": script("gsd-debug"),
  "gsd.fixer": script("gsd-execute"),
  "gsd.parallelization": script("gsd-execute", "gsd-verify"),
  "gsd.code_review": script("gsd-execute"),
  "gsd.review_depth": script("gsd-execute"),
  "gsd.verify_mode": script("gsd-verify"),
  "gsd.validation_strategy": script("gsd-plan"),
  "gsd.pending_request_tasks": script("gsd-execute"),
  "adapter.smoke_triggers": script("gsd-execute"),
  "adapter.startup_globs": skill("gsd-verify"),
});

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const setIn = (overlay, key) => {
  const [section, leaf] = key.split(".");
  const value = overlay?.[section];
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, leaf);
};

// Texts of the files `fileOf(entry)` names for the entries of `dir` (null: skip the entry).
function texts(dir, fileOf) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { withFileTypes: true }).map(fileOf).filter(Boolean).map((rel) => path.join(dir, rel));
  return files.filter((f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile()).map(readText);
}

// The policy keys the overlay sets, and those of them that no top-level workflow script of the project names (a skill
// policy: no skill names the dotted key). A name match, not a parse: a key whose name appears anywhere counts as read.
export function unreadPolicies(root) {
  const overlay = readJsonIf(path.join(root, OVERLAY_REL));
  const set = Object.keys(COMPOSITION_POLICIES).filter((key) => setIn(overlay, key));
  if (!set.length) return { set, unread: [] };
  const sources = {
    script: texts(path.join(root, WORKFLOWS_REL), (e) => (e.isFile() && e.name.endsWith(".js") ? e.name : null)),
    skill: texts(path.join(root, SKILLS_REL), (e) => (e.isDirectory() ? path.join(e.name, "SKILL.md") : null)),
  };
  const unread = set.filter((key) => {
    const { via } = COMPOSITION_POLICIES[key];
    const name = new RegExp(`\\b${escape(via === "script" ? key.split(".")[1] : key)}\\b`);
    return !sources[via].some((text) => name.test(text));
  });
  return { set, unread };
}

// ph doctor lines: one note per unread policy, one ok line when the overlay sets policies and each is read.
export function compositionPolicyLines(root) {
  const { set, unread } = unreadPolicies(root);
  const lines = unread.map((key) => {
    const { via, readers } = COMPOSITION_POLICIES[key];
    const where = via === "script" ? `no workflow script of this project (${WORKFLOWS_REL}/*.js) reads it` : `no skill of this project (${SKILLS_REL}/*/SKILL.md) names it`;
    return ["note", `composition policy ${key}: set in ${OVERLAY_REL}, but ${where} (the kit default reads it in ${readers.join(", ")}); it has no effect: drop it, or read it in the composition`];
  });
  if (set.length && !unread.length) lines.push(["ok", `composition policies: ${set.length} set in ${OVERLAY_REL}, each read by the project's composition`]);
  return lines;
}
