// End-to-end fixtures: a temp git project with the kit installed by `kit.mjs install`, driven through the installed
// copy of ph (never the kit's own ship/) against the fake daemon and a fake Claude CLI. Offline.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main as kitMain } from "../../kit.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { KIT_DIR, makeTempDir, makeTempProject } from "../helpers/temp.mjs";

export const CALLER = "e2e00000-1111-4222-8333-444455556666";
export const TIERS = { frontier: { provider: "circle/big" }, pro: { provider: "circle/mid" }, standard: { provider: "circle/small" } };
const FAKE_CLAUDE = path.join(KIT_DIR, "tests", "install", "fake-claude.mjs");

export async function installedProject({ files = {}, responder } = {}) {
  const project = makeTempProject({ git: true, files });
  const tmp = makeTempDir("paseo kit e2e tmp ");
  const env = testEnv({ CLAUDE_CLI: FAKE_CLAUDE, PASEO_AGENT_ID: CALLER, PASEO_HARNESS_ROOT: project.root, TEMP: tmp, TMP: tmp, TMPDIR: tmp });
  const kitLines = [];
  const installCode = await kitMain(["install", project.root], { env, out: (l) => kitLines.push(l), err: (l) => kitLines.push(l) });
  assert.ok([0, 2].includes(installCode), kitLines.join("\n"));
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, responder });
  fake.addAgent({ id: CALLER, title: "leader", cwd: project.root, provider: "circle" });
  const { main } = await import(pathToFileURL(path.join(project.root, ".agents", "harness", "ph.mjs")).href);
  const ph = async (argv) => {
    let stdout = "";
    const err = [];
    const code = await main(argv, { env, cwd: project.root, clock, daemon: fake.daemon, write: (t) => (stdout += t), err: (l) => err.push(l) });
    const out = stdout.split(/\r?\n/).filter(Boolean);
    return { code, out, err, text: `${out.join("\n")}\n${err.join("\n")}` };
  };
  return { project, root: project.root, env, fake, clock, ph, installCode, kitLines };
}

export const lineMatching = (r, re) => r.out.find((l) => re.test(l)) ?? null;
