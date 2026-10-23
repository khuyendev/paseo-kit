// THIN.md item 1 (kit feedback 87): the helpers every gsd-*.js copied are workflow engine globals; a script that still
// defines them keeps working, and a run started by an old script resumes under the new one with every agent call replayed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadJournalCache, readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { KIT_HELPER_NAMES, kitHelpers } from "../../ship/.agents/harness/workflow/script.mjs";
import { SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakeHost } from "../workflow/helpers.mjs";
import { META, OLD_BLOCK, newScript, oldScript, runEngine, stubRoot } from "./engine.mjs";

// Uses every helper of the old block.
const BODY = `
const cfg = await loadCfg();
const h = await sha("abc");
const f = await fileSha("notes/a.md");
const missing = await fileSha("notes/none.md");
const g = await gsd(["hash"], "abc");
const ex = await flow(["exists", "notes/a.md"]);
const open = await discussOpen(".planning/phases/01-core", "01");
const r1 = await call("first " + h + "\\n" + digestLine("stage", f) + "\\n" + policyBlock(null), { label: "one" });
const r2 = await call("second " + policyBlock("x/RESEARCH.md"), { label: "two" });
return {
  mode: cfg.gsd.mode, h, f, missing, g: g.json.hash, code: g.code, exists: ex.json.exists["notes/a.md"], open,
  r1: r1.result, r2: r2.result, model: r1.model, phase: phaseNumber(".planning/phases/07.1-x"), dir: PHASE_DIR_RE.test(".planning/phases/01-core"),
  last: lastJson("x\\n{\\"a\\":1}"), tail: VERB_TAIL_CHARS, ph: PH, flowFile: FLOW, fatal: [fatal("rate limit hit"), fatal("boom"), fatal(null)],
  needs: needsOwner("Gate", "red", { plan: "01-01" }), lease: [leaseText({ holderKind: "execute", holder: "wf_x" }), leaseText(null, "the phase")],
  retry: NEVER_RETRY.test("HTTP 429"),
};
`;

test("TI the engine provides the composition helpers as globals: a script without the copied block runs them", async () => {
  const root = stubRoot({ "notes/a.md": "hello\n" });
  const r = await runEngine(root, newScript(BODY));
  const v = r.result;
  assert.equal(v.mode, "stub");
  assert.match(v.h, /^[0-9a-f]{12}$/);
  assert.equal(v.g, v.h);
  assert.equal(v.code, 0);
  assert.match(v.f, /^[0-9a-f]{12}$/);
  assert.equal(v.missing, null);
  assert.equal(v.exists, true);
  assert.equal(v.open, "no CONTEXT.md; run gsd-discuss first");
  assert.match(v.r1, /^r:first [0-9a-f]{12}\nInput digest \(stage\): [0-9a-f]{12}\n<research_input_policy>\nApproved research: NONE\./);
  assert.match(v.r2, /Approved research: x\/RESEARCH\.md\. Read and use only this report\./);
  assert.equal(v.model, "p/m");
  assert.equal(v.phase, "07.1");
  assert.equal(v.dir, true);
  assert.deepEqual(v.last, { a: 1 });
  assert.equal(v.tail, 4000000);
  assert.equal(v.ph, ".agents/harness/ph.mjs");
  assert.equal(v.flowFile, ".agents/workflows/lib/gsd-flow.mjs");
  assert.deepEqual(v.fatal, [true, false, false]);
  assert.deepEqual(v.needs, { status: "needs-owner", stage: "Gate", reason: "red", plan: "01-01" });
  assert.deepEqual(v.lease, ["a execute run holds this code root (wf_x)", "another run holds the phase (unknown run)"]);
  assert.equal(v.retry, true);
});

