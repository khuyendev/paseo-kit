// A fake Claude Code engine for the harness-files mod: the subset of the engine API register.ts uses
// (session.start, tool.call hooks with one .catch, $.session, $.env, $.plugin, $.process.run, $.tool.*).
// By default process.run and the native Bash call drive the real backend in-process against a temp state root.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { runTicket, transport } from "../../ship/.agents/harness/files/backend.mjs";
import { SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";

const REGISTER = path.join(SHIP_DIR, ".claude", "plugins", "harness-files", "hooks", "register.ts");
export const loadMod = () => import(pathToFileURL(REGISTER).href);

const ok = (stdout) => ({ exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false });

export async function fakeEngine({ cwd, sessionId = "claude-session-1", env = {}, verdict = () => ({ decision: "allow" }), backendReply, bash, stateRoot = makeTempDir("paseo kit state ") } = {}) {
  const { register } = await loadMod();
  const log = { registered: [], checks: [], processes: [], bash: [], actions: [], matchers: [] };
  const hooks = { start: null, tools: new Map() };
  const opts = { stateRoot };
  const backendPath = path.join(cwd, ".agents", "harness", "files", "backend.mjs");
  const realBackend = (input) => {
    try {
      return ok(JSON.stringify({ protocol: 1, ...transport(input, opts) }));
    } catch (e) {
      return { exitCode: 1, stdout: "", stderr: `${e.message}\n`, isStdoutTruncated: false, isStderrTruncated: false };
    }
  };
  const realBash = (command) => {
    const m = /^node '(.+)' (--plan|--execute) (\S+) (\S+)$/.exec(command);
    try {
      runTicket(m[2], m[3], m[4], opts);
      return { result: { stdout: "harness-files ticket completed\n", stderr: "", interrupted: false } };
    } catch (e) {
      return { result: { stdout: "", stderr: e.message }, isError: true, text: e.message };
    }
  };
  const $ = {
    session: { cwd: async () => cwd, id: async () => sessionId },
    env: { get: async (name) => env[name] },
    plugin: { root: "C:/plugin-cache/harness-files" },
    process: {
      run: async (argv, init = {}) => {
        log.processes.push({ argv, init });
        if (String(argv[1]).endsWith("discover.mjs")) return ok(JSON.stringify({ backend: backendPath }));
        const input = JSON.parse(init.stdin);
        log.actions.push(input.action === "collect" ? `collect-${input.phase ?? "result"}` : input.action);
        return backendReply ? backendReply(input, realBackend) : realBackend(input);
      },
    },
    tool: {
      register: async (spec) => {
        log.registered.push(spec);
        return { tool: `mcp__harness-files__${spec.name}` };
      },
      check: async (q) => {
        log.checks.push(q);
        return verdict(q);
      },
      call: async (q) => {
        log.bash.push(q);
        return bash ? bash(q, realBash) : realBash(q.command);
      },
    },
  };
  const on = (pattern, a, b) => {
    const reg = { hook: b ?? a, catchFn: null };
    if (pattern === "session.start") hooks.start = reg;
    else {
      log.matchers.push(a.tool);
      hooks.tools.set(a.tool, reg);
    }
    return { catch(fn) { reg.catchFn = fn; } };
  };
  register(on, {});
  return {
    $, log, stateRoot,
    start: () => hooks.start.hook($, { cwd }, async (e) => ({ ok: true, e })),
    async call(tool, args = {}, extra = {}) {
      const reg = hooks.tools.get(`mcp__harness-files__${tool}`);
      const e = { tool: `mcp__harness-files__${tool}`, tool_use_id: "toolu_1", ...extra, ...args };
      try {
        return await reg.hook($, e, async () => ({ deny: "no core tool" }));
      } catch (err) {
        if (!reg.catchFn) throw err;
        return reg.catchFn(err);
      }
    },
  };
}
