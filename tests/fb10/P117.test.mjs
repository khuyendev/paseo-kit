// Kit feedback 117 / WildEraV6 7: upstream build drops sections the overlay replaces; what remains is upstream text.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cutRole, generatedBody, kitMark, provenanceProblems, rewritePaths } from "../../ship/.agents/harness/gsd/upstream.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "../gsd-core/fixture.mjs";

const KIT = fileURLToPath(new URL("../../", import.meta.url));
const SHA = "1111111111111111111111111111111111111111";
const BODY = [
  "<role>",
  "You execute the plan.",
  "Your job: commit each task and update STATE.md.",
  "</role>",
  "",
  "<documentation_lookup>",
  "Use ctx7.",
  "</documentation_lookup>",
  "",
  "<deviation_rules>",
  "Rule 1 stays.",
  "See @~/.claude/gsd-core/references/r1.md.",
  "</deviation_rules>",
  "",
  "<task_commit_protocol>",
  "git commit each task.",
  "</task_commit_protocol>",
  "",
].join("\n");

const ENTRY = {
  installed: ".agents/agents/gsd-x.md",
  replaces: ["task_commit_protocol", { section: "documentation_lookup", unless: "doc_tools" }],
  spans: [{ id: "role_job", line: "Your job: commit each task and update STATE.md." }],
};

test("P117 cutRole drops declared sections and one role line; every other line is upstream", () => {
  const cut = cutRole(BODY, ENTRY, false);
  assert.equal(provenanceProblems(BODY, cut.text).length, 0);
  assert.match(cut.text, new RegExp(kitMark("task_commit_protocol").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(cut.text, /kit: role_job replaced/);
  assert.doesNotMatch(cut.text, /git commit each task/);
  assert.doesNotMatch(cut.text, /Use ctx7/);
  assert.doesNotMatch(cut.text, /update STATE\.md/);
  assert.match(cut.text, /You execute the plan\.\n<!-- kit: role_job replaced by the kit overlay -->\n<\/role>/);
  assert.match(cut.text, /<deviation_rules>\nRule 1 stays\.\nSee @~\/\.claude\/gsd-core\/references\/r1\.md\.\n<\/deviation_rules>/);
  const kept = cutRole(BODY, ENTRY, true);
  assert.match(kept.text, /<documentation_lookup>\nUse ctx7\.\n<\/documentation_lookup>/);
  assert.doesNotMatch(kept.text, /git commit each task/);
  assert.throws(() => cutRole(BODY, { installed: "x", replaces: ["no_such_section"] }, false), /no_such_section/);
});

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

test("P117 build drops a repeated include section and check accepts the cut", async () => {
  const clone = makeTempDir("paseo kit p117 clone ");
  const target = makeTempDir("paseo kit p117 target ");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${SHA} refs/heads/next\n`,
    LICENSE: "MIT\n",
    "agents/gsd-x.md": `---\nname: gsd-x\ntools: Read, mcp__x__*\n---\n${BODY}`,
    "gsd-core/references/r1.md": "leaf\n",
  });
  const inventory = {
    v: 1,
    snapshot: ".agents/gsd/upstream",
    entries: [
      {
        installed: ".agents/agents/gsd-x.md",
        kind: "agent",
        source: "agents/gsd-x.md",
        transformations: ["path-rewrite"],
        overlay: ".agents/gsd/overlays/kit-core.md",
        model: "pro",
        description: "X role",
        include: [".agents/gsd/overlays/kit-core.md", ".agents/gsd/generated/rules.md"],
        replaces: ENTRY.replaces,
        spans: ENTRY.spans,
      },
      {
        installed: ".agents/gsd/generated/rules.md",
        kind: "reference",
        source: "agents/gsd-x.md",
        transformations: ["anchor-extraction", "path-rewrite"],
        overlay: null,
        anchors: [{ block: "deviation_rules" }],
      },
      { installed: ".agents/gsd/overlays/kit-core.md", kind: "reference", source: "kit-authored", transformations: [], overlay: null },
    ],
    extra_verbs: {},
  };
  writeTree(target, {
    ".agents/gsd/inventory.json": JSON.stringify(inventory, null, 2),
    ".agents/gsd/overlays/kit-core.md": "<kit_overlay>core</kit_overlay>\n",
  });
  const up = (sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);
  assert.equal((await up("vendor", ["--from", clone, "--commit", SHA])).code, 0);
  const built = await up("build");
  assert.equal(built.code, 0, JSON.stringify(built.json));
  const agent = fs.readFileSync(path.join(target, ".agents/agents/gsd-x.md"), "utf8");
  assert.doesNotMatch(agent, /task_commit_protocol>|Use ctx7|update STATE\.md/);
  assert.match(agent, /include:\n {2}- \.agents\/gsd\/overlays\/kit-core\.md\n---/);
  assert.doesNotMatch(agent, /generated\/rules\.md/);
  const body = generatedBody(agent);
  assert.ok(body.includes(rewritePaths("See @~/.claude/gsd-core/references/r1.md.")));
  const rules = fs.readFileSync(path.join(target, ".agents/gsd/generated/rules.md"), "utf8");
  assert.match(rules, /deviation_rules kept in the role/);
  assert.doesNotMatch(rules, /<deviation_rules>/);
  assert.equal((await up("check")).code, 0, (await up("check")).stdout);
  const sized = await up("size");
  assert.equal(sized.code, 0, sized.stdout);
  assert.ok(sized.out.some((l) => /^gsd-x prompt \d+ chars, dropped \d+ bytes, upstream share \d+%$/.test(l)), sized.stdout);
  assert.ok(sized.json.roles.find((r) => r.role === "gsd-x").droppedBytes > 0);

  writeTree(target, { ".agents/harness.config.json": JSON.stringify({ adapter: { doc_tools: ["ctx7"] } }) });
  assert.equal((await up("build")).code, 0);
  assert.match(fs.readFileSync(path.join(target, ".agents/agents/gsd-x.md"), "utf8"), /<documentation_lookup>\nUse ctx7\./);
  assert.equal((await up("check")).code, 0);
});

test("P117 the shipped executor no longer carries commit, STATE or a repeated rules include", () => {
  const agent = fs.readFileSync(path.join(KIT, "ship/.agents/agents/gsd-executor.md"), "utf8");
  assert.doesNotMatch(agent, /<task_commit_protocol>/);
  assert.doesNotMatch(agent, /<state_updates>/);
  assert.doesNotMatch(agent, /<final_commit>/);
  assert.doesNotMatch(agent, /<documentation_lookup>/);
  assert.doesNotMatch(agent, /update STATE\.md/);
  assert.doesNotMatch(agent, /executor-rules\.md/);
  assert.match(agent, /<deviation_rules>/);
  assert.match(agent, /kit: task_commit_protocol replaced by the kit overlay/);
  const rules = fs.readFileSync(path.join(KIT, "ship/.agents/gsd/generated/executor-rules.md"), "utf8");
  assert.doesNotMatch(rules, /<deviation_rules>/);
  assert.match(rules, /kept in the role/);
  const prompt = fs.readFileSync(path.join(KIT, "ship/.agents/workflows/prompts/executor.md"), "utf8");
  assert.doesNotMatch(prompt, /Deviation rules \(the kit adapter/);
  assert.match(prompt, /Return JSON \{taskResults:/);
});
