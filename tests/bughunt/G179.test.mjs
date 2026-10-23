// G179: the install help must not promise that a failure leaves the project untouched when wiring fails after the copy.
import assert from "node:assert/strict";
import test from "node:test";
import { HELP } from "../../kit/install/help.mjs";
import { claudeEnv, makeKit, makeProject, runKit } from "../install/helpers.mjs";

test("G179 a wiring failure after the copy leaves kit files and no manifest, and the help says so", async () => {
  const kit = makeKit();
  const p = makeProject();
  const bad = claudeEnv({ FAKE_PLUGIN_EXIT: "9" });
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit, env: bad.env });
  assert.equal(r.code, 1);
  assert.equal(p.exists(".agents/harness/runtime/a.mjs"), true, "the copy step ran before the wiring failure");
  assert.equal(p.exists(".agents/harness-kit.json"), false);

  const help = HELP.join("\n");
  assert.doesNotMatch(help, /nothing done/);
  assert.match(help, /1 usage error or refusal before any write/);
  assert.match(help, /after the first copy .*can leave kit files copied/);
  assert.match(help, /no \.agents\/harness-kit\.json; fix the cause and re-run the same install/);

  const ok = await runKit(["install", p.root, "--enable-plugin"], { kit, env: claudeEnv().env });
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(p.exists(".agents/harness-kit.json"));
});
