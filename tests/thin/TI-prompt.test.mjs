// THIN.md item 2 (kit feedback 87): prompt templates. Kit templates `.agents/workflows/prompts/<name>.md` (kit parts,
// shipped prompt text), project templates `prompts/project/<name>.md`, the flow verb `prompt` and the global
// renderPrompt fail on a missing variable; the gsd-debug turn prompt moved to `debug-turn.md` with the same text.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { fillTemplate, renderPrompt, templateText } from "../../ship/.agents/workflows/lib/flow-prompt.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { isPromptFile } from "../../kit/release-check.mjs";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { FakeGsd, runScript } from "../gsd-flows/host.mjs";
import { newScript, runEngine, stubRoot } from "./engine.mjs";

const KIT_JSON = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, "..", "kit.json"), "utf8"));

async function flowVerb(root, argv, input = "") {
  const lines = [];
  const code = await main(argv, { root, input, out: (l) => lines.push(l) });
  return { code, json: JSON.parse(lines.at(-1)) };
}

test("TI fillTemplate fills {{name}} in one pass and names every missing variable", () => {
  assert.deepEqual(fillTemplate("a {{x}} b {{y}} {{x}}", { x: "1", y: 2, z: true }), { text: "a 1 b 2 1", used: ["x", "y"], unused: ["z"] });
  assert.equal(fillTemplate("{{x}}", { x: "{{y}}", y: "no" }).text, "{{y}}");
  assert.equal(fillTemplate("{single} {{ spaced }} {{x}}", { x: false }).text, "{single} {{ spaced }} false");
  assert.equal(fillTemplate("v={{x}}", { x: "" }).text, "v=");
  assert.throws(() => fillTemplate("{{a}} {{b}} {{c}}", { b: "1", c: null }), /no value for \{\{a\}\}, \{\{c\}\}/);
  assert.throws(() => fillTemplate("{{a}}", { a: ["x"] }), /\{\{a\}\} must be a string, number or boolean/);
  assert.throws(() => fillTemplate("{{a}}", ["x"]), /JSON object/);
});

test("TI templateText reads CRLF as LF and drops a leading comment and one final line break", () => {
  assert.equal(templateText("<!--\nnotes\n-->\r\nline 1\r\nline 2\r\n"), "line 1\nline 2");
  assert.equal(templateText("x\n\n"), "x\n");
  assert.equal(templateText("x <!-- kept -->"), "x <!-- kept -->");
  assert.throws(() => templateText("<!-- open"), /unterminated/);
});

test("TI flow verb prompt renders a kit template, a project template only under project/, and fails on a missing variable", async () => {
  const p = makeTempProject({ git: false, files: {
    ".agents/workflows/prompts/project/mine.md": "<!-- project -->\nHello {{who}}.\n",
    // A project file with a kit template's name is never read: a kit name reads the kit file.
    ".agents/workflows/prompts/debug-turn.md": "SHADOW {{x}}\n",
  } });
  const mine = await flowVerb(p.root, ["prompt", "project/mine"], JSON.stringify({ who: "owner" }));
  assert.equal(mine.code, 0);
  assert.deepEqual(mine.json, { name: "project/mine", path: ".agents/workflows/prompts/project/mine.md", text: "Hello owner.", unused: [] });
  const kit = await flowVerb(p.root, ["prompt", "debug-turn"], JSON.stringify({ sessionPath: "s.md", goal: "g", owns: "[]", turns: 1, minutes: 2, next: "Go." }));
  assert.equal(kit.code, 0);
  assert.match(kit.json.text, /^Debug session file: s\.md\./);
  assert.doesNotMatch(kit.json.text, /SHADOW/);
  const miss = await flowVerb(p.root, ["prompt", "project/mine"], "{}");
  assert.equal(miss.code, 1);
  assert.equal(miss.json.status, "error");
  assert.match(miss.json.error, /prompt project\/mine: no value for \{\{who\}\}/);
  for (const bad of ["../x", "project/../../x", "Up", "a/b", ""]) {
    const r = await flowVerb(p.root, ["prompt", bad], "{}");
    assert.equal(r.code, 1, bad);
    assert.match(r.json.error, /must be <name> or project\/<name>/, bad);
  }
  const none = await flowVerb(p.root, ["prompt", "project/none"], "{}");
  assert.match(none.json.error, /prompt template \.agents\/workflows\/prompts\/project\/none\.md not found/);
  assert.throws(() => renderPrompt(p.root, "nope", {}), /prompts\/nope\.md not found/);
});

