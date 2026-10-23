// Shell-side helper of the GSD workflow scripts. Scripts have no file or git API (FLOW-02), so every
// file read, guarded write and git inspection they need runs here: `node .agents/workflows/lib/gsd-flow.mjs <cmd> ...`.
// Output follows the ph gsd rule: one JSON document on the last stdout line; exit 0 ok, 1 negative verdict or error.
import fs from "node:fs";
import { configRoot } from "../../harness/config.mjs";
import { errText, isMain } from "../../harness/lib/cli.mjs";
import * as files from "./flow-files.mjs";
import * as map from "./flow-map.mjs";
import { head } from "./flow-git.mjs";
import * as project from "./flow-project.mjs";
import * as execute from "./flow-execute.mjs";
import * as review from "./flow-review.mjs";
import * as gate from "./flow-gate.mjs";
import * as validation from "./flow-validation.mjs";

const COMMANDS = {
  exists: (root, args) => files.exists(root, args),
  read: (root, [p]) => files.read(root, p),
  write: (root, [p], input) => files.write(root, p, input),
  append: (root, [p], input) => files.append(root, p, input),
  "json-push": (root, [p], input) => files.jsonPush(root, p, JSON.parse(input)),
  secrets: (root, args) => map.secrets(root, args),
  stamp: (root, args) => map.stamp(root, args.length ? args : undefined),
  drift: (root, [threshold]) => map.drift(root, Number(threshold)),
  "map-check": (root, args) => map.mapCheck(root, args.length ? args : undefined),
  head: (root) => ({ commit: head(root) }),
  "draft-check": (root) => project.draftCheck(root),
  "summary-heal": (root, args, input) => project.summaryHeal(root, input, { stale: args.includes("--stale") }),
  "anti-patterns": (root, [phaseDir]) => execute.antiPatterns(root, phaseDir),
  "cwd-guard": (root, [worktreeDir]) => execute.cwdGuard(root, worktreeDir, process.cwd()),
  baseline: (root, [phaseDir]) => execute.recordBaseline(root, phaseDir),
  "resume-gate": (root, [phaseDir], input) => execute.resumeGate(root, phaseDir, JSON.parse(input)),
  transfer: (root, [phaseDir], input) => execute.transfer(root, phaseDir, JSON.parse(input)),
  adopt: (root, [phaseDir, plan, rel]) => execute.adopt(root, phaseDir, plan, rel),
  "owned-changes": (root, [phaseDir], input) => execute.ownedChanges(root, phaseDir, JSON.parse(input)),
  "smoke-due": (root, _args, input) => execute.smokeDue(JSON.parse(input)),
  "schedule-graph": (root, _args, input) => execute.scheduleGraph(root, JSON.parse(input)),
  "dirty-owned": (root, [phaseDir], input) => execute.dirtyOwned(root, phaseDir, JSON.parse(input)),
  "execution-inputs": (root) => execute.executionInputs(root),
  "dependency-seed": (root, [phaseDir], input) => execute.dependencySeed(root, phaseDir, JSON.parse(input)),
  "pending-transfers": (root, [phaseDir]) => execute.pendingTransfers(root, phaseDir),
  owners: (root, _args, input) => execute.ownersOf(root, JSON.parse(input)),
  remove: (root, [p]) => files.remove(root, p),
  lock: (root, [name, runId, kind]) => files.lock(root, name, runId, undefined, kind ?? null),
  unlock: (root, [name, runId]) => files.unlock(root, name, runId),
  "lock-check": (root, [name, runId]) => files.lockCheck(root, name, runId),
  digest: (root, _args, input) => gate.digest(root, JSON.parse(input)),
  gate: (root, [phaseDir], input) => gate.gate(root, phaseDir, JSON.parse(input)),
  "evidence-check": (root, [p], input) => gate.evidenceCheck(root, p, input ? JSON.parse(input).plans ?? [] : []),
  "spot-check": (root, [summary]) => execute.spotCheck(root, summary),
  "review-scope": (root, [phaseDir], input) => review.reviewScope(root, phaseDir, JSON.parse(input)),
  "review-record": (root, [phaseDir], input) => review.writeRecord(root, phaseDir, JSON.parse(input)),
  "prereview-record": (root, [phaseDir], input) => review.writePrereview(root, phaseDir, JSON.parse(input)),
  "validation-strategy": (root, [phaseDir]) => validation.validationStrategy(root, phaseDir),
  "changed-lines": (root, [phaseDir], input) => review.changedLines(root, phaseDir, JSON.parse(input)),
  "quick-dir": (root, [slugSource]) => project.quickDir(root, slugSource),
  "quick-verification": (root, [dir, action]) => project.quickVerification(root, dir, action),
  "forensics-path": (root, _args, input) => project.forensicsPath(root, input),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

// Verbs whose handler reads JSON or text from stdin; every other verb never touches stdin, so a person running
// `gsd-flow.mjs remove <path>` from a shell whose stdin is an open pipe is not left waiting (G088).
const STDIN = new Set(["write", "append", "json-push", "summary-heal", "resume-gate", "transfer", "owned-changes", "smoke-due", "schedule-graph", "dirty-owned", "dependency-seed", "owners", "digest", "gate", "evidence-check", "review-scope", "review-record", "prereview-record", "changed-lines", "forensics-path"]);
export const readsStdin = (cmd) => STDIN.has(cmd);

export async function main(argv, { root = configRoot(), input = "", out = (l) => process.stdout.write(`${l}\n`) } = {}) {
  const [cmd, ...args] = argv;
  const fn = COMMANDS[cmd];
  if (!fn) {
    out(JSON.stringify({ status: "error", error: `unknown command ${cmd ?? "(none)"}; one of ${COMMAND_NAMES.join(", ")}` }));
    return 1;
  }
  try {
    const { code = 0, ...json } = await fn(root, args, typeof input === "function" ? input() : input);
    out(JSON.stringify(json));
    return code;
  } catch (e) {
    out(JSON.stringify({ status: "error", error: errText(e) }));
    return 1;
  }
}

if (isMain(import.meta.url)) {
  const cmd = process.argv[2];
  const input = () => (process.stdin.isTTY || !readsStdin(cmd) ? "" : fs.readFileSync(0, "utf8"));
  process.exitCode = await main(process.argv.slice(2), { input });
}
