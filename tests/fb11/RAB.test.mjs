// Kit feedback 117 follow-up (RAB): drop tool-only steps, backtick template @ lines, drop modes the config cannot turn on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { applyTemplates, cutRole, rewritePaths, templateProblems } from "../../ship/.agents/harness/gsd/upstream.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "../gsd-core/fixture.mjs";

const KIT = fileURLToPath(new URL("../../", import.meta.url));
const SHA = "2222222222222222222222222222222222222222";

const BODY = [
  "<tdd_integration>",
  "TDD body.",
  "</tdd_integration>",
  "",
  "<mvp_mode_verification>",
  "MVP body.",
  "</mvp_mode_verification>",
  "",
  "<execution_context>",
  "@~/.claude/gsd-core/workflows/execute-plan.md",
  "@.planning/PROJECT.md",
  "</execution_context>",
  "",
  "<step name=\"load_graph_context\">",
  "Use the graphify CLI or gsd_run.",
  "</step>",
  "",
  "## Dimension 8: Nyquist Compliance",
  "Read nyquist.",
  "### Check 8f - Stated Failing Direction (#3172)",
  "Keep the failing direction.",
  "",
].join("\n");

const ENTRY = {
  installed: ".agents/agents/gsd-x.md",
  replaces: [
    "step:load_graph_context",
    { section: "tdd_integration", unless: "tdd_mode" },
    { section: "mvp_mode_verification", unless: "mvp_mode" },
  ],
  spans: [{ id: "nyquist_dimension", unless: "validation_strategy", from: "## Dimension 8: Nyquist Compliance", until: "### Check 8f - Stated Failing Direction (#3172)" }],
  templates: [{ id: "plan_md", from: "<execution_context>", until: "</execution_context>" }],
};

const flags = (over = {}) => ({ docTools: false, tdd: false, mvp: false, nyquist: true, ...over });

test("RAB A1 the graph step is dropped and no flag brings it back; a mode off drops and on keeps", () => {
  const off = cutRole(BODY, ENTRY, flags());
  assert.match(off.text, /kit: step:load_graph_context replaced/);
  assert.doesNotMatch(off.text, /graphify|gsd_run/);
  assert.doesNotMatch(off.text, /TDD body|MVP body/);
  assert.match(off.text, /Read nyquist\./);
  const on = cutRole(BODY, ENTRY, flags({ tdd: true, mvp: true, nyquist: false }));
  assert.match(on.text, /<tdd_integration>\nTDD body\./);
  assert.match(on.text, /<mvp_mode_verification>\nMVP body\./);
  assert.doesNotMatch(on.text, /graphify/);
  assert.doesNotMatch(on.text, /Read nyquist\./);
  assert.match(on.text, /Keep the failing direction\./);
  assert.throws(() => cutRole(BODY, { installed: "x", replaces: [{ section: "tdd_integration", unless: "tool:graphify" }] }, flags()), /unknown unless/);
});

test("RAB A2 a template @ becomes a backticked path and is not a load line", () => {
  const cut = cutRole(BODY, ENTRY, flags());
  const rewritten = rewritePaths(cut.text);
  const out = applyTemplates(rewritten, ENTRY.templates, ENTRY.installed);
  assert.deepEqual(templateProblems(rewritten, out, ENTRY.templates, ENTRY.installed), []);
  assert.match(out, /`\.agents\/gsd\/upstream\/gsd-core\/workflows\/execute-plan\.md`/);
  assert.match(out, /`\.planning\/PROJECT\.md`/);
  const fence = out.slice(out.indexOf("<execution_context>"), out.indexOf("</execution_context>"));
  assert.doesNotMatch(fence, /@/);
});

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

