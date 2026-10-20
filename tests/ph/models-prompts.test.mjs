import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { phCommand } from "../../ship/.agents/harness/lib/cli.mjs";
import { isReadOnlyTools, loadAgentDef, splitFrontMatter } from "../../ship/.agents/harness/runtime/agents.mjs";
import { parseFanout } from "../../ship/.agents/harness/runtime/fanout.mjs";
import { resolveModel, selectModel } from "../../ship/.agents/harness/runtime/models.mjs";
import { costUsd, priceKey } from "../../ship/.agents/harness/runtime/pricing.mjs";
import { INCLUDES_HEADER, NOTE_READ_ONLY, NOTE_RETURN_VALUE, NOTE_SILENT, composePrompt, firstPromptNote } from "../../ship/.agents/harness/runtime/prompts.mjs";
import { runNode } from "../helpers/run.mjs";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { TIERS } from "./setup.mjs";

const cfgWith = (overlay = {}) => loadConfig(makeTempProject({ git: false, overlay: { tiers: TIERS, ...overlay } }).root);

test("PHCL-21 resolveModel: explicit ids, tiers, aliases, effort and allowed_models on a normalized key", () => {
  const cfg = cfgWith();
  assert.equal(resolveModel(cfg, "circle/x[1m]").id, "circle-agent/x[1m]");
  const std = resolveModel(cfg, "standard");
  assert.deepEqual([std.provider, std.model, std.thinking], ["circle-agent", "std-model[1m]", "low"]);
  assert.equal(resolveModel(cfg, "standard", "max").thinking, "max");
  assert.throws(() => resolveModel(cfg, "standard", "huge"), /unknown effort 'huge'/);
  assert.throws(() => resolveModel(cfg, "nosuch"), /unknown model tier 'nosuch' \(tiers: frontier, pro, standard; or provider\/model\)/);
  const aliased = cfgWith({ tier_aliases: { opus: "pro" } });
  assert.equal(resolveModel(aliased, "opus").id, "circle-agent/pro-model[1m]");
  const allow = cfgWith({ allowed_models: ["circle/gpt-a[1m]"], tiers: { ...TIERS, standard: { provider: "circle/gpt-a" } } });
  assert.equal(resolveModel(allow, "circle-agent/gpt-a[1m]").id, "circle-agent/gpt-a[1m]");
  assert.equal(resolveModel(allow, "standard").id, "circle-agent/gpt-a");
  assert.throws(() => resolveModel(allow, "circle/other"), /model circle\/other is not in config allowed_models/);
  assert.deepEqual(loadKitConfig().tier_aliases, {});
});

test("PHCL-21 an unconfigured tier fails with the named diagnostic (CONF-11)", () => {
  const cfg = loadKitConfig();
  assert.throws(() => resolveModel(cfg, "standard"), /^Error: tier standard has no model; set tiers\.standard\.provider in \.agents\/harness\.config\.json \(the harness adapter generator writes it\)$/);
});

test("PHCL-22 model and effort resolve independently: per-run > role entry > definition > default_tier", () => {
  const cfg = cfgWith({ gsd: { roles: { outline: { model: "pro" }, planner: { model: "standard", effort: "high" }, custom: { effort: "max" } } } });
  const def = { model: "frontier" };
  const pick = (args) => {
    const s = selectModel({ cfg, ...args });
    return `${s.model}@${s.thinking}`;
  };
  assert.equal(pick({ role: "outline", definition: def }), "pro-model[1m]@high");
  assert.equal(pick({ role: "planner", definition: def }), "std-model[1m]@high");
  assert.equal(pick({ role: "checker", definition: def }), "front-model[1m]@high");
  assert.equal(pick({ role: "checker" }), "std-model[1m]@low");
  assert.equal(pick({ role: "planner", explicit: { model: "frontier" } }), "front-model[1m]@high");
  assert.equal(pick({ role: "planner", explicit: { effort: "low" } }), "std-model[1m]@low");
  assert.equal(pick({ role: "custom", definition: def }), "front-model[1m]@max");
  assert.equal(pick({ definition: { model: null } }), "std-model[1m]@low");
  assert.throws(() => selectModel({ cfg, role: "nosuch" }), /unknown role 'nosuch' \(roles: research, .*custom\)/);
});

const AGENT_DEF = `---
name: reviewer
# a comment line
description: "Reviews # not a comment"
tools: [Read, Grep]
model: pro
include:
  - docs/guide.md
---
Review the code.
`;

function defProject() {
  return makeTempProject({
    git: false,
    files: {
      ".agents/agents/reviewer.md": AGENT_DEF,
      ".agents/agents/coder.md": "---\ntools: Read, mcp__harness-files__edit_multiple_files\nmodel: inherit\n---\nWrite code.\n",
      ".agents/agents/escape.md": "---\ninclude: ../../etc/passwd\n---\nx\n",
      "docs/guide.md": "---\ntitle: g\n---\nGuide text.\n",
    },
  });
}

