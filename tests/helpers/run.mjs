// Running ph in-process (with the fake daemon) or any node script as a subprocess, with captured lines.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { main } from "../../ship/.agents/harness/ph.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { testEnv } from "./env.mjs";

const lines = (text) => text.split(/\r?\n/).filter((line, i, all) => line !== "" || i < all.length - 1);

export async function runPh(argv, { root, env = testEnv(), daemon, clock = createFakeClock() } = {}) {
  let stdout = "";
  let stderr = "";
  const runEnv = root ? { ...env, PASEO_HARNESS_ROOT: root } : env;
  const code = await main(argv, {
    env: runEnv,
    cwd: root ?? process.cwd(),
    clock,
    daemon: daemon?.daemon ?? daemon,
    write: (text) => (stdout += text),
    err: (line) => (stderr += `${line}\n`),
  });
  return { code, stdout, stderr, out: lines(stdout), err: lines(stderr) };
}

export function runNode(file, args = [], { cwd, env = process.env, input, timeoutMs = 60000 } = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, env, input, encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { code: r.status, stdout, stderr, out: lines(stdout), err: lines(stderr), error: r.error ?? null };
}

export const runPhProcess = (root, args, opts = {}) => runNode(path.join(root, ".agents", "harness", "ph.mjs"), args, { cwd: root, ...opts });

export function connectFake(fake, { env = testEnv(), root, cfg, clock = createFakeClock() } = {}) {
  return connect({ env, root, cfg, clock, daemon: fake.daemon });
}
