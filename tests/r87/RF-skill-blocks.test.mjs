// Kit feedback 87 (RF): the gsd workflow skills are seeded block parts: the kit owns the block between the kit markers,
// the front matter and the project section are the project's; an older kit's whole-file skill is migrated by update.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadKit } from "../../kit/install/units.mjs";
import { END_LINE, START_LINE } from "../../kit/install/text.mjs";
import { defaultKitFiles, KIT_DIR, makeKit, makeProject, runKit, SHIP_DIR } from "../install/helpers.mjs";

const REL = ".claude/skills/gsd-demo/SKILL.md";
const KEY = `${REL}#paseo-harness-kit`;
const FRONT = "---\nname: gsd-demo\ndescription: demo\n---\n\n# gsd-demo\n\n";
const seeded = (body, project = "## Project composition\n\nargs: a\n") => `${FRONT}${START_LINE}\n${body}\n${END_LINE}\n\n${project}`;
const WHOLE = `${FRONT}## Kit overlay\n\nold whole-file text\n`;
const lf = (text) => text.replace(/\r\n/g, "\n");

function kitWith(text) {
  const kit = makeKit({ files: { ...defaultKitFiles(), [REL]: text } });
  return kit;
}

const WORKFLOW_SKILLS = ["gsd-map-codebase", "gsd-new-project", "gsd-research", "gsd-plan", "gsd-execute", "gsd-verify", "gsd-quick", "gsd-debug"];
const MAIN_SESSION_SKILLS = ["gsd-discuss", "gsd-progress", "gsd-pause", "gsd-undo", "gsd-forensics"];

