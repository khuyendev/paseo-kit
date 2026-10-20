// Execute fixtures: a planned phase with handoff files on a real git repo, a fake ph gsd whose commit verb
// commits for real, and an executor responder that writes owned files and the granted SUMMARY.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeWorld, PHASE_DIR, planText } from "./world.mjs";

const NODE = process.execPath;
export const TEST_ARGV = [NODE, "-e", "process.exit(require('fs').existsSync('fail.flag')?1:0)"];

const summaryOf = (id) => `${PHASE_DIR}/${id}-SUMMARY.md`;
export const task = (id, extra = {}) => ({ key: id, plan: id, planHash: `h-${id}`, summary: summaryOf(id), owns: [`Path:src/${id}/`, summaryOf(id)], verify: [], tracer: false, ...extra });

// waves: [[task, ...], ...]; plans get frontmatter wave/depends/files_modified from opts.meta[id].
export function makeExecWorld({ waves = [[task("01-01"), task("01-02")]], overlay = {}, meta = {}, prefix = "" } = {}) {
  const files = { ".gitignore": ".claude/worktrees/\n_workspace/\n" };
  waves.forEach((tasks, i) => {
    files[`${PHASE_DIR}/handoff/${prefix}w${i + 1}.args.json`] = JSON.stringify({ wave: i + 1, waveId: `${prefix}w${i + 1}`, tasks });
    for (const t of tasks) {
      const m = meta[t.plan] ?? {};
      files[`${PHASE_DIR}/${t.plan}-PLAN.md`] = planText(t.plan, { wave: i + 1, gap: m.gap, depends: m.depends ?? [] }).replace("---\n<tasks>", `files_modified: [${(m.files ?? []).join(", ")}]\n---\n<tasks>`);
      files[`src/${t.plan}/.keep`] = "";
    }
  });
  const commands = { build: null, test: TEST_ARGV, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const w = makeWorld({ files, overlay: { ...overlay, gsd: { isolation: "shared", ...overlay.gsd }, adapter: { commands, ...overlay.adapter } } });
  const git = (...args) => spawnSync("git", args, { cwd: w.root, encoding: "utf8", windowsHide: true });
  w.git = git;
  w.scope = {};
  const baseIndex = w.gsd.handlers["phase-plan-index"];
  const plans = () => baseIndex().plans;
  w.gsd.on("phase-plan-index", () => {
    const list = plans().map((p) => {
      const text = w.read(`${PHASE_DIR}/${p.id}-PLAN.md`);
      const halted = fs.existsSync(path.join(w.root, `${PHASE_DIR}/${p.id}-HALT.json`));
      const fm = (/files_modified: \[(.*)\]/.exec(text)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return { ...p, halted, files_modified: fm, ...(meta[p.id]?.noGapKey ? { gap_closure: undefined } : {}) };
    });
    for (const p of list) {
      p.blocked_by = p.depends_on.filter((d) => { const q = list.find((x) => x.id === d); return q && (q.halted || !q.has_summary); });
      p.ready = !p.has_summary && !p.halted && p.blocked_by.length === 0;
    }
    return { plans: list, runnable: list.filter((p) => p.ready).map((p) => p.id) };
  });
  w.gsd.on("check evaluation-scope", (argv) => w.scope[argv[argv.indexOf("--plan") + 1]] ?? { status: "resolved", commits: [], files: [] });
  w.gsd.on("normalize-test-command", ([cmd]) => ({ command: cmd }));
  w.gsd.on("state wave", (argv, input) => { w.events.push(`state wave ${argv[argv.indexOf("--wave") + 1]} ${JSON.parse(input).verify}`); return { updated: ["wave log"] }; });
  w.gsd.on("commit", (argv) => {
    const [message, , ...rest] = argv;
    const files = rest.filter((f) => f !== "--files-removed");
    git("add", "--", ...files);
    const c = git("commit", "-q", "-m", message);
    if (c.status !== 0) return { code: 1, json: { committed: false, error: c.stderr } };
    w.events.push(`commit ${message.split("\n")[0]}`);
    return { committed: true, hash: git("rev-parse", "HEAD").stdout.trim() };
  });
  w.gsd.on("verification status", () => ({ code: 66, json: { status: "missing" } }));
  return w;
}

// Executor fake: writes src/<plan>/impl.js and the SUMMARY (in its worktree when it has one).
export function executor(w, overrides = {}) {
  return async (prompt, o, n, calls) => {
    for (const [prefix, fn] of Object.entries(overrides)) if (o.label.startsWith(prefix)) { const v = await fn(prompt, o, n, calls); if (v !== undefined) return v; }
    if (o.label.startsWith("exec-")) {
      const id = o.label.slice(5);
      const base = calls.find((c) => c.n === n)?.worktree ?? "";
      const at = (rel) => (base ? `${base}/${rel}` : rel);
      w.write(at(`src/${id}/impl.js`), `impl ${id}\n`);
      w.write(at(summaryOf(id)), `---\nkey-files:\n  created: [src/${id}/impl.js]\n---\ndone\n`);
      return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
    }
    if (o.label.startsWith("review-")) return { findings: [] };
    if (o.label.startsWith("fix-") || o.label.startsWith("integration-fix")) { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { taskResults: [], status: "fixed" }; }
    if (o.label.startsWith("batch-fixer") || o.label.startsWith("fix-review")) { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { status: "fixed", attempts: 1, remaining_failures: 0 }; }
    if (o.label.startsWith("resolve-")) return { resolution: [...prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], resolved: true, evidence: "fixed" })) };
    if (o.label.startsWith("verify-findings")) return { verdicts: [...prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], verdict: "confirmed" })) };
    return null;
  };
}
