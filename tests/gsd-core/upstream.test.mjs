import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generatedBody, rewritePaths, splitFrontMatter } from "../../ship/.agents/harness/gsd/upstream.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "./fixture.mjs";

const KIT = fileURLToPath(new URL("../../", import.meta.url));
const SHA1 = "1111111111111111111111111111111111111111";
const SHA2 = "2222222222222222222222222222222222222222";
const AGENT_BODY = "\n# Agent X\nRead @~/.claude/gsd-core/references/r1.md and gsd-core/templates/t.md.\nKeep foo/gsd-core/references/x as is.\nRun `gsd_run query roadmap.get-phase 1`.\n";

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

// An untrusted clone: HEAD through packed-refs, plus a hook and an fsmonitor that would write a marker if run.
function makeClone({ sha = SHA1, files = {} } = {}) {
  const clone = makeTempDir("paseo kit clone ");
  const marker = path.join(clone, "MARKER");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${sha} refs/heads/next\n`,
    ".git/config": `[core]\n\tfsmonitor = node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}', 'x')"\n`,
    ".git/hooks/post-checkout": `#!/bin/sh\necho x > "${marker}"\n`,
    LICENSE: "MIT License\n\nCopyright (c) upstream\n",
    "agents/gsd-x.md": `---\nname: gsd-x\ntools: Read, Write, mcp__x__*\n---${AGENT_BODY}`,
    "gsd-core/references/r1.md": "See gsd-core/references/r2.md\n",
    "gsd-core/references/r2.md": "leaf\n",
    "gsd-core/templates/t.md": "template\r\nwith crlf\r\n",
    "gsd-core/workflows/w.md": "# W\n<deep_work_rules>\nrule one\n</deep_work_rules>\nuse gsd-core/references/r1.md\n",
    ...files,
  });
  return { clone, marker };
}

function makeTarget(extraInventory = {}) {
  const target = makeTempDir("paseo kit target ");
  const inventory = {
    v: 1,
    snapshot: ".agents/gsd/upstream",
    entries: [
      { installed: ".agents/agents/gsd-x.md", kind: "agent", source: "agents/gsd-x.md", transformations: ["path-rewrite"], overlay: ".agents/gsd/overlays/kit-core.md", model: "pro", description: "X role", include: [".agents/gsd/overlays/kit-core.md"] },
      { installed: ".agents/gsd/generated/workflows/w.md", kind: "skill-workflow", source: "gsd-core/workflows/w.md", transformations: ["path-rewrite"], overlay: null },
      { installed: ".agents/gsd/generated/contracts.md", kind: "reference", source: "gsd-core/workflows/w.md", transformations: ["anchor-extraction", "path-rewrite"], overlay: null, anchors: [{ block: "deep_work_rules" }] },
      { installed: ".agents/gsd/upstream/LICENSE", kind: "reference", source: "LICENSE", transformations: [], overlay: null },
      { installed: ".agents/gsd/overlays/kit-core.md", kind: "reference", source: "kit-authored", transformations: [], overlay: null },
    ],
    extra_verbs: {},
    ...extraInventory,
  };
  writeTree(target, { ".agents/gsd/inventory.json": JSON.stringify(inventory, null, 2), ".agents/gsd/overlays/kit-core.md": "<kit_overlay>single writer</kit_overlay>\n" });
  return target;
}

const up = (target, sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);
const snapshotFile = (target, rel) => path.join(target, ".agents/gsd/upstream", rel);
const GENERATED = [".agents/agents/gsd-x.md", ".agents/gsd/generated/workflows/w.md", ".agents/gsd/generated/contracts.md"];
const generatedSnapshot = (target) => GENERATED.map((f) => (fs.existsSync(path.join(target, f)) ? fs.readFileSync(path.join(target, f), "utf8") : null)).join("\0");

async function vendored(cloneOpts, invExtra) {
  const { clone, marker } = makeClone(cloneOpts);
  const target = makeTarget(invExtra);
  const v = await up(target, "vendor", ["--from", clone, "--commit", cloneOpts?.sha ?? SHA1]);
  assert.equal(v.code, 0, JSON.stringify(v.json));
  return { clone, marker, target };
}

