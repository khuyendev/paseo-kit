// The lines of a plan's <shared_changes> block (G083) as gsd-execute applies them (kit feedback 95). gsd-execute makes a plan's
// declared shared changes before the executors of its wave start (exec-shared-before), except a line that waits for the plan's
// own code (AFTER_CODE): that one is made after the code, before the gate, as every shared change was before. The plan checker
// (the `check owns` probe) refuses a wave timing the runtime cannot honour, and the shared step marks a change applied without a
// fixer when the tree holds it at HEAD (presence, used by state-shared op present).
import { absentSharedChange, sharedDependencies, sharedLinePath } from "./planning.mjs";

const slash = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
// A timing that waits for the plan's own code: "when AppBootstrap exists", "once the router file exists", "after the plan's code",
// "after Task 2", "with the tracer segment".
export const AFTER_CODE = /\b(?:when\s+\S+\s+exists?|once\s+.{1,60}?\s+exists?|after\s+(?:the\s+|this\s+|its\s+)?(?:plan'?s?\s+)?(?:own\s+)?(?:code|implementation|executor|tasks?(?:\s+\d+)?)\b|with\s+the\s+tracer\s+segment)/i;
const WAVE_REF = /\b(before|after|in|during)\s+(?:plan\s+)?wave\s+(\d+)\b/gi;

// The file a <shared_changes> line changes (planning.mjs sharedLinePath, the same rule as outline.mjs sharedChangePaths).
const leadingPath = (line) => sharedLinePath(line);

/** The lines of a <shared_changes> text that change `path` (their leading `path:`), trimmed. */
export const linesFor = (text, path) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && leadingPath(l) === slash(path));

/** Does the change to `path` wait for the plan's own code (an AFTER_CODE line)? */
export const waitsForCode = (text, path) => linesFor(text, path).some((l) => AFTER_CODE.test(l));

/** The <shared_changes> lines of a plan (wave `wave`) whose wave timing gsd-execute cannot honour: [{plan, line, message}]. */
export function timingIssues(plan) {
  const out = [];
  const w = plan.wave;
  for (const line of plan.sharedChanges.flatMap((t) => t.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean)) {
    for (const m of line.matchAll(WAVE_REF)) {
      const [kind, n] = [m[1].toLowerCase(), Number(m[2])];
      const why = kind === "before" && n < w ? `gsd-execute makes a plan's shared changes before its own wave ${w}, later than wave ${n}; a plan of wave ${n} that needs the change declares it`
        : kind === "after" && n >= w ? `gsd-execute makes a plan's shared changes before its own wave ${w} (after the plan's code only when the line waits for it, "when <file> exists"); a plan of a wave after ${n} declares it`
          : ["in", "during"].includes(kind) && n !== w ? `gsd-execute makes a plan's shared changes with its own wave ${w}, not wave ${n}; the plan of wave ${n} declares it`
            : null;
      if (why) out.push({ plan: plan.id, kind: "shared-timing", severity: "blocker", line, message: `${plan.id}: <shared_changes> "${line.slice(0, 160)}" asks for "${m[0]}": ${why}` });
    }
  }
  return out;
}

// Kit feedback 105 F1: a <shared_changes> entry that is not a none/n/a/empty block and names no file. An issue for the plan
// checker (check owns, with timingIssues), with the fix the reviser applies. A sentinel line beside a real path is not one.
export function pathlessIssues(plan) {
  const out = [];
  for (const text of plan.sharedChanges ?? []) {
    for (const line of String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (leadingPath(line) || absentSharedChange(line)) continue;
      const shown = line.slice(0, 160);
      const fix = `name the file as \`<path>: ${shown.slice(0, 80)}\`, or replace the <shared_changes> block with None when it is no shared change`;
      out.push({ plan: plan.id, kind: "shared-path", severity: "blocker", line, fix, message: `${plan.id}: <shared_changes> entry names no file: "${shown}". Fix: ${fix}` });
    }
  }
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SECTION = /dependencies/i;
// Does a package manifest text declare the package of a dependency line (G022)? The key `name:`, `"name":` or `name =`, with the
// constraint text on its line when the line gives one, under a dependencies section whose header says dev for a [dev] line and
// does not otherwise. Unsure is no.
export function declares(text, { name, constraint, dev }) {
  if (!name || typeof text !== "string") return false;
  const key = new RegExp(`^\\s*["']?${escape(name)}["']?\\s*[:=]\\s*(.*)$`);
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    const m = key.exec(line);
    if (!m && SECTION.test(line) && /[:{\]=]\s*\{?\s*$/.test(line.trim())) { section = line; continue; }
    if (!m || section === null || /dev/i.test(section) !== Boolean(dev)) continue;
    if (!constraint || ` ${m[1].replace(/["',]/g, " ").replace(/\s+/g, " ").trim()} `.includes(` ${constraint} `)) return true;
  }
  return false;
}

/**
 * Is the shared change `s` ({path, change}) present: every one of its lines for its path is a dependency line whose manifest declares
 * the package at HEAD and in the tree, or the same line of an earlier shared change of that path that a fixer applied (or found
 * present)? `read(rev)`: the text of s.path at HEAD ("HEAD") or in the tree (null), or null. -> {present, evidence}.
 */
export function presence(s, { read, earlier = [] }) {
  const lines = linesFor(s.change, s.path);
  if (!s.path || !lines.length) return { present: false };
  const made = new Set(earlier.filter((x) => x.applied && !x.cleared && slash(x.path) === slash(s.path)).flatMap((x) => linesFor(x.change, x.path)));
  const proof = [];
  for (const line of lines) {
    const dep = sharedDependencies(line)[0];
    if (dep?.name && declares(read("HEAD"), dep) && declares(read(null), dep)) proof.push(`${dep.name}${dep.constraint ? ` ${dep.constraint}` : ""} declared at HEAD`);
    else if (made.has(line)) proof.push(`"${line.slice(0, 80)}" made by an earlier shared change`);
    else return { present: false };
  }
  return { present: true, evidence: proof.join("; ") };
}