test("PHCL-26 definitions: documented front matter subset, includes without front matter, traversal refused", () => {
  const p = defProject();
  const def = loadAgentDef(p.root, "reviewer");
  assert.equal(def.description, "Reviews # not a comment");
  assert.equal(def.model, "pro");
  assert.equal(def.body, "Review the code.");
  assert.deepEqual(def.includes, [{ rel: "docs/guide.md", text: "Guide text." }]);
  assert.equal(loadAgentDef(p.root, "coder").model, null);
  assert.throws(() => loadAgentDef(p.root, "../x"), /invalid agent type/);
  assert.throws(() => loadAgentDef(p.root, "a/b"), /invalid agent type/);
  assert.throws(() => loadAgentDef(p.root, "nosuch"), /agent type 'nosuch' not found: /);
  assert.throws(() => loadAgentDef(p.root, "escape"), /agent type 'escape' includes a missing file: \.\.\/\.\.\/etc\/passwd/);
  assert.deepEqual(splitFrontMatter("---\na: 'it''s'\nb: x # c\n---\n").meta, { a: "it's", b: "x" });
});

test("PHCL-27 read-only derivation from tools: by token", () => {
  assert.equal(isReadOnlyTools("Read, Grep"), true);
  assert.equal(isReadOnlyTools("Read, mcp__harness-files__edit_multiple_files"), false);
  assert.equal(isReadOnlyTools(["Read", "Write"]), false);
  assert.equal(isReadOnlyTools(undefined), false);
  const p = defProject();
  assert.equal(loadAgentDef(p.root, "reviewer").readOnly, true);
  assert.equal(loadAgentDef(p.root, "coder").readOnly, false);
});

const NOTE5 = (cfg) => firstPromptNote(cfg, "linux");
const tail = (notes) => `\n\n---\nRuntime notes:\n${notes.map((n) => `- ${n}`).join("\n")}`;

test("PHCL-28 prompt assembly golden strings", () => {
  const p = defProject();
  const cfg = loadConfig(p.root);
  const base = { cfg, root: p.root, platform: "linux" };
  assert.equal(composePrompt({ ...base, task: "  Do it.  ", kind: "oneshot" }), `Do it.${tail([NOTE_SILENT, NOTE5(cfg)])}`);
  const def = loadAgentDef(p.root, "reviewer");
  const typed = composePrompt({ ...base, task: "Task.", def, kind: "oneshot", readOnly: def.readOnly });
  assert.equal(typed, `Your role (reviewer), complete below:\n\nReview the code.\n\n---\n\n${INCLUDES_HEADER}\n\n===== docs/guide.md =====\nGuide text.\n\n---\n\nTask.${tail([NOTE_SILENT, NOTE_READ_ONLY, NOTE5(cfg)])}`);
  assert.ok(!typed.includes("tools:") && !typed.includes(".agents/agents/"));
  const team = composePrompt({ ...base, task: "T", kind: "team", name: "rev", leader: "abcdef1234", ws: null });
  assert.match(team, /- You are the teammate "rev" of a Paseo agent team led by agent abcdef12\./);
  assert.match(team, /task list --ws <workspace>/);
  const wt = composePrompt({ ...base, task: "T", kind: "oneshot", worktree: { path: "/r/wt", branch: "harness/x" }, workdir: "/elsewhere" });
  assert.equal(wt, `T${tail([NOTE_SILENT, "You work in the git worktree /r/wt (branch harness/x): edit files only there, run git and shell commands with that directory as their working directory, and use absolute paths.", NOTE5(cfg)])}`);
  const sub = path.join(p.root, "sub");
  const cwd = composePrompt({ ...base, task: "T", kind: "oneshot", workdir: sub });
  assert.ok(cwd.includes(`- Your working directory for this task is ${sub}: run shell commands there and resolve relative paths against it.`));
  assert.ok(!composePrompt({ ...base, task: "T", kind: "oneshot", workdir: p.root }).includes("working directory"));
  const wf = composePrompt({ ...base, task: "T", kind: "workflow", runTag: { runId: "wf_1", n: 3 } });
  assert.equal(wf, `T${tail([NOTE_RETURN_VALUE, NOTE5(cfg), "Run wf_1 #3 (bookkeeping only; ignore)."])}`);
  assert.throws(() => composePrompt({ ...base, cfg: { ...cfg, max_prompt_bytes: 10 }, task: "x".repeat(20), kind: "oneshot" }), /max_prompt_bytes 10/);
});

