// HOOK-12 benchmark: wall time of the context guard over a 1 MiB transcript, as a main session (the expensive path).
// node tests/hooks/bench_context_guard.mjs [runs=20]
import { isMain } from "../../ship/.agents/harness/lib/cli.mjs";
import { hookEnv, hookProject, runHookSync, T, writeTranscript } from "./helpers.mjs";

export function benchContextGuard(runs) {
  const project = hookProject();
  const filler = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "y".repeat(1000) }] } };
  const entries = [...Array.from({ length: 1100 }, () => filler), T.usage(100000)];
  const transcript_path = writeTranscript(project.root, entries);
  const env = hookEnv(project.root);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    const r = runHookSync(project.root, "context_guard.mjs", { session_id: `bench${i}`, transcript_path, hook_event_name: "PostToolUse" }, { env });
    times.push(performance.now() - started);
    if (r.code !== 0) throw new Error(`hook exited ${r.code}: ${r.stderr}`);
  }
  times.sort((a, b) => a - b);
  const at = (q) => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)];
  return { runs, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

if (isMain(import.meta.url)) {
  const { runs, p50, p95 } = benchContextGuard(Number(process.argv[2] ?? 20));
  console.log(`context guard over a 1 MiB transcript: p50 ${p50} ms, p95 ${p95} ms (${runs} runs)`);
}