test("GSDC-44 vendor: pin check names both hashes, symlinks refused, nothing runs in the clone, LF hashes recorded", async () => {
  const { clone, marker, target } = await vendored();
  assert.ok(!fs.existsSync(marker), "a hook or fsmonitor ran");
  const pin = JSON.parse(fs.readFileSync(snapshotFile(target, "UPSTREAM.json"), "utf8"));
  assert.deepEqual(Object.keys(pin.files).sort(), ["LICENSE", "agents/gsd-x.md", "gsd-core/references/r1.md", "gsd-core/references/r2.md", "gsd-core/templates/t.md", "gsd-core/workflows/w.md"]);
  for (const [rel, hash] of Object.entries(pin.files)) assert.equal(hash, textDigest(fs.readFileSync(snapshotFile(target, rel), "utf8")), rel);
  assert.deepEqual([pin.commit, pin.vendored_commit, pin.branch, pin.license], [SHA1, SHA1, "next", "MIT"]);
  const wrong = await up(target, "vendor", ["--from", clone, "--commit", SHA2]);
  assert.equal(wrong.code, 1);
  assert.ok(wrong.json.error.includes(SHA1) && wrong.json.error.includes(SHA2));
  const linked = makeClone();
  try {
    fs.symlinkSync(path.join(linked.clone, "gsd-core/references/r2.md"), path.join(linked.clone, "gsd-core/references/r1.md.lnk"));
    fs.rmSync(path.join(linked.clone, "gsd-core/references/r1.md"));
    fs.renameSync(path.join(linked.clone, "gsd-core/references/r1.md.lnk"), path.join(linked.clone, "gsd-core/references/r1.md"));
    const r = await up(makeTarget(), "vendor", ["--from", linked.clone, "--commit", SHA1]);
    assert.equal(r.code, 1);
    assert.match(r.json.error, /symlink/);
  } catch (e) {
    if (e.code !== "EPERM") throw e;
  }
  fs.rmSync(path.join(clone, "gsd-core/workflows/w.md"));
  assert.match((await up(target, "vendor", ["--from", clone])).json.error, /lacks gsd-core\/workflows\/w\.md/);
});

test("GSDC-45 build: idempotent, strict snapshot validation, body = rewrite(upstream body)", async () => {
  const { target } = await vendored();
  const first = await up(target, "build");
  assert.equal(first.code, 0, JSON.stringify(first.json));
  const bytes = generatedSnapshot(target);
  assert.deepEqual((await up(target, "build")).json.written, []);
  assert.equal(generatedSnapshot(target), bytes);
  const agent = fs.readFileSync(path.join(target, ".agents/agents/gsd-x.md"), "utf8");
  assert.equal(generatedBody(agent), rewritePaths(splitFrontMatter(`---\nname: gsd-x\n---${AGENT_BODY}`).body));
  assert.match(agent, /^---\nname: gsd-x\ndescription: "X role"\nmodel: pro\ntools: \[Read, Write\]\ninclude:\n {2}- \.agents\/gsd\/overlays\/kit-core\.md\n---\n<!-- GENERATED /);
  assert.match(agent, /@\.agents\/gsd\/upstream\/gsd-core\/references\/r1\.md and \.agents\/gsd\/upstream\/gsd-core\/templates\/t\.md/);
  assert.match(agent, /Keep foo\/gsd-core\/references\/x as is/);
  const breakers = [
    ["changed byte", (d) => fs.appendFileSync(snapshotFile(d, "gsd-core/references/r2.md"), "x"), /snapshot file edited: gsd-core\/references\/r2\.md/],
    ["missing file", (d) => fs.rmSync(snapshotFile(d, "gsd-core/references/r2.md")), /snapshot file missing/],
    ["extra file", (d) => fs.writeFileSync(snapshotFile(d, "gsd-core/references/extra.md"), "x"), /file not in UPSTREAM\.json: gsd-core\/references\/extra\.md/],
    ["pin mismatch", (d) => fs.writeFileSync(snapshotFile(d, "UPSTREAM.json"), fs.readFileSync(snapshotFile(d, "UPSTREAM.json"), "utf8").replace(`"commit": "${SHA1}"`, `"commit": "${SHA2}"`)), /pin mismatch/],
  ];
  for (const [name, breakIt, message] of breakers) {
    const { target: d } = await vendored();
    await up(d, "build");
    fs.appendFileSync(path.join(d, ".agents/gsd/generated/workflows/w.md"), "stale\n");
    const before = generatedSnapshot(d);
    breakIt(d);
    const r = await up(d, "build");
    assert.equal(r.code, 1, name);
    assert.match(r.json.error, message, name);
    assert.equal(generatedSnapshot(d), before, `${name}: no generated file written`);
  }
});