test("TI renderPrompt is an engine global backed by the verb; a missing variable fails the run with the verb's error", async () => {
  const root = stubRoot({ ".agents/workflows/prompts/project/hi.md": "Hi {{name}}, {{n}} left.\n" });
  const ok = await runEngine(root, newScript('return await renderPrompt("project/hi", { name: "x", n: 3 });'));
  assert.equal(ok.result, "Hi x, 3 left.");
  assert.ok(ok.out.some((l) => /^shell start #1 node \.agents\/workflows\/lib\/gsd-flow\.mjs prompt project\/hi/.test(l)), ok.out.join("\n"));
  await assert.rejects(runEngine(root, newScript('return await renderPrompt("project/hi", { name: "x" });')), /prompt project\/hi: no value for \{\{n\}\}/);
});

test("TI kit prompt templates are kit parts and shipped prompt text; project templates are never shipped", () => {
  const dir = path.join(SHIP_DIR, ".agents/workflows/prompts");
  const kitTemplates = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => `.agents/workflows/prompts/${f}`);
  assert.ok(kitTemplates.includes(".agents/workflows/prompts/debug-turn.md"));
  for (const rel of kitTemplates) {
    assert.ok(KIT_JSON.units.includes(rel), `${rel} listed in kit.json`);
    assert.ok(isPromptFile(`ship/${rel}`), `${rel} is shipped prompt text for the release check`);
  }
  assert.ok(!fs.existsSync(path.join(dir, "project")), "the kit ships no project template");
  assert.ok(!KIT_JSON.units.some((u) => u.startsWith(".agents/workflows/prompts/project/")));
});

// The prompt gsd-debug built inline before the move (04e008f), for the parity check of the moved template.
function oldDebugPrompt({ path: p, goal, owns, charged, minutes, next }) {
  return [
    `Debug session file: ${p}. Follow the session-manager contract of your role: update the session file before acting.`,
    "<runtime_adapter>",
    `Goal: ${goal ?? "find_and_fix"}`,
    "Code root: the current working directory.",
    `Edit scope (owns): ${JSON.stringify(owns ?? [])}; never a shared file; remove instrumentation before closing.`,
    `Session file: ${p}, the one file you may write outside owns (Current Focus, Evidence, Eliminated, Resolution and frontmatter; never Symptoms or Checkpoints; product edits stay inside owns).`,
    `Budget left: ${charged} turns, ${Math.floor(minutes)} minutes.`,
    "Never ask the owner: return a checkpoint {id, type, question, options} instead. Never commit, stage or stash.",
    "A completed fix returns status checkpoint type human-verify with the verify obligation {kind, command, target} that reproduces the failure.",
    "</runtime_adapter>",
    next,
    "Return JSON {status: continue|checkpoint|resolved|diagnosed, checkpoint?, verify?, summary}.",
  ].join("\n");
}

test("TI gsd-debug renders its turn prompt from debug-turn.md: the same text as before, one prompt shell call per turn", async () => {
  const p = makeTempProject({ git: true });
  const fm = { goal: "find_and_fix", owns: ["src/a.js"], budget_used: { turns: 0, minutes: 0 } };
  const gsd = new FakeGsd({
    "debug status": () => ({ path: ".planning/debug/bug-1.md", frontmatter: fm }),
    "debug budget": () => ({ ok: true }),
    "debug close": () => ({ ok: true }),
  });
  const replies = [{ status: "continue", summary: "looking" }, { status: "diagnosed", summary: "found it" }];
  const r = await runScript("gsd-debug", { root: p.root, args: { slug: "bug-1" }, gsd, agent: () => replies.shift() });
  assert.equal(r.result.status, "diagnosed", JSON.stringify(r.result));
  assert.equal(r.calls.length, 2);
  const cfgDebug = loadConfig(p.root).gsd.debug;
  const base = { path: ".planning/debug/bug-1.md", goal: fm.goal, owns: fm.owns, charged: cfgDebug.max_turns, minutes: cfgDebug.minutes };
  assert.equal(r.calls[0].prompt, oldDebugPrompt({ ...base, next: "Start the investigation." }));
  assert.equal(r.calls[1].prompt, oldDebugPrompt({ ...base, next: "Continue from the session file." }));
  const renders = r.shells.filter((s) => s.argv[1] === ".agents/workflows/lib/gsd-flow.mjs" && s.argv[2] === "prompt");
  assert.deepEqual(renders.map((s) => s.argv[3]), ["debug-turn", "debug-turn"]);
});
