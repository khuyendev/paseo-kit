// Kit feedback #62: a kit update and ph doctor run the gsd workflows' own argument checks on the merged config, so an
// overlay value the kit refuses (a skeleton lane lens that G029 no longer accepts) is reported before the first run.
// kit.mjs update also lists the overlay keys the CHANGELOG names in entries newer than the installed version.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig, loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { SKELETON_KIT_LENSES, workflowArgProblems } from "../../ship/.agents/harness/gsd/workflow-args.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { changedOverlayKeys } from "../../kit/install/overlay.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { makeKit, makeProject, runKit } from "../install/helpers.mjs";
import { setup } from "../ph/setup.mjs";

const G029_OVERLAY = { gsd: { skeleton_lanes: [{ lens: "correctness" }, { lens: "source-grounding" }] } };
const REFUSAL = (i, lens) => `gsd.skeleton_lanes[${i}].lens: '${lens}' is neither a skeleton kit lens (fidelity, integration) nor an adapter.review_lenses entry of stage skeleton; gsd-plan stops before its first agent`;
const PLENTY = () => 64 * 2 ** 30;

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem: PLENTY, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return { code, out };
}

test("F62 a skeleton lane naming a code-stage lens (G029) is refused with the gsd-plan reason", () => {
  const cfg = loadConfig(makeTempProject({ overlay: G029_OVERLAY }).root);
  assert.deepEqual(workflowArgProblems(cfg), [REFUSAL(0, "correctness"), REFUSAL(1, "source-grounding")]);
});

test("F62 the shipped skeleton lanes (fidelity, integration) pass the workflow check", () => {
  assert.deepEqual(workflowArgProblems(loadConfig(makeTempProject({ overlay: {} }).root)), []);
});

test("F62 an adapter review lens of stage skeleton resolves a lane; a code-stage lens of the same name does not", () => {
  const lens = { name: "layout-skeleton", text: "Check the layout skeleton.", stage: "skeleton" };
  const ok = loadConfig(makeTempProject({ overlay: { adapter: { review_lenses: [lens] }, gsd: { skeleton_lanes: [{ lens: "layout-skeleton" }] } } }).root);
  assert.deepEqual(workflowArgProblems(ok), []);
  const code = { ...lens, stage: "code" };
  const bad = loadConfig(makeTempProject({ overlay: { adapter: { review_lenses: [code] }, gsd: { skeleton_lanes: [{ lens: "layout-skeleton" }] } } }).root);
  assert.deepEqual(workflowArgProblems(bad), [REFUSAL(0, "layout-skeleton")]);
});

test("F62 the kit's skeleton kit lenses are the ones gsd-plan.js accepts (same list in the workflow and the check)", () => {
  const src = fs.readFileSync(path.join(SHIP_DIR, ".agents", "workflows", "gsd-plan.js"), "utf8");
  const listed = /const KIT_LENSES = \[([^\]]*)\];/.exec(src)?.[1];
  assert.ok(listed, "gsd-plan.js declares KIT_LENSES");
  assert.deepEqual(JSON.parse(`[${listed}]`), [...SKELETON_KIT_LENSES]);
});

test("F62 ph doctor reports each refused skeleton lane lens as a problem and exits 2", async () => {
  const s = setup({ overlay: G029_OVERLAY });
  const r = await doctor(s);
  assert.equal(r.code, 2);
  assert.ok(r.out.includes(`problem ${REFUSAL(0, "correctness")}`), r.out.join("\n"));
  assert.ok(r.out.includes(`problem ${REFUSAL(1, "source-grounding")}`), r.out.join("\n"));
});

test("F62 ph doctor on the shipped lanes says the workflow arguments resolve", async () => {
  const s = setup();
  const r = await doctor(s);
  assert.ok(r.out.includes("ok workflow arguments: every skeleton lane lens resolves"), r.out.join("\n"));
  assert.equal(r.out.some((l) => l.startsWith("problem gsd.skeleton_lanes")), false);
});

test("F62 kit update reports the refused lanes as problems and exits 2; fixed lanes exit 0", async () => {
  const kit = makeKit();
  const p = makeProject({ ".agents/harness.config.json": `${JSON.stringify(G029_OVERLAY)}\n` });
  await runKit(["install", p.root], { kit });
  const refused = await runKit(["update", p.root], { kit });
  assert.equal(refused.code, 2);
  assert.ok(refused.out.includes(`problem ${REFUSAL(0, "correctness")}`), refused.out.join("\n"));
  p.write(".agents/harness.config.json", `${JSON.stringify({ gsd: { skeleton_lanes: [{ lens: "fidelity" }] } })}\n`);
  const fixed = await runKit(["update", p.root], { kit });
  assert.equal(fixed.code, 0, fixed.out.join("\n"));
  assert.equal(fixed.out.some((l) => l.startsWith("problem")), false);
});

test("F62 changedOverlayKeys lists overlay keys named in sections newer than the installed version", () => {
  const changelog = [
    "# Changelog", "", "## [Unreleased]", "", "- Lanes: `gsd.skeleton_lanes` now take skeleton lenses only.", "",
    "## [0.0.1] - 2026-10-20", "", "- Roles: `gsd.roles.fixer.effort` is set here.", "",
  ].join("\n");
  const overlay = { gsd: { skeleton_lanes: [{ lens: "fidelity" }], roles: { fixer: { model: "pro" } } } };
  assert.deepEqual(changedOverlayKeys(changelog, "0.0.1", overlay), [{ key: "gsd.skeleton_lanes", sections: ["Unreleased"] }]);
  assert.deepEqual(changedOverlayKeys(changelog, "0.0.0", overlay), [{ key: "gsd.skeleton_lanes", sections: ["Unreleased"] }]);
  assert.deepEqual(changedOverlayKeys(changelog, "0.0.1", {}), []);
});

test("F62 kit update names the overlay keys the kit CHANGELOG changed since the installed version", async () => {
  const kit = makeKit({ version: "0.0.1" });
  fs.writeFileSync(path.join(kit.dir, "CHANGELOG.md"), "## [Unreleased]\n\n- `gsd.skeleton_lanes` takes skeleton lenses.\n\n## [0.0.1] - 2026-10-20\n\n- `gsd.roles` set.\n");
  const p = makeProject({ ".agents/harness.config.json": `${JSON.stringify({ gsd: { skeleton_lanes: [{ lens: "fidelity" }], roles: {} } })}\n` });
  await runKit(["install", p.root], { kit });
  const u = await runKit(["update", p.root], { kit });
  const notes = u.out.filter((l) => l.startsWith("warning overlay key"));
  assert.equal(notes.length, 1, u.out.join("\n"));
  assert.match(notes[0], /^warning overlay key gsd\.skeleton_lanes: the CHANGELOG names it in \[Unreleased\] \(since 0\.0\.1\)/);
});