test("GSDC-46 contract blocks are extracted verbatim; a missing anchor fails the build", async () => {
  const { target } = await vendored();
  await up(target, "build");
  assert.match(fs.readFileSync(path.join(target, ".agents/gsd/generated/contracts.md"), "utf8"), /<deep_work_rules>\nrule one\n<\/deep_work_rules>/);
  const { target: bare } = await vendored({ files: { "gsd-core/workflows/w.md": "# W without the block\n" } });
  const r = await up(bare, "build");
  assert.equal(r.code, 1);
  assert.match(r.json.error, /missing anchor <deep_work_rules>/);
  assert.ok(!fs.existsSync(path.join(bare, ".agents/agents/gsd-x.md")), "nothing written");
});

test("GSDC-47 check: snapshot edit, hand edit, unmapped verb fail; CRLF checkout passes; the kit's own snapshot passes", async () => {
  const { target } = await vendored();
  await up(target, "build");
  const ok = await up(target, "check");
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.match(ok.out.at(-2), /^check: 0 problems, \d+ warnings; \d+ references followed, \d+ verbs mapped$/);
  for (const rel of [...GENERATED, ".agents/gsd/upstream/gsd-core/references/r1.md", ".agents/gsd/upstream/gsd-core/templates/t.md"]) {
    const f = path.join(target, rel);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n"));
  }
  assert.equal((await up(target, "check")).code, 0, "CRLF checkout");
  fs.appendFileSync(path.join(target, ".agents/agents/gsd-x.md"), "hand edit\n");
  const hand = await up(target, "check");
  assert.equal(hand.code, 1);
  assert.ok(hand.json.problems.includes("generated file stale or hand-edited: .agents/agents/gsd-x.md"));
  fs.appendFileSync(snapshotFile(target, "gsd-core/references/r2.md"), "x");
  assert.ok((await up(target, "check")).json.problems.includes("snapshot file edited: gsd-core/references/r2.md"));
  const { target: verbs } = await vendored({ files: { "gsd-core/references/r1.md": "See gsd-core/references/r2.md\nThen `gsd_run foo.bar`.\n" } });
  await up(verbs, "build");
  const unmapped = await up(verbs, "check");
  assert.equal(unmapped.code, 1);
  assert.ok(unmapped.json.problems.some((p) => p.includes('unmapped gsd-tools verb "foo.bar"')));
  const { target: dangling } = await vendored();
  await up(dangling, "build");
  fs.rmSync(snapshotFile(dangling, "gsd-core/templates/t.md"));
  const pin = JSON.parse(fs.readFileSync(snapshotFile(dangling, "UPSTREAM.json"), "utf8"));
  delete pin.files["gsd-core/templates/t.md"];
  fs.writeFileSync(snapshotFile(dangling, "UPSTREAM.json"), JSON.stringify(pin));
  assert.ok((await up(dangling, "check")).json.problems.includes("dangling reference (depth 1): gsd-core/templates/t.md"));
  const kit = await gsd(KIT, ["upstream", "check"]);
  assert.equal(kit.code, 0, kit.out.join("\n"));
});

test("GSDC-48 bump: an unmapped verb keeps it failing until a verb row exists", async () => {
  const { target: t2 } = await vendored();
  await up(t2, "build");
  const v3 = makeClone({ sha: SHA2, files: { "gsd-core/references/r1.md": "See gsd-core/references/r2.md\n`gsd_run newverb.sub`\n" } });
  const failing = await up(t2, "bump", ["--from", v3.clone, "--commit", SHA2]);
  assert.equal(failing.code, 1);
  assert.ok(failing.json.problems.some((p) => p.includes('unmapped gsd-tools verb "newverb.sub"')));
  assert.equal(JSON.parse(fs.readFileSync(snapshotFile(t2, "UPSTREAM.json"), "utf8")).commit, SHA2, "pin left changed for review");
  assert.ok(failing.out.some((l) => /^snapshot: \+\d+ ~\d+ -\d+; generated: /.test(l)));
  const invFile = path.join(t2, ".agents/gsd/inventory.json");
  const inv = JSON.parse(fs.readFileSync(invFile, "utf8"));
  inv.extra_verbs = { "newverb.sub": "not in the kit" };
  fs.writeFileSync(invFile, JSON.stringify(inv));
  const passing = await up(t2, "bump", ["--from", v3.clone, "--commit", SHA2]);
  assert.equal(passing.code, 0, JSON.stringify(passing.json));
});

