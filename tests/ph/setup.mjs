// Shared fixtures of the ph tests: a temp project with configured tiers, a caller agent on the fake daemon, runPh.
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runPh } from "../helpers/run.mjs";
import { makeTempDir, makeTempProject } from "../helpers/temp.mjs";

export const CALLER = "c0ffee00-1111-4222-8333-444455556666";

export const TIERS = {
  frontier: { provider: "circle/front-model[1m]", thinking: "high" },
  pro: { provider: "circle/pro-model[1m]", thinking: "high" },
  standard: { provider: "circle/std-model[1m]", thinking: "low" },
};

export function setup({ overlay = {}, git = false, files = {}, caller = true, fake: fakeOpts = {} } = {}) {
  const project = makeTempProject({ git, files, overlay: { tiers: TIERS, ...overlay } });
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, ...fakeOpts });
  if (caller) fake.addAgent({ id: CALLER, title: "leader", cwd: project.root, provider: "circle" });
  const tmp = makeTempDir("paseo kit tmp ");
  const env = testEnv({ PASEO_AGENT_ID: caller ? CALLER : undefined, TEMP: tmp, TMP: tmp, TMPDIR: tmp });
  const ph = (argv, opts = {}) => runPh(argv, { root: project.root, env: opts.env ?? env, daemon: fake, clock });
  return { project, root: project.root, clock, fake, env, ph, tmp };
}

export const creates = (fake) => fake.callsOf("createAgent").map((c) => c.args[0]);

export const addSub = (fake, partial = {}) => fake.addAgent({ parent: CALLER, ...partial });

// Lets queued fake-daemon macrotasks (turns started by createAgent) run.
export const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