test("TI a script that still carries the old block gets the same result, shell calls and prompts as one that uses the globals", async () => {
  const root = stubRoot({ "notes/a.md": "hello\n" });
  const oldHost = fakeHost();
  const newHost = fakeHost();
  const o = await runEngine(root, oldScript(BODY), { host: oldHost });
  const n = await runEngine(root, newScript(BODY), { host: newHost });
  assert.deepEqual(n.result, o.result);
  assert.deepEqual(newHost.calls.runner.map((s) => s.prompt), oldHost.calls.runner.map((s) => s.prompt));
  const shells = (out) => out.filter((l) => l.startsWith("shell start"));
  assert.deepEqual(shells(n.out), shells(o.out));
});

test("TI a run started by an old script resumes under the new script (and the new under the old) with every agent call replayed", async () => {
  const root = stubRoot({ "notes/a.md": "hello\n" });
  const dir = makeTempDir();
  for (const [first, second] of [[oldScript, newScript], [newScript, oldScript]]) {
    const j1 = path.join(dir, `${first.name}-1.jsonl`);
    const a = await runEngine(root, first(BODY), { journalPath: j1 });
    assert.equal(a.stats.ok, 2);
    const host = fakeHost();
    const b = await runEngine(root, second(BODY), { host, cache: loadJournalCache(j1), journalPath: path.join(dir, `${first.name}-2.jsonl`) });
    assert.equal(host.calls.runner.length, 0, "no agent call reran");
    assert.equal(b.stats.cached, 2);
    assert.deepEqual(b.result, a.result);
    const keys = (j) => readJournal(j).filter((e) => e.status === "ok" || e.status === "cached").map((e) => `${e.key}#${e.occ}`);
    assert.deepEqual(keys(path.join(dir, `${first.name}-2.jsonl`)), keys(j1));
  }
});

test("TI a script's own definition wins over the engine global, and a reassigned call wraps the kit's", async () => {
  const root = stubRoot();
  const body = `
const flow = async (argv) => ({ code: 0, json: { mine: argv[0] } });
const mine = await flow(["read", "x"]);
const rawCall = call;
call = async (prompt, opts) => rawCall("wrapped " + prompt, opts);
const r = await call("p", { label: "w" });
return { mine: mine.json.mine, r: r.result, kitPh: PH };
`;
  const r = await runEngine(root, newScript(body));
  assert.deepEqual(r.result, { mine: "read", r: "r:wrapped p", kitPh: ".agents/harness/ph.mjs" });
});

test("TI helper values belong to the script's realm (arrays and objects behave like the script's own)", async () => {
  const root = stubRoot({ "notes/a.md": "x" });
  const body = `
const ex = await flow(["exists", "notes/a.md", "notes/b.md"]);
const needs = needsOwner("S", "r");
return { obj: Object.getPrototypeOf(ex.json) === Object.prototype, needsObj: needs instanceof Object, arr: [] instanceof Array && Array.isArray(Object.keys(ex.json.exists)) };
`;
  assert.deepEqual((await runEngine(root, newScript(body))).result, { obj: true, needsObj: true, arr: true });
});

test("TI KIT_HELPER_NAMES lists every name of the old copied block, plus renderPrompt and the runtime helpers of stage 2", () => {
  const declared = [...OLD_BLOCK.matchAll(/^(?:const|async function|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 19, declared.join(","));
  assert.deepEqual([...KIT_HELPER_NAMES].sort(), [...declared, "renderPrompt", "pool", "slots", "serialize", "turnLock"].sort());
  assert.deepEqual(Object.keys(kitHelpers({ shell: null, agent: null, parallel: null })), [...KIT_HELPER_NAMES]);
  assert.ok(META.startsWith("export const meta"));
});

test("TI the shipped gsd-*.js scripts no longer carry the copied block", () => {
  const wf = path.join(SHIP_DIR, ".agents/workflows");
  for (const f of fs.readdirSync(wf).filter((x) => /^gsd-.*\.js$/.test(x))) {
    const text = fs.readFileSync(path.join(wf, f), "utf8");
    assert.doesNotMatch(text, /shared GSD script helpers|^async function run\(argv, input\)|^const PH = /m, f);
  }
});
