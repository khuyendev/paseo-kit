// G170: a later discovery must not trust a trusted file whose size and mtime were restored, nor skip the install manifest
// check. The stamp passed as a 4th argument is the one the removed stamp cache returned and held (discover ignores it now);
// before the fix it made discovery return early, so the tests fail on the unfixed code.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { installRuntime, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { discover, trustedSet } from "../../ship/.claude/plugins/harness-files/scripts/discover.mjs";

const PLUGIN_SRC = path.join(SHIP_DIR, ".claude", "plugins", "harness-files");
const PAST = new Date("2020-01-02T03:04:05.000Z");

function project() {
  const root = makeTempDir("paseo kit project ");
  installRuntime(root);
  const files = {};
  for (const rel of trustedSet(root)) files[rel] = textDigest(fs.readFileSync(path.join(root, rel)));
  fs.writeFileSync(path.join(root, ".agents/harness-kit.json"), JSON.stringify({ version: "0.0.1", files }, null, 2));
  return root;
}
function cachePlugin() {
  const dir = path.join(makeTempDir("paseo kit cache "), "a", "b", "harness-files");
  fs.cpSync(PLUGIN_SRC, dir, { recursive: true });
  return dir;
}

test("G170 a same-size edit with its mtime restored is rejected although an earlier stamp matches", () => {
  const plugin = cachePlugin();
  const root = project();
  const cfg = path.join(root, ".agents/harness/config.mjs");
  fs.utimesSync(cfg, PAST, PAST);
  const first = discover("", root, plugin);
  const text = fs.readFileSync(cfg, "utf8");
  fs.writeFileSync(cfg, text.replace(/\w/, "Z")); // one character, same byte size
  fs.utimesSync(cfg, PAST, PAST);
  assert.equal(fs.statSync(cfg).size, Buffer.byteLength(text));
  assert.throws(() => discover("", root, plugin, first.stamp), /harness backend differs from installed marker: \.agents\/harness\/config\.mjs/);
});

test("G170 a discovery holding an earlier stamp still reads the install manifest", () => {
  const plugin = cachePlugin();
  const root = project();
  const first = discover("", root, plugin);
  fs.writeFileSync(path.join(root, ".agents/harness-kit.json"), "{not json");
  assert.throws(() => discover("", root, plugin, first.stamp), /harness install marker unreadable/);
});
