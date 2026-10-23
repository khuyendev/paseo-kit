import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "../gsd-core/fixture.mjs";

const KIT = fileURLToPath(new URL("../../", import.meta.url));

// G186: a second inventory entry for an installed path must fail build and check before anything is written,
// instead of replacing the first entry's file. One source may still feed two installed paths (GSDC-53 shape).
test("G186 a duplicate installed path fails build and check; the file on disk is not replaced", async () => {
  const copy = makeTempDir("paseo kit ship ");
  fs.cpSync(path.join(KIT, "ship/.agents"), path.join(copy, ".agents"), { recursive: true });
  fs.cpSync(path.join(KIT, "ship/.claude/skills"), path.join(copy, ".claude/skills"), { recursive: true });
  const up = (sub) => gsd(KIT, ["upstream", sub, "--target", copy]);
  assert.equal((await up("check")).code, 0, "the shipped inventory has no duplicate and passes");
  const inventory = path.join(copy, ".agents/gsd/inventory.json");
  const json = JSON.parse(fs.readFileSync(inventory, "utf8"));
  const executor = json.entries.find((e) => e.installed === ".agents/agents/gsd-executor.md");
  json.entries.push({ ...executor, installed: ".agents/agents/gsd-planner.md" });
  fs.writeFileSync(inventory, JSON.stringify(json, null, 2));
  const planner = path.join(copy, ".agents/agents/gsd-planner.md");
  const before = fs.readFileSync(planner, "utf8");
  const built = await up("build");
  assert.equal(built.code, 1, JSON.stringify(built.json));
  assert.match(built.json.error, /duplicate installed path: \.agents\/agents\/gsd-planner\.md <- agents\/gsd-executor\.md/);
  assert.equal(fs.readFileSync(planner, "utf8"), before, "nothing written");
  const checked = await up("check");
  assert.equal(checked.code, 1);
  assert.ok(checked.json.problems.includes("duplicate installed path: .agents/agents/gsd-planner.md <- agents/gsd-executor.md (a second entry would replace the first)"), JSON.stringify(checked.json.problems));
});