test("PHCL-29 kit note once, then the project note, then the platform note; an overlay first_prompt_note is ignored", () => {
  const cfg = cfgWith({ project_prompt_note: "P", first_prompt_note: "X" });
  const kit = loadKitConfig().first_prompt_note;
  const text = composePrompt({ cfg, root: "/r", task: "T", kind: "oneshot", platform: "win32" });
  assert.equal(text.split(kit).length, 2);
  assert.ok(text.includes(`- ${kit} P ${cfg.platform_notes.win32}`));
  assert.ok(!/\bX\b/.test(text.replace(kit, "")));
  assert.match(kit, /Never send messages to the main\/leader session/);
  assert.match(kit, /about 300 lines/);
  assert.match(cfg.platform_notes.win32, /Get-Content\/Set-Content/);
  const defaults = fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8");
  assert.ok(!/fsbatch|mcp__filesystem/.test(defaults));
});

test("PHCL-30 teammate note carries a ph path that runs", () => {
  const cfg = cfgWith();
  const text = composePrompt({ cfg, root: "/r", task: "T", kind: "team", name: "a b", leader: "12345678-aaaa", ws: "/w s" });
  assert.ok(text.includes(`\`${phCommand()} task list --ws "/w s"\``));
  assert.ok(text.includes(`message a teammate: \`${phCommand()} send --prompt "..." <teammate>\``));
  const file = /node "([^"]+)"/.exec(text)[1];
  const r = runNode(file, ["help"]);
  assert.equal(r.code, 0, r.stderr);
});

test("PHCL-08 parseFanout: preamble, peeled options, unknown option", () => {
  const blocks = parseFanout("Shared preamble.\n\n=== rev one type=reviewer model=pro\nCheck A.\n=== rev two type=reviewer read-only=true\nCheck B.\n");
  assert.deepEqual(blocks.map((b) => [b.name, b.opts]), [["rev one", { type: "reviewer", model: "pro" }], ["rev two", { type: "reviewer", "read-only": true }]]);
  assert.equal(blocks[0].prompt, "Shared preamble.\n\nCheck A.");
  assert.equal(blocks[1].prompt, "Shared preamble.\n\nCheck B.");
  assert.equal(parseFanout("=== solo=x\nbody").at(0).name, "solo=x");
  assert.throws(() => parseFanout("=== a bogus=1\nx"), /block 'a': unknown option bogus=/);
  assert.throws(() => parseFanout("no blocks", "f.txt"), /f\.txt has no '=== <name>' blocks/);
});

test("PHCL-14 list-price cost from the project table", () => {
  const prices = { "m-a": { input: 2, output: 10 }, "m-l": { input: 1, cachedInput: 0.1, output: 4, longContext: { thresholdTokens: 1000, input: 2, output: 8 } } };
  assert.equal(costUsd(prices, "m-a", { input: 1e6, output: 1e6, maxContext: 10 }), 12);
  assert.equal(priceKey("circle-agent/m-a[1m]"), "m-a");
  assert.equal(costUsd(prices, "circle-agent/m-a[1m]", { input: 1e6, output: 1e6 }), 12);
  assert.equal(costUsd(prices, "m-l", { input: 1e6, cachedInput: 1e6, output: 1e6, maxContext: 5000 }), 2 + 0.2 + 8);
  assert.equal(costUsd(prices, "unknown", { input: 1 }), null);
  assert.equal(costUsd({ x: { input: 1 } }, "x", { input: 1 }), null);
  assert.equal(costUsd({}, "m-a", { input: 1 }), null);
  const shipped = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : shipped.push(e.name)));
  walk(SHIP_DIR);
  assert.ok(!shipped.includes("model-prices.json"));
});

test("PHCL-26 flow-list include: quoted items keep spaces, ' # ', commas and apostrophes; a trailing comment is dropped", () => {
  const p = makeTempProject({
    git: false,
    files: {
      ".agents/agents/lists.md": "---\ninclude: [\"docs/a # b.md\", \"docs/c,d.md\", 'docs/it''s.md', docs/plain.md] # real comment\ntools: [Read, \"Grep\"]\n---\nBody.\n",
      "docs/a # b.md": "A\n",
      "docs/c,d.md": "CD\n",
      "docs/it's.md": "IT\n",
      "docs/plain.md": "P\n",
    },
  });
  const def = loadAgentDef(p.root, "lists");
  assert.deepEqual(def.includes, [
    { rel: "docs/a # b.md", text: "A" },
    { rel: "docs/c,d.md", text: "CD" },
    { rel: "docs/it's.md", text: "IT" },
    { rel: "docs/plain.md", text: "P" },
  ]);
  assert.equal(def.tools, "Read, Grep");
  assert.deepEqual(splitFrontMatter("---\nx: [a, \"b\\\"c\", d] # z\ny: [] \n---\n").meta, { x: ["a", 'b"c', "d"], y: [] });
});
