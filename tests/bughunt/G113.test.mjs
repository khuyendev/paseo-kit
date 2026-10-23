// G113: an exhausted debug budget is extended by `ph gsd debug extend` (turns, minutes and a reason), not by a hand edit.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const INPUT = { signature: { kind: "test", key: "k", label: "Boom" }, symptoms: { expected: "a", actual: "b", errors: "E", reproduction: "r", started: "s" }, owns: ["Path:src/"] };
const REASON = "the failure needs one more pass after the fixture change";

async function session(p) {
  return (await gsd(p, ["debug", "create"], { stdin: JSON.stringify(INPUT) })).json.slug;
}
const budget = (p, slug, turns, minutes) => gsd(p, ["debug", "budget", slug], { stdin: JSON.stringify({ turns, minutes }) });
const extend = (p, slug, input) => gsd(p, ["debug", "extend", slug], { stdin: typeof input === "string" ? input : JSON.stringify(input) });

test("G113 debug extend is a registered verb and records turns, minutes and a reason in budget_extension", async () => {
  const p = project();
  assert.ok((await gsd(p, ["verbs"])).json.ported.includes("debug.extend"));
  const slug = await session(p);
  await budget(p, slug, 1000, 1000);
  const r = await extend(p, slug, { turns: 8, minutes: 60, reason: REASON });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.budget_extension, { turns: 8, minutes: 60, reason: REASON });
  const again = await extend(p, slug, { turns: 4, minutes: 0, reason: "second pass" });
  assert.deepEqual(again.json.budget_extension, { turns: 12, minutes: 60, reason: "second pass" });
  const st = (await gsd(p, ["debug", "status", slug])).json;
  assert.deepEqual(st.frontmatter.budget_extension, { turns: 12, minutes: 60, reason: "second pass" });
  const text = p.read(`.planning/debug/${slug}.md`);
  assert.ok(text.includes(`    ${REASON}\n`), "the reason is kept in ## Checkpoints");
  assert.match(text, /## Checkpoints[\s\S]*extended: turns \+8, minutes \+60/);
});

test("G113 a malformed or reasonless extension is refused and nothing is written", async () => {
  const p = project();
  const slug = await session(p);
  const before = p.read(`.planning/debug/${slug}.md`);
  const bad = [
    "{not json",
    { turns: "8", minutes: 60, reason: REASON },
    { turns: -1, minutes: 60, reason: REASON },
    { turns: 8, minutes: null, reason: REASON },
    { turns: 8, reason: REASON },
    { turns: 8, minutes: 60 },
    { turns: 8, minutes: 60, reason: "   " },
  ];
  for (const input of bad) {
    const r = await extend(p, slug, input);
    assert.equal(r.code, 1, JSON.stringify(input));
  }
  assert.equal(p.read(`.planning/debug/${slug}.md`), before);
  assert.equal((await gsd(p, ["debug", "status", slug])).json.frontmatter.budget_extension, undefined);
});

test("G113 an extension is refused while a run holds the code root", async () => {
  const p = project();
  const slug = await session(p);
  p.write("_workspace/locks/debug.lock", JSON.stringify({ runId: "wf_other", pid: process.pid, kind: "gsd-execute" }));
  const held = await extend(p, slug, { turns: 8, minutes: 60, reason: REASON });
  assert.equal(held.code, 1);
  assert.match(held.json.error, /holds this code root \(wf_other\)/);
  fs.rmSync(path.join(p.root, "_workspace/locks/debug.lock"));
  assert.equal((await extend(p, slug, { turns: 8, minutes: 60, reason: REASON })).code, 0);
});

test("G113 an extension lifts the exhausted budget so the debugger runs again", async () => {
  const w = makeWorld({ overlay: { gsd: { debug: { max_turns: 3, minutes: 120 } } } });
  const frontmatter = { goal: "find_and_fix", owns: [], budget_used: { turns: 3, minutes: 3 } };
  w.gsd.on("debug status", () => ({ status: "investigating", path: ".planning/debug/login-fails.md", frontmatter }));
  w.gsd.on("debug budget", () => ({ budget_used: frontmatter.budget_used }));
  const exhausted = await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent: () => ({ status: "continue" }) });
  assert.deepEqual([exhausted.result.status, exhausted.result.type, exhausted.calls.length], ["needs-owner", "budget-exhausted", 0]);
  frontmatter.budget_extension = { turns: 2, minutes: 0, reason: REASON };
  const lifted = await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent: () => ({ status: "diagnosed", summary: "root cause" }) });
  assert.equal(lifted.result.status, "diagnosed");
  assert.equal(lifted.calls.length, 1);
});