test("RAB build drops graphify with no adapter key, modes follow config, and check flags a stale config", async () => {
  const clone = makeTempDir("paseo kit rab clone ");
  const target = makeTempDir("paseo kit rab target ");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${SHA} refs/heads/next\n`,
    LICENSE: "MIT\n",
    "agents/gsd-x.md": `---\nname: gsd-x\ntools: Read\n---\n${BODY}`,
    "gsd-core/workflows/execute-plan.md": "plan workflow\n",
  });
  const inventory = {
    v: 1,
    snapshot: ".agents/gsd/upstream",
    entries: [{
      installed: ".agents/agents/gsd-x.md",
      kind: "agent",
      source: "agents/gsd-x.md",
      transformations: ["path-rewrite"],
      overlay: null,
      model: "pro",
      description: "X role",
      include: [],
      replaces: ENTRY.replaces,
      spans: ENTRY.spans,
      templates: ENTRY.templates,
    }],
    extra_verbs: {},
  };
  writeTree(target, { ".agents/gsd/inventory.json": JSON.stringify(inventory, null, 2) });
  const up = (sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);
  assert.equal((await up("vendor", ["--from", clone, "--commit", SHA])).code, 0);
  assert.equal((await up("build")).code, 0, "build");
  const agent = () => fs.readFileSync(path.join(target, ".agents/agents/gsd-x.md"), "utf8");
  assert.doesNotMatch(agent(), /graphify|TDD body|MVP body/);
  assert.match(agent(), /`\.agents\/gsd\/upstream\/gsd-core\/workflows\/execute-plan\.md`/);
  assert.match(agent(), /Read nyquist\./);
  assert.match(agent(), /config [0-9a-f]{12}/);
  assert.equal((await up("check")).code, 0, (await up("check")).stdout);

  writeTree(target, { ".agents/harness.config.json": JSON.stringify({ gsd: { tdd_mode: true, mvp_mode: true, validation_strategy: false } }) });
  const stale = await up("check");
  assert.equal(stale.code, 1);
  assert.match(stale.stdout, /built for a different config/);
  assert.match(stale.stdout, /ph gsd upstream build/);
  assert.equal((await up("build")).code, 0);
  assert.match(agent(), /TDD body/);
  assert.match(agent(), /MVP body/);
  assert.doesNotMatch(agent(), /graphify|Read nyquist/);
  assert.match(agent(), /Keep the failing direction/);
  assert.equal((await up("check")).code, 0, (await up("check")).stdout);

  const bad = makeTempDir("paseo kit rab bad ");
  writeTree(bad, { ".agents/harness.config.json": JSON.stringify({ adapter: { tools: ["graphify"] } }) });
  assert.throws(() => loadConfig(bad), /unknown key/);
});

test("RAB the shipped roles drop graphify, TDD and MVP, and the plan template is not an @ load", () => {
  const agents = path.join(KIT, "ship/.agents/agents");
  const planner = fs.readFileSync(path.join(agents, "gsd-planner.md"), "utf8");
  const fence = planner.slice(planner.indexOf("<execution_context>"), planner.indexOf("</execution_context>"));
  assert.match(fence, /`\.agents\/gsd\/upstream\/gsd-core\/workflows\/execute-plan\.md`/);
  assert.match(fence, /`\.agents\/gsd\/upstream\/gsd-core\/templates\/summary\.md`/);
  assert.doesNotMatch(fence, /@/);
  assert.match(planner, /<discovery_levels>/);
  assert.doesNotMatch(planner, /<tdd_integration>|step name="load_graph_context"|graphify/);
  for (const name of fs.readdirSync(agents)) {
    if (!name.endsWith(".md")) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(agents, name), "utf8"), /graphify/, name);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(agents, "gsd-executor.md"), "utf8"), /<tdd_execution>/);
  assert.doesNotMatch(fs.readFileSync(path.join(agents, "gsd-verifier.md"), "utf8"), /<mvp_mode_verification>/);
  assert.match(fs.readFileSync(path.join(agents, "gsd-debugger.md"), "utf8"), /symptoms_prefilled: true/);
  assert.doesNotMatch(fs.readFileSync(path.join(agents, "gsd-debugger.md"), "utf8"), /tdd_mode: true/);
});