test("GSDC-49 the licence equals the vendored LICENSE; every departure row cites a requirement of the method file", () => {
  assert.equal(fs.readFileSync(path.join(KIT, "LICENSES/gsd-core-MIT.txt"), "utf8"), fs.readFileSync(path.join(KIT, "ship/.agents/gsd/upstream/LICENSE"), "utf8"));
  // Rows are split on LF; a Windows checkout with core.autocrlf stores CRLF.
  const lf = (p) => fs.readFileSync(path.join(KIT, p), "utf8").replace(/\r\n/g, "\n");
  const method = lf(".planning/requirements/method.md");
  const notice = lf("ship/.agents/gsd/NOTICE.md");
  const pin = JSON.parse(fs.readFileSync(path.join(KIT, "ship/.agents/gsd/upstream/UPSTREAM.json"), "utf8"));
  assert.match(notice, /open-gsd\/gsd-core/);
  assert.equal(pin.commit, "274f8cae13d03ad80e18959b135b0e51b33329e8");
  const rows = notice.split("\n").filter((l) => /^\| (?!departure|---)/.test(l));
  assert.ok(rows.length >= 8);
  for (const row of rows) {
    const id = /\| ([A-Z]+-\d+) \|$/.exec(row)?.[1];
    assert.ok(id && method.includes(`### ${id} `), `row cites an existing requirement: ${row}`);
  }
});

// Project and engine names that must never appear in kit-authored GSD files (D-110).
const DENY = /backlog|wildera|unreal|\bue5\b|uproject|blueprints?\b|game ?engine/i;

test("GSDC-50 kit-authored GSD files carry no project, engine or Backlog vocabulary", () => {
  const inv = JSON.parse(fs.readFileSync(path.join(KIT, "ship/.agents/gsd/inventory.json"), "utf8"));
  const files = [];
  for (const e of inv.entries.filter((x) => x.source === "kit-authored")) {
    const abs = path.join(KIT, "ship", e.installed);
    if (e.installed.endsWith("/")) for (const f of fs.readdirSync(abs)) files.push(path.join(abs, f));
    else files.push(abs);
  }
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const scanned = f.endsWith("verb-table.mjs") ? text.replace(/^ {2}"[^"]+": .*$/gm, "") : text;
    assert.doesNotMatch(scanned, DENY, f);
  }
  assert.match(fs.readFileSync(path.join(KIT, "ship/.agents/harness/gsd/verb-table.mjs"), "utf8"), /"todo\.match-phase"/);
});

test("GSDC-53 inventory covers every installed method file; generated workflow edits fail check, overlay edits do not", async () => {
  const inv = JSON.parse(fs.readFileSync(path.join(KIT, "ship/.agents/gsd/inventory.json"), "utf8"));
  const listed = new Set(inv.entries.map((e) => e.installed));
  for (const name of fs.readdirSync(path.join(KIT, "ship/.agents/agents"))) assert.ok(listed.has(`.agents/agents/${name}`), name);
  for (const w of ["map-codebase", "new-project", "discuss-phase", "execute-plan", "verify-work", "quick", "progress", "next", "pause-work", "resume-project", "transition", "undo", "health", "forensics", "debug-session-manager"]) assert.ok(listed.has(`.agents/gsd/generated/workflows/${w}.md`), w);
  for (const e of inv.entries) assert.ok(fs.existsSync(path.join(KIT, "ship", e.installed)), `${e.installed} exists`);
  const copy = makeTempDir("paseo kit ship ");
  fs.cpSync(path.join(KIT, "ship/.agents"), path.join(copy, ".agents"), { recursive: true });
  fs.cpSync(path.join(KIT, "ship/.claude/skills"), path.join(copy, ".claude/skills"), { recursive: true });
  const workflows = inv.entries.filter((e) => e.kind === "skill-workflow" && e.source !== "kit-authored").map((e) => e.installed);
  for (const rel of workflows) fs.appendFileSync(path.join(copy, rel), "one altered line\n");
  const altered = await gsd(KIT, ["upstream", "check", "--target", copy]);
  for (const rel of workflows) assert.ok(altered.json.problems.includes(`generated file stale or hand-edited: ${rel}`), rel);
  for (const rel of workflows) fs.writeFileSync(path.join(copy, rel), fs.readFileSync(path.join(KIT, "ship", rel)));
  fs.appendFileSync(path.join(copy, ".agents/gsd/overlays/gsd-planner.md"), "An extra overlay rule.\n");
  assert.equal((await gsd(KIT, ["upstream", "check", "--target", copy])).code, 0, "overlay edit passes");
  fs.writeFileSync(path.join(copy, ".agents/gsd/generated/stray.md"), "x");
  assert.ok((await gsd(KIT, ["upstream", "check", "--target", copy])).json.problems.includes("installed GSD method file not in the inventory: .agents/gsd/generated/stray.md"));
});
