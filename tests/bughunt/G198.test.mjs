// Bug-hunt fix G198: the planning-panel README sent readers looking for agents to the retired swarm map; it now names the office plugin.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";

const PLUGINS = path.join(KIT_DIR, "plugins");
const read = (id) => fs.readFileSync(path.join(PLUGINS, id, "README.md"), "utf8");

test("G198: the planning-panel README does not send readers to the retired swarm map", () => {
  const readme = read("planning-panel");
  assert.doesNotMatch(readme, /swarm[- ]map/i);
  assert.match(readme, /the office plugin shows the agents/);
});

test("G198: the office plugin it names is shipped and shows agents", () => {
  assert.match(read("office"), /^Paseo plugin: .*\bagents of this host\b/m);
  assert.ok(fs.existsSync(path.join(PLUGINS, "office", "paseo-plugin.json")));
});

test("G198: no plugin README uses the spaced 'swarm map' phrase that OFFC-02 does not catch", () => {
  for (const id of ["planning-panel", "office"]) assert.doesNotMatch(read(id), /swarm map/i, `${id}/README.md`);
});
