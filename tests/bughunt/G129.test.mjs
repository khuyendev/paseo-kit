import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { connectFake } from "../helpers/run.mjs";
import * as compact from "../../ship/.agents/harness/runtime/compact.mjs";
import { pidAlive } from "../../ship/.agents/harness/lib/proc.mjs";
import { CALLER, setup } from "../ph/setup.mjs";

const { armCompact, compactFiles } = compact;

const COMPACT_URL = pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "runtime", "compact.mjs")).href;

// The armer: a real armCompact whose start() spawns a watcher, then SIGKILLs the armer before it can record the
// watcher's pid. The stand-in watcher claims the lock the way the real `compact-run` does, then stays alive.
const ARMER_CODE = `
const { spawn } = await import("node:child_process");
const { armCompact } = await import(process.env.COMPACT_URL);
const ctx = { env: process.env, root: process.cwd(), cfg: { compact_resume: "Resume." }, opts: {}, out() {} };
const session = { fetchAgent: async () => ({}) };
await armCompact(ctx, session, process.env.TARGET, { start: ({ args }) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", process.env.WATCHER_CODE, ...args], { detached: true, stdio: "ignore", env: process.env, windowsHide: true });
  child.unref();
  process.kill(process.pid, "SIGKILL");
  return child.pid;
} });
`;

const WATCHER_CODE = `
const { claimCompact } = await import(process.env.COMPACT_URL);
claimCompact(process.env, process.argv[1], Number(process.argv[process.argv.indexOf("--owner") + 1]));
setTimeout(() => {}, 20000);
`;

const lockValue = (lock) => {
  try {
    return Number(fs.readFileSync(lock, "utf8"));
  } catch {
    return NaN;
  }
};

async function until(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const v = check();
    if (v) return v;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test("G129 an armer killed after its watcher spawned: the watcher takes the lock and a retry is refused", async (t) => {
  const s = setup();
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  const { lock } = compactFiles(s.env, CALLER);
  const armer = spawn(process.execPath, ["--input-type=module", "-e", ARMER_CODE], {
    env: { ...s.env, COMPACT_URL, TARGET: CALLER, WATCHER_CODE }, cwd: s.root, stdio: "ignore", windowsHide: true,
  });
  await once(armer, "exit");
  const watcher = await until(() => {
    const pid = lockValue(lock);
    return pid && pid !== armer.pid ? pid : null;
  });
  assert.ok(watcher, `the lock still holds the dead armer pid ${armer.pid}: the spawned watcher never claimed it`);
  t.after(() => process.kill(watcher));
  assert.ok(pidAlive(watcher));
  let started = 0;
  await assert.rejects(
    armCompact({ env: s.env, root: s.root, cfg: { compact_resume: "Resume." }, opts: {}, out() {} }, session, CALLER, { start: () => ((started += 1), 1) }),
    new RegExp(`compact already armed for c0ffee00 \\(watcher pid ${watcher}\\)`),
  );
  assert.equal(started, 0);
});

test("G129 a watcher whose lock was replaced does not claim it", () => {
  const s = setup();
  const { lock } = compactFiles(s.env, CALLER);
  fs.writeFileSync(lock, "1234567");
  assert.equal(compact.claimCompact(s.env, CALLER, 7654321), false);
  assert.equal(fs.readFileSync(lock, "utf8"), "1234567");
});