test("RF the shipped workflow skills are seeded block parts: kit contract inside the markers, project section outside", () => {
  const kit = loadKit(KIT_DIR);
  for (const name of WORKFLOW_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const unit = kit.units.get(`${rel}#paseo-harness-kit`);
    assert.ok(unit?.seed, `${name} is a seeded block part`);
    assert.equal(kit.units.has(rel), false, `${name} is no whole-file part`);
    const text = lf(fs.readFileSync(path.join(SHIP_DIR, rel), "utf8"));
    assert.match(text, /^---\nname: /, `${name} front matter stays first`);
    const [before, rest] = text.split(`${START_LINE}\n`);
    const [block, after] = rest.split(`${END_LINE}\n`);
    assert.doesNotMatch(before, /## /, `${name}: nothing but the title before the block`);
    assert.match(block, /^## Kit contract\n/);
    assert.match(block, /`needs-owner`: show `stage`, `reason` and the numbered `options`/);
    assert.match(block, /The answer is the verb the result names/);
    assert.match(block, /Never edit the flow's state or record files by hand/);
    assert.match(block, /workflow --resume <runId>/);
    assert.match(block, new RegExp(`\\.agents/workflows/${name}\\.js`));
    assert.match(after, /\n## Project composition/, `${name}: project section after the block`);
    assert.match(after, /harness-evolve changes it together with the script/);
  }
  for (const name of MAIN_SESSION_SKILLS) assert.ok(kit.units.get(`.claude/skills/${name}/SKILL.md`)?.kind === "file", `${name} stays a whole kit file`);
});

test("RF install writes the whole seed; update replaces only the block and keeps the project's section and front matter", async () => {
  const kit = kitWith(seeded("## Kit contract\n\nrule one"));
  const p = makeProject();
  const i = await runKit(["install", p.root], { kit });
  assert.equal(i.code, 0, i.stdout);
  assert.equal(lf(p.read(REL)), seeded("## Kit contract\n\nrule one"));
  assert.ok(Object.hasOwn(p.manifest().files, KEY));
  assert.equal(Object.hasOwn(p.manifest().files, REL), false);
  const mine = lf(p.read(REL)).replace("args: a", "args: a, b (evolved)").replace("description: demo", "description: mine");
  p.write(REL, mine);
  kit.write(REL, seeded("## Kit contract\n\nrule two", "## Project composition\n\nkit default changed\n"));
  const s = await runKit(["status", p.root], { kit });
  assert.ok(s.out.some((l) => l.startsWith("kit-newer") && l.includes(KEY)), s.stdout);
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.ok(u.out.includes(`updated ${KEY}`), u.stdout);
  assert.equal(lf(p.read(REL)), mine.replace("rule one", "rule two"));
  const again = await runKit(["status", p.root], { kit });
  assert.equal(again.code, 0, again.stdout);
});

test("RF update migrates an unedited whole-file skill of an older kit into block plus project section", async () => {
  const kit = kitWith(WHOLE);
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  assert.ok(Object.hasOwn(p.manifest().files, REL));
  kit.write(REL, seeded("## Kit contract\n\nrule one"));
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2);
  assert.ok(s.out.some((l) => l.startsWith("migrate") && l.includes(KEY)), s.stdout);
  assert.equal(s.out.some((l) => l.startsWith("removed")), false, s.stdout);
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.ok(u.out.some((l) => l.startsWith(`migrated ${REL}`)), u.stdout);
  assert.equal(u.out.some((l) => l.startsWith("deleted")), false, u.stdout);
  assert.equal(lf(p.read(REL)), seeded("## Kit contract\n\nrule one"));
  const files = p.manifest().files;
  assert.ok(Object.hasOwn(files, KEY));
  assert.equal(Object.hasOwn(files, REL), false);
  assert.equal((await runKit(["status", p.root], { kit })).code, 0);
});

test("RF an edited whole-file skill is kept and reported (status, update, pull) until moved by hand or --force", async () => {
  const kit = kitWith(WHOLE);
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  const edited = `${WHOLE}project rule\n`;
  p.write(REL, edited);
  kit.write(REL, seeded("## Kit contract\n\nrule one"));
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 2, u.stdout);
  assert.ok(u.out.some((l) => l.startsWith(`kept ${KEY} (${REL} has no kit block markers: an edited copy`) && l.includes("update --force replaces it")), u.stdout);
  assert.equal(p.read(REL), edited);
  assert.ok(Object.hasOwn(p.manifest().files, REL), "the whole-file record stays, so the report repeats");
  const s = await runKit(["status", p.root], { kit });
  assert.ok(s.out.some((l) => l.startsWith("no-markers") && l.includes(KEY)), s.stdout);
  const pl = await runKit(["pull", p.root], { kit });
  assert.ok(pl.out.includes(`skipped ${KEY} (${REL} has no kit block markers; run update first)`), pl.stdout);
  assert.equal(lf(kit.read(REL)), seeded("## Kit contract\n\nrule one"));
  // the owner moves the text below the markers: the next update records the block
  p.write(REL, `${seeded("## Kit contract\n\nrule one")}project rule\n`);
  const moved = await runKit(["update", p.root], { kit });
  assert.equal(moved.code, 0, moved.stdout);
  assert.ok(Object.hasOwn(p.manifest().files, KEY));
  assert.equal(Object.hasOwn(p.manifest().files, REL), false);
  // --force on another edited copy replaces it with the seed
  const q = makeProject();
  await runKit(["install", q.root], { kit: kitWith(WHOLE) });
  q.write(REL, edited);
  const f = await runKit(["update", q.root, "--force"], { kit });
  assert.ok(f.out.includes(`updated ${KEY} (--force replaced ${REL}, which had no kit block markers)`), f.stdout);
  assert.equal(lf(q.read(REL)), seeded("## Kit contract\n\nrule one"));
});

test("RF install over an unmarked project file is a conflict; pull copies only the block into the kit's seed", async () => {
  const kit = kitWith(seeded("## Kit contract\n\nrule one"));
  const own = makeProject({ [REL]: "project's own skill\n" });
  const i = await runKit(["install", own.root], { kit });
  assert.equal(i.code, 2, i.stdout);
  assert.ok(i.out.some((l) => l.startsWith(`conflict ${KEY}: ${REL} has no kit block markers`)), i.stdout);
  assert.equal(own.read(REL), "project's own skill\n");
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  p.write(REL, lf(p.read(REL)).replace("rule one", "rule one\nrule learned").replace("args: a", "args: project only"));
  const pl = await runKit(["pull", p.root, REL + "#paseo-harness-kit"], { kit });
  assert.equal(pl.code, 0, pl.stdout);
  assert.equal(lf(kit.read(REL)), seeded("## Kit contract\n\nrule one\nrule learned"));
});

test("RF a shipped .md unit with broken kit markers fails the kit self-check", async () => {
  const kit = kitWith(`${FRONT}${START_LINE}\nbody\n`);
  const r = await runKit(["install", makeProject().root], { kit });
  assert.equal(r.code, 1);
  assert.deepEqual(r.err, [`failed: kit.json lists ${REL} with malformed kit block markers`]);
});
