// Command contract of the stack skill (kit-feedback 81): every wrapper command the stack skill prescribes to workers
// (`node tools/adapter/<tool>.mjs <subcommand> ...`) must be exercised by an adapter.commands entry or an
// adapter.command_probes entry, and `ph harness lint` runs each probe (a harmless form of the command) to prove the
// wrapper accepts it. Static coverage is a warning; a probe the wrapper rejects is a failure.
import fs from "node:fs";
import path from "node:path";
import { runArgv } from "../lib/proc.mjs";
import { errText } from "../lib/cli.mjs";
import { OVERLAY_REL } from "../config.mjs";
import { readText } from "../lib/io.mjs";
import { fileTestArgvs } from "./contract.mjs";

const PROBE_TIMEOUT_S = 20;
const TAIL_CHARS = 2000;
const WRAPPER = /\bnode\s+((?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[cm]?js)((?:\s+[^\s`'"|&;<>]+){0,2})/g;

// Code the text shows as commands: fenced blocks and inline spans.
function codeParts(text) {
  const parts = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) parts.push(line);
    else for (const m of line.matchAll(/`([^`]+)`/g)) parts.push(m[1]);
  }
  return parts;
}

// [{script, sub}]: the repo-relative node scripts the text runs and the subcommand word after each (null when none or an option).
export function prescribedCommands(text) {
  const seen = new Map();
  for (const part of codeParts(text)) {
    for (const m of part.matchAll(WRAPPER)) {
      const script = m[1].replace(/^\.\//, "");
      const first = m[2].trim().split(/\s+/)[0] ?? "";
      const sub = /^[a-z][\w-]*$/.test(first) ? first : null;
      seen.set(`${script}\0${sub ?? ""}`, { script, sub });
    }
  }
  return [...seen.values()];
}

// Every argv the adapter runs or probes.
function adapterArgvs(a) {
  return [a.commands.build, a.commands.test, ...a.commands.gates.map((g) => g.argv), ...Object.values(a.commands.verify).map((v) => v.argv), ...(a.commands.smoke_builds ?? []),
    a.dependency_probe, ...Object.values(a.syntax_checkers).map((v) => v.argv), ...(a.command_probes ?? []).map((p) => p.argv)].filter(Boolean);
}

const covers = (argv, { script, sub }) => {
  const i = argv.findIndex((w) => typeof w === "string" && w.replace(/^\.\//, "") === script);
  return i >= 0 && (!sub || argv[i + 1] === sub);
};

// Warnings: wrapper commands of the stack skill that no adapter command or probe runs.
export function lintCommandContract(root, cfg) {
  const a = cfg.adapter;
  const rel = a.stack_skill ? `.claude/skills/${a.stack_skill}/SKILL.md` : null;
  const file = rel ? path.join(root, rel) : null;
  if (!file || !fs.existsSync(file)) return [];
  const argvs = adapterArgvs(a);
  return prescribedCommands(readText(file))
    .filter((c) => fs.existsSync(path.join(root, c.script)) && !argvs.some((argv) => covers(argv, c)))
    .map((c) => ({ level: "warn", file: rel, line: null, msg: `prescribes \`node ${c.script}${c.sub ? ` ${c.sub}` : ""}\` but no adapter.commands entry or adapter.command_probes entry runs it; add a probe (a harmless form: --version, or a read-only check of one file) so ph harness lint proves the wrapper accepts it (a Dart command needs its own sanctioned invocation, not the Flutter one)` }));
}

// Runs every adapter.command_probes argv in the project root; a probe that exits non-zero, times out or cannot start fails.
export async function runCommandProbes(root, cfg, { env = process.env } = {}) {
  const findings = [];
  for (const probe of cfg.adapter.command_probes ?? []) {
    const where = `adapter.command_probes.${probe.name}`;
    const missing = probe.argv.filter((w) => /^(?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)+\.(?:[cm]?js|py|sh|ps1|bat|cmd)$/i.test(w)).find((w) => !fs.existsSync(path.resolve(root, w)));
    if (missing) continue;
    const secs = probe.timeout_s ?? PROBE_TIMEOUT_S;
    const run = await runArgv(probe.argv, { cwd: root, env, timeoutMs: secs * 1000, tailChars: TAIL_CHARS });
    const output = `${run.stderr}${run.stdout}`.trim().split(/\r?\n/).find(Boolean)?.slice(0, 300);
    const fail = (msg) => findings.push({ level: "fail", file: OVERLAY_REL, line: null, msg: `${where}: ${msg}` });
    if (run.timedOut) fail(`\`${probe.argv.join(" ")}\` timed out after ${secs}s`);
    else if (run.error || run.code === null) fail(`\`${probe.argv.join(" ")}\` could not run: ${run.error ? errText(run.error) : "stopped by a signal"}`);
    else if (run.code !== 0) fail(`the wrapper rejects \`${probe.argv.join(" ")}\` (exit ${run.code}${output ? `: ${output}` : ""})`);
  }
  return findings;
}

const SKIP_DIR = new Set(["node_modules", ".git", ".claude", "_workspace", "dist", "build", "Binaries", "Intermediate"]);

// The first test file under the project, links not followed, a few heavy directories skipped. Null when none.
function firstTestFile(root, isTest) {
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 4000) {
    const dir = stack.pop();
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of names) {
      if (++seen > 4000) return null;
      if (ent.isSymbolicLink?.() || ent.isSymbolicLink()) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIR.has(ent.name)) stack.push(abs);
      } else if (ent.isFile()) {
        const rel = abs.slice(root.length).replace(/^[/\\]/, "").replace(/\\/g, "/");
        if (isTest(rel)) return rel;
      }
    }
  }
  return null;
}

/**
 * Kit feedback 11: run test_file_args once with one test file. A quick non-zero exit is a refusal. A timeout means the
 * command accepted the file and was still running; the process tree is killed and that is not a failure.
 */
export async function runTestFileProbe(root, cfg, { env = process.env, run = runArgv } = {}) {
  const commands = cfg.adapter?.commands;
  if (!commands?.test_file_args) return [];
  const { isTestFile } = await import("../../workflows/lib/flow-checks.mjs");
  const file = firstTestFile(root, (rel) => isTestFile(rel, cfg.adapter.checks ?? {}));
  if (!file) return [{ level: "warn", file: OVERLAY_REL, line: null, msg: "adapter.commands.test_file_args is set but no test file was found to probe" }];
  const argv = fileTestArgvs(commands, [file], commands.test ?? [])[0];
  const missing = argv.filter((w) => /^(?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)+\.(?:[cm]?js|py|sh|ps1|bat|cmd)$/i.test(w)).find((w) => !fs.existsSync(path.resolve(root, w)));
  if (missing) return [];
  const secs = PROBE_TIMEOUT_S;
  const ran = await run(argv, { cwd: root, env, timeoutMs: secs * 1000, tailChars: TAIL_CHARS });
  if (ran.timedOut || ran.code === 0) return [];
  const output = `${ran.stderr ?? ""}${ran.stdout ?? ""}`.trim().split(/\r?\n/).find(Boolean)?.slice(0, 300);
  const why = ran.error || ran.code === null ? `could not run: ${ran.error ? errText(ran.error) : "stopped by a signal"}` : `refuses ${file} (exit ${ran.code}${output ? `: ${output}` : ""})`;
  return [{ level: "fail", file: OVERLAY_REL, line: null, msg: `adapter.commands.test_file_args: \`${argv.join(" ")}\` ${why}` }];
}
