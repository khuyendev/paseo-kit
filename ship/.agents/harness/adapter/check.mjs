// Explicit dynamic adapter check, never called by lint. Uses the same hooks and coverage rule as the gate.
import fs from "node:fs";
import path from "node:path";
import { configRoot, loadConfig } from "../config.mjs";
import { isMain, parseArgs, UsageError } from "../lib/cli.mjs";
import { runArgv } from "../lib/proc.mjs";
import { gateObligation } from "./contract.mjs";
import { executionProblem } from "./evidence.mjs";
import { invokeHook } from "./hooks.mjs";
import { withMutex } from "./mutex.mjs";

// Opt-in executes project code (including hooks). Each call retains a fresh transcript directory.
// This is a protocol check, not a GSD gate or proof that a project's evidence parser is truthful.
export async function checkObligation(cfg, { codeRoot, kind, command, outputDir, execute = false }) {
  if (!execute) throw new UsageError("adapter check executes project code; explicit --run opt-in required");
  const parent = path.resolve(codeRoot, outputDir ?? "_workspace/adapter-check");
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, "check-"));
  const record = { v: 1, kind, command, outcome: "failed", reason: null, directory: dir };
  const finish = (reason = null) => {
    record.reason = reason;
    record.outcome = reason ? "failed" : "passed";
    fs.writeFileSync(path.join(dir, "check.json"), JSON.stringify(record, null, 2) + "\n", "utf8");
    return record;
  };
  return withMutex(cfg.adapter.mutex, async () => {
    const ob = await gateObligation(cfg, { codeRoot, kind, command });
    record.obligation = ob;
    if (ob.outcome !== "ready") return finish(ob.reason ?? ob.outcome);
    const entry = cfg.adapter.verify_vocabulary[kind];
    if (entry.resolver) {
      record.resolve = await invokeHook(cfg, { codeRoot, script: entry.resolver, op: "resolve",
        kind, targets: ob.targets, plan: "adapter-self-check", filesModified: [] });
      if (!record.resolve.ok) return finish(record.resolve.reason);
      const bad = record.resolve.response.results.filter((r) => r.status !== "ok");
      if (bad.length) return finish(bad.map((r) => `${r.target}: ${r.status}`).join(", "));
    }
    const run = await runArgv(ob.argv, { cwd: codeRoot, timeoutMs: ob.timeoutS * 1000 });
    const stdoutPath = path.join(dir, "stdout.log");
    const stderrPath = path.join(dir, "stderr.log");
    fs.writeFileSync(stdoutPath, run.stdout, "utf8");
    fs.writeFileSync(stderrPath, run.stderr, "utf8");
    record.runner = { exitCode: run.code, timedOut: run.timedOut, error: run.error ? String(run.error) : null, stdoutPath, stderrPath };
    let executed = { count: null, targets: [] };
    if (ob.evidenceParser) {
      record.evidence = await invokeHook(cfg, { codeRoot, script: ob.evidenceParser, op: "evidence",
        kind, argument: ob.argument, targets: ob.targets, exitCode: run.code, stdoutPath, stderrPath });
      if (!record.evidence.ok) return finish(record.evidence.reason);
      executed = record.evidence.response.executed;
    }
    if (run.timedOut || run.error || run.code !== 0) return finish(`runner did not succeed (exit ${run.code})`);
    if (record.evidence && (record.evidence.response.outcome !== "passed" || record.evidence.response.failed.length)) {
      return finish("evidence reports failure or unavailable");
    }
    return finish(executionProblem({ targets: ob.targets, executed, exitCodeSufficient: ob.exitCodeSufficient }));
  });
}

if (isMain(import.meta.url)) {
  try {
    const { opts, args } = parseArgs(process.argv.slice(2), { kind: "string", command: "string", output: "string", run: "bool" });
    if (args.length || !opts.kind || !opts.command) throw new UsageError("usage: node .agents/harness/adapter/check.mjs --kind <kind> --command <obligation> --run [--output <dir>]");
    const codeRoot = configRoot();
    const result = await checkObligation(loadConfig(codeRoot), { codeRoot, kind: opts.kind, command: opts.command, outputDir: opts.output, execute: opts.run });
    console.log(JSON.stringify(result));
    process.exitCode = result.outcome === "passed" ? 0 : 2;
  } catch (e) {
    console.error(`failed: ${e.message}`);
    process.exitCode = 1;
  }
}
