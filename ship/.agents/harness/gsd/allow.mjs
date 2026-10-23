// `ph gsd allow` (kit feedback 87 C1): the owner's answer to a Checks stop of the gate. The gate refuses a weakened check (a
// deleted test, fewer assertions, an added skip, a changed gate file or gate configuration) that no plan declared in its
// <check_changes> block; this verb appends {kind: allow, path, reason} to <phase>/owner-answers.json (lib/owner-answers.mjs), and
// every later gate of the phase accepts that path's weakening. For the harness config the answer also records the hash of the
// gate configuration it accepts, so a later change is a new weakening. `debug` stands for .planning/debug (gsd-debug's gate).
import fs from "node:fs";
import path from "node:path";
import { OVERLAY_REL } from "../config.mjs";
import { sha256 } from "../lib/hash.mjs";
import { done, fail, rel } from "./common.mjs";
import { answersFile, appendAnswer } from "./owner-answers.mjs";
import { requirePhase } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

export const DEBUG_DIR = ".planning/debug";

// Keys sorted at every level, so reordering an overlay is no change.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));
/** The settings that decide what a gate runs and what it accepts. */
export const gateConfig = (cfg) => ({ commands: cfg.adapter.commands, verify_vocabulary: cfg.adapter.verify_vocabulary, checks: cfg.adapter.checks ?? null });
export const gateConfigHash = (cfg) => sha256(canonical(gateConfig(cfg)));

export function allowVerb(g, ref, { path: filePath, reason }) {
  guardWriter(g.env);
  if (!ref) throw fail("allow needs a phase: ph gsd allow <phase | debug> --path <file> --reason <text>");
  const phase = ref === "debug" ? { dir: path.join(g.codeRoot, DEBUG_DIR) } : requirePhase(g.codeRoot, ref);
  const file = String(filePath ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!file) throw fail(`allow needs --path <the test or gate file, or ${OVERLAY_REL} for the gate configuration>`);
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split("/").includes("..")) throw fail(`allow --path must be a path inside the code root: ${file}`);
  if (/[*?[\]{}]/.test(file)) throw fail(`allow --path names one file, not a glob: ${file}`);
  const why = String(reason ?? "").trim();
  if (!why) throw fail("allow needs --reason <why this change is no weakening, or why it is accepted>");
  const config = file === OVERLAY_REL ? gateConfigHash(g.cfg) : null;
  fs.mkdirSync(phase.dir, { recursive: true });
  const entry = appendAnswer(phase, { kind: "allow", path: file, ...(config ? { config } : {}), reason: why });
  return done({ answered: entry.id, kind: "allow", path: file, ...(config ? { config } : {}), reason: why, answers: rel(g.codeRoot, answersFile(phase)), next: "rerun with the same args; every gate of this phase accepts the weakening of this path" });
}
