// Bug-hunt group G109: a checkpoint id or type with a newline corrupts the debug session's Symptoms section, and a
// checkpoint the verb refuses must not be dropped silently by the gsd-debug workflow.
import assert from "node:assert/strict";
import test from "node:test";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const input = { signature: { kind: "test", key: "g109", label: "G109 checkpoint" }, symptoms: { expected: "200", actual: "500", errors: "TypeError: x", reproduction: "npm test", started: "today" }, owns: ["Path:src/"] };

async function session() {
  const p = project();
  const slug = (await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) })).json.slug;
  return { p, slug, file: `.planning/debug/${slug}.md` };
}

test("G109 a checkpoint id or type that is not a single token is refused and leaves the session file untouched", async () => {
  for (const bad of [
    { id: "c1\n## Symptoms\nInjected", type: "decision" },
    { id: "c1", type: "decision\n## Symptoms" },
    { id: "c 1", type: "decision" },
  ]) {
    const { p, slug, file } = await session();
    const before = p.read(file);
    const r = await gsd(p, ["debug", "checkpoint", slug], { stdin: JSON.stringify({ ...bad, question: "Which env?", options: ["a", "b"] }) });
    assert.equal(r.code, 1, JSON.stringify(bad));
    assert.equal(p.read(file), before, JSON.stringify(bad));
    assert.equal((await gsd(p, ["debug", "status", slug])).code, 0, JSON.stringify(bad));
  }
});

test("G109 a single-token checkpoint id and type are still recorded and set pending_checkpoint", async () => {
  const { p, slug } = await session();
  const r = await gsd(p, ["debug", "checkpoint", slug], { stdin: JSON.stringify({ id: "env.stage-2_a:b", type: "human-action", question: "Which env?", options: ["a"] }) });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const st = await gsd(p, ["debug", "status", slug]);
  assert.equal(st.code, 0, JSON.stringify(st.json));
  assert.equal(st.json.frontmatter.pending_checkpoint.id, "env.stage-2_a:b");
});

// Fake debug verbs: a checkpoint write that the verb refuses (exit 1) is what the workflow must not ignore.
function debugWorld() {
  const w = makeWorld({ overlay: { gsd: { debug: { max_turns: 3, minutes: 120 } } } });
  const s = { path: ".planning/debug/login-fails.md", frontmatter: { goal: "find_and_fix", owns: ["Path:src/login/"], budget_used: { turns: 0, minutes: 0 } } };
  w.session = s;
  w.gsd.on("debug status", () => ({ status: "investigating", path: s.path, frontmatter: s.frontmatter }));
  w.gsd.on("debug budget", () => ({ budget_used: s.frontmatter.budget_used }));
  w.gsd.on("debug checkpoint", () => ({ code: 1, json: { status: "error", error: "checkpoint id must be one token" } }));
  return w;
}

test("G109 the gsd-debug workflow reports a checkpoint the verb refuses as failed instead of needs-owner with nothing recorded", async () => {
  const w = debugWorld();
  const r = await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent: () => ({ status: "checkpoint", checkpoint: { id: "c1\n## Symptoms", type: "decision", question: "which?", options: ["a"] } }) });
  assert.equal(r.result.status, "failed", JSON.stringify(r.result));
  assert.match(r.result.reason, /checkpoint id must be one token/);
  assert.equal(w.session.frontmatter.pending_checkpoint, undefined, "nothing pending for the owner");
});
