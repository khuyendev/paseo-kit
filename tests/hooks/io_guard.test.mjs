import assert from "node:assert/strict";
import { test } from "node:test";
import { claimDir, MSG, runIoGuard, TOOLS } from "../../ship/.claude/hooks/io_guard.mjs";
import { loadConfig, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { contextOf, editRounds, hookEnv, hookProject, lookupRounds, runHookAsync, runHookSync, T, writeTranscript } from "./helpers.mjs";

const IO = loadKitConfig().io_guard;
const START = IO.start_rounds;
const ESTART = IO.edit_start_rounds;
const HF = "mcp__harness-files__";

// In-process io guard over a synthetic transcript; one claim dir per guard, i.e. per session.
function session({ env = {}, cfg } = {}) {
  const tmpDir = makeTempDir("io tmp ");
  const dir = makeTempDir("io transcript ");
  const loader = async () => (cfg ? { io_guard: cfg } : loadKitConfig());
  return {
    tmpDir,
    async call(entries, tool_name, tool_input = {}, extra = {}) {
      const transcript_path = writeTranscript(dir, entries);
      const res = await runIoGuard({ session_id: "io-s1", transcript_path, tool_name, tool_input, ...extra }, { env, tmpDir, loadConfig: loader });
      return res?.output?.hookSpecificOutput?.additionalContext ?? "";
    },
  };
}

const post = (tool_name, tool_response) => runIoGuard({ session_id: "p", tool_name, tool_input: {}, tool_response }, {
  tmpDir: makeTempDir(),
  loadConfig: async () => {
    throw new Error("PostToolUse must not load config");
  },
}).then((r) => r?.output?.hookSpecificOutput?.additionalContext ?? "");

test("HOOK-13 tool table: other tools are silent, listed tools reach their branch", async () => {
  const s = session();
  assert.equal(await s.call([T.prompt("p")], "Bash", { command: "ls" }), "");
  assert.equal(await s.call([T.prompt("p")], "mcp__fsbatch__read_ranges", {}), "");
  assert.deepEqual(Object.keys(TOOLS).filter((n) => TOOLS[n].kind === "lookup").sort(), ["Glob", "Grep", "Read", `${HF}read_ranges`].sort());
  assert.deepEqual(Object.keys(TOOLS).filter((n) => TOOLS[n].kind === "mutating").sort(),
    ["Edit", "MultiEdit", "NotebookEdit", "Write", `${HF}edit_multiple_files`, `${HF}write_multiple_files`].sort());
  assert.deepEqual(Object.keys(TOOLS).filter((n) => TOOLS[n].result).sort(), ["Glob", "Grep"]);
  for (const name of Object.keys(TOOLS)) {
    const text = await session().call([T.prompt("p")], name, {});
    assert.match(text, TOOLS[name].kind === "lookup" ? /first file lookup/ : /first edit/, name);
  }
  const r = runHookSync(hookProject().root, "io_guard.mjs", { tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("HOOK-14 an in-flight round of parallel calls is not a previous round", async () => {
  const s = session();
  const entries = [T.prompt("p"), ...lookupRounds(START - 1), T.uses("inflight", [["f1", "Grep"], ["f2", "Glob"]])];
  const text = await s.call(entries, "Grep");
  assert.match(text, new RegExp(`lookup round ${START} in a row`));
  assert.doesNotMatch(text, new RegExp(`lookup round ${START + 1} in a row`));
});

test("HOOK-14 sidechain and meta entries are skipped; a Bash round is neutral for lookups", async () => {
  const s = session();
  const side = { ...T.uses("side", [["s1", "Grep"]]), isSidechain: true };
  const meta = { ...T.prompt("meta"), isMeta: true };
  const bash = [T.uses("b", [["b1", "Bash"]]), T.results(["b1"])];
  const entries = [T.prompt("p"), ...lookupRounds(START - 2), side, meta, ...bash, ...lookupRounds(1, "z")];
  assert.match(await s.call(entries, "Grep"), new RegExp(`lookup round ${START} in a row`));
});

test("HOOK-15 first file round speaks once per prompt, not while already batching", async () => {
  const s = session();
  assert.match(await s.call([T.prompt("p1")], "Grep"), /first file lookup/);
  assert.equal(await s.call([T.prompt("p1")], "Grep"), "");
  assert.match(await s.call([T.prompt("p1"), T.prompt("p2")], "Edit", { file_path: "x" }), /first edit/);
  const batching = session();
  assert.equal(await batching.call([T.prompt("p"), T.uses("m", [["a", "Grep"], ["b", "Glob"]])], "Grep"), "");
});

test("HOOK-16 lookup streak: speaks at START, once per band, reset by an edit or a new prompt", async () => {
  const s = session();
  assert.doesNotMatch(await session().call([T.prompt("p"), ...lookupRounds(START - 2)], "Grep"), /in a row/);
  const atStart = [T.prompt("p"), ...lookupRounds(START - 1)];
  assert.match(await s.call(atStart, "Grep"), new RegExp(`lookup round ${START} in a row with nothing edited in between`));
  assert.equal(await s.call(atStart, "Grep"), "");
  const afterEdit = [...atStart, ...editRounds(1), ...lookupRounds(START - 1, "k")];
  assert.match(await s.call(afterEdit, "Grep"), new RegExp(`lookup round ${START} in a row`));
  assert.match(await s.call([T.prompt("q"), ...lookupRounds(START - 1)], "Grep"), new RegExp(`lookup round ${START} in a row`));
});

test("HOOK-17 edit streak: speaks at ESTART; a Bash or lookup round breaks it", async () => {
  const s = session();
  assert.match(await s.call([T.prompt("p"), ...editRounds(ESTART - 1)], "Write", { file_path: "n" }),
    new RegExp(`edit round ${ESTART} in a row with nothing looked up in between`));
  const bash = [T.uses("b", [["b1", "Bash"]]), T.results(["b1"])];
  assert.doesNotMatch(await session().call([T.prompt("p"), ...editRounds(ESTART - 1), ...bash], "Edit", { file_path: "n" }), /in a row/);
  assert.doesNotMatch(await session().call([T.prompt("p"), ...editRounds(ESTART - 1), ...lookupRounds(1)], "Edit", { file_path: "n" }), /in a row/);
});

test("HOOK-18 re-read of a file edited in this prompt", async () => {
  const edit = (file) => [T.prompt("p"), T.uses("e", [["e1", "Edit", { file_path: file }]]), T.results(["e1"])];
  assert.match(await session().call(edit("C:\\Work\\Spec.md"), "Read", { file_path: "c:/work/spec.md" }), /c:\/work\/spec\.md was edited earlier in this task/);
  assert.doesNotMatch(await session().call(edit("C:\\Work\\Spec.md"), "Read", { file_path: "c:/work/spec.md", limit: 1 }), /was edited/);
  assert.match(await session().call(edit("C:\\Work\\Spec.md"), "Read", { file_path: "./sub/../Spec.md" }, { cwd: "C:\\Work" }), /was edited earlier/);
  const wrote = [T.prompt("p"), T.uses("w", [["w1", `${HF}write_multiple_files`, { files: [{ path: "C:/Work/new.md", content: "x" }] }]]), T.results(["w1"], "wrote C:\\Work\\new.md (1 chars)")];
  assert.match(await session().call(wrote, `${HF}read_ranges`, { ranges: [{ path: "C:/Work/new.md" }] }), /was edited earlier/);
  const fixOnly = [T.prompt("p"), T.uses("f", [["f1", `${HF}edit_multiple_files`, { fixes: [{ id: "abc" }] }]]),
    T.results(["f1"], [{ type: "text", text: "edited C:\\Work\\fixed.md: 1 edit, +3 chars" }])];
  assert.match(await session().call(fixOnly, `${HF}read_ranges`, { ranges: [{ path: "c:/work/FIXED.md" }] }), /fixed\.md was edited earlier/);
  const before = [T.uses("e", [["e1", "Edit", { file_path: "C:/Work/old.md" }]]), T.results(["e1"]), T.prompt("later")];
  assert.doesNotMatch(await session().call(before, "Read", { file_path: "C:/Work/old.md" }), /was edited/);
});

test("HOOK-19 empty and truncated Grep/Glob results; Read results ignored", async () => {
  assert.match(await post("Grep", "No matches found"), /empty result/);
  assert.match(await post("Glob", { numFiles: 0, filenames: [] }), /empty result/);
  assert.equal(await post("Grep", { mode: "content", numFiles: 0, filenames: [], content: "a.js:1:x", numLines: 1 }), "");
  const list = `${Array.from({ length: 100 }, (_, i) => `src/f${i}.js`).join("\n")}\n(Showing 100 of 257 results)`;
  assert.match(await post("Glob", list), /truncated result/);
  assert.match(await post("Glob", { truncated: true, filenames: ["a"] }), /truncated result/);
  assert.equal(await post("Read", "No matches found"), "");
  assert.match(await post("Grep", "No matches found"), /empty result/, "no claim: speaks every time");
});

test("HOOK-20 six concurrent processes on one payload speak once; prefix-sharing sessions do not collide", async () => {
  const project = hookProject();
  const transcript_path = writeTranscript(project.root, [T.prompt("p")]);
  const env = hookEnv(project.root);
  const input = { session_id: "session-aaaa-1", transcript_path, tool_name: "Grep", tool_input: {}, hook_event_name: "PreToolUse" };
  const runs = await Promise.all(Array.from({ length: 6 }, () => runHookAsync(project.root, "io_guard.mjs", input, { env })));
  assert.ok(runs.every((r) => r.code === 0));
  assert.equal(runs.filter((r) => r.stdout.trim()).length, 1);
  const other = runHookSync(project.root, "io_guard.mjs", { ...input, session_id: "session-aaaa-2" }, { env });
  assert.match(contextOf(other.stdout), /first file lookup/);
  assert.notEqual(claimDir("session-aaaa-1"), claimDir("session-aaaa-2"));
});

test("HOOK-21 stacked streak and reread texts; no transcript_path is silent", async () => {
  const s = session();
  const segmentStart = [T.prompt("p"), T.uses("e", [["e2", "Edit", { file_path: "C:/W/a.md" }]]), T.results(["e2"]), ...lookupRounds(START - 1)];
  const text = await s.call(segmentStart, "Read", { file_path: "C:/W/a.md" });
  assert.equal(text, `${MSG.lookupStreak(START)}\n${MSG.reread(["c:/w/a.md"])}`);
  const r = runHookSync(hookProject().root, "io_guard.mjs", { session_id: "n", tool_name: "Grep", tool_input: {}, hook_event_name: "PreToolUse" });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("HOOK-22 io_guard overlay merges per field and validates", () => {
  const project = hookProject({ overlay: { io_guard: { start_rounds: 3 } } });
  assert.deepEqual(loadConfig(project.root).io_guard, { start_rounds: 3, step_rounds: 2, edit_start_rounds: 2, edit_step_rounds: 2 });
  for (const [overlay, key] of [[{ step_rounds: 0 }, "io_guard.step_rounds"], [{ start_rounds: -1 }, "io_guard.start_rounds"], [{ foo: 1 }, "io_guard.foo"]]) {
    project.writeJson(".agents/harness.config.json", { io_guard: overlay });
    assert.throws(() => loadConfig(project.root), (e) => e.message.includes(key));
  }
  project.writeJson(".agents/harness.config.json", { io_guard: { start_rounds: 0 } });
  assert.equal(loadConfig(project.root).io_guard.start_rounds, 0);
});

test("HOOK-22 overlay thresholds drive the hook process", () => {
  const project = hookProject({ overlay: { io_guard: { start_rounds: 3 } } });
  const env = hookEnv(project.root);
  const at = (n) => runHookSync(project.root, "io_guard.mjs",
    { session_id: `t${n}`, transcript_path: writeTranscript(project.root, [T.prompt("p"), ...lookupRounds(n)]), tool_name: "Grep", tool_input: {} }, { env });
  assert.doesNotMatch(contextOf(at(1).stdout), /in a row/);
  assert.match(contextOf(at(2).stdout), /lookup round 3 in a row/);
});

const SHIPPED_TOOLS = new Set(["Read", "Edit", "Write", "Grep", "Glob", `${HF}read_ranges`, `${HF}edit_multiple_files`, `${HF}write_multiple_files`]);
const allTexts = () => [MSG.firstLookup, MSG.firstEdit, MSG.lookupStreak(4), MSG.editStreak(4), MSG.reread(["c:/a/b.md"]), MSG.empty, MSG.truncated];
const sentences = (text) => text.split(/[.!?](?:\s+|$)/).filter((s) => s.trim()).length;

test("HOOK-23 texts: prefix, at most three sentences, only shipped tool names", () => {
  const texts = allTexts();
  assert.equal(texts.length, 7);
  for (const text of texts) {
    assert.ok(text.startsWith("File I/O (AGENTS.md): "), text);
    assert.ok(sentences(text) <= 3, `${sentences(text)} sentences: ${text}`);
    for (const token of text.match(/mcp__[\w-]+/g) ?? []) assert.ok(SHIPPED_TOOLS.has(token), token);
    for (const word of text.match(/\b(?:Read|Edit|Write|Grep|Glob|MultiEdit|NotebookEdit|Bash)\b/g) ?? []) assert.ok(SHIPPED_TOOLS.has(word), word);
    assert.doesNotMatch(text, /fsbatch|mcp__filesystem__|read_file|read_text_file|read_multiple_files|read_media_file|write_file|edit_file/);
  }
  for (const text of [MSG.firstLookup, MSG.firstEdit, MSG.lookupStreak(2), MSG.editStreak(2)]) {
    assert.ok(text.includes("when the harness-files tools are available, else native Read/Edit"), text);
  }
});

test("HOOK-25 io guard applies to workers exactly as to the main session", async () => {
  const entries = [T.prompt("p"), ...lookupRounds(START - 1)];
  const main = await session({ env: {} }).call(entries, "Grep");
  const worker = await session({ env: { PASEO_HARNESS_ROLE: "worker", PASEO_HARNESS_LEADER: "lead" } }).call(entries, "Grep");
  assert.equal(worker, main);
  assert.match(worker, /in a row/);
});
