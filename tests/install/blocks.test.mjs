import assert from "node:assert/strict";
import test from "node:test";
import { END_LINE, START_LINE } from "../../kit/install/text.mjs";
import { HELP } from "../../kit/install/state.mjs";
import { BLOCK_KEY, makeKit, makeProject, runKit } from "./helpers.mjs";

const WARNING = "warning AGENTS.md#paseo-harness-kit: text inside the kit block; project text belongs outside the markers";
const block = (body, eol = "\n") => [START_LINE, body, END_LINE].join(eol) + eol;

test("INST-12 CRLF AGENTS.md: update changes only the block body and keeps CRLF", async () => {
  const kit = makeKit();
  const p = makeProject({ "AGENTS.md": `# Project\r\n\r\n${block("## Kit rules\r\n\r\n- rule one", "\r\n")}\r\nafter text\r\n` });
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  kit.write("blocks/AGENTS.md", "## Kit rules\n\n- rule two\n");
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes(`updated ${BLOCK_KEY}`));
  assert.equal(p.read("AGENTS.md"), `# Project\r\n\r\n${block("## Kit rules\r\n\r\n- rule two", "\r\n")}\r\nafter text\r\n`);
});

test("INST-12 missing AGENTS.md is created; one without markers gets block, blank line, old text", async () => {
  const kit = makeKit();
  const fresh = makeProject();
  await runKit(["install", fresh.root], { kit });
  assert.equal(fresh.read("AGENTS.md"), block("## Kit rules\n\n- rule one"));
  const old = makeProject({ "AGENTS.md": "old text\n" });
  await runKit(["install", old.root], { kit });
  assert.equal(old.read("AGENTS.md"), `${block("## Kit rules\n\n- rule one")}\nold text\n`);
});

test("INST-12 malformed markers are a conflict and the file is not written", async () => {
  const kit = makeKit();
  for (const text of [`${END_LINE}\n${START_LINE}\n`, `${START_LINE}\n${START_LINE}\nx\n${END_LINE}\n`]) {
    const p = makeProject({ "AGENTS.md": text });
    const r = await runKit(["install", p.root], { kit });
    assert.equal(r.code, 2);
    assert.ok(r.out.includes("conflict AGENTS.md#paseo-harness-kit: malformed kit block markers; fix by hand"));
    assert.equal(p.read("AGENTS.md"), text);
    const u = await runKit(["update", p.root], { kit });
    assert.equal(u.code, 2);
    assert.equal(p.read("AGENTS.md"), text);
  }
});

test("INST-13 project text inside the kit block is flagged for local, both and unrecorded blocks", async () => {
  const kit = makeKit();
  const local = makeProject();
  await runKit(["install", local.root], { kit });
  local.write("AGENTS.md", local.read("AGENTS.md").replace("- rule one", "- rule one\n- my rule"));
  const both = makeProject();
  await runKit(["install", both.root], { kit: makeKit() });
  both.write("AGENTS.md", both.read("AGENTS.md").replace("- rule one", "- rule mine"));
  const unrecorded = makeProject({ "AGENTS.md": block("project text") });
  await runKit(["install", unrecorded.root], { kit });
  const kit2 = makeKit({ blocks: { "AGENTS.md": "## Kit rules\n\n- rule changed\n" } });
  const cases = [[local, kit, "local"], [both, kit2, "both"], [unrecorded, kit, "both"]];
  for (const [p, k, state] of cases) {
    const s = await runKit(["status", p.root], { kit: k });
    assert.ok(s.out.includes(`${state.padEnd(13)} ${BLOCK_KEY}  (${HELP[state]})`), s.stdout);
    assert.ok(s.out.includes(WARNING));
    const before = p.read("AGENTS.md");
    assert.equal((await runKit(["update", p.root], { kit: k })).code, 2);
    assert.equal(p.read("AGENTS.md"), before);
  }
  const pulledKit = makeKit();
  const pl = await runKit(["pull", local.root, BLOCK_KEY, "--kit", pulledKit.dir], { kit });
  assert.ok(pl.out.includes(`pulled ${BLOCK_KEY}`) && pl.out.includes(WARNING), pl.stdout);
  assert.equal(pulledKit.read("blocks/AGENTS.md"), "## Kit rules\n\n- rule one\n- my rule\n");
  const pb = await runKit(["pull", both.root, BLOCK_KEY, "--kit", kit2.dir], { kit });
  assert.equal(pb.code, 2);
  assert.ok(pb.out.includes(`skipped ${BLOCK_KEY} (both: ${HELP.both})`) && pb.out.includes(WARNING));
  const pu = await runKit(["pull", unrecorded.root, BLOCK_KEY], { kit });
  assert.equal(pu.code, 2);
  assert.ok(pu.out.includes(WARNING));
});
