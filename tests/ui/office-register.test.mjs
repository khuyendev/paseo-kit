// OFFC-01 client registrations: one screen and one sidebar item, both removed by the returned disposer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCREEN_ID, SCREEN_TITLE, register } from "../../plugins/office/client/register.ts";

test("OFFC-01 register: adds the screen and the sidebar item and removes both on dispose", () => {
  const added = [];
  const removed = [];
  const client = {
    addScreen: (def) => (added.push(["screen", def]), () => removed.push("screen")),
    addSidebarHeaderItem: (def) => (added.push(["sidebar", def]), () => removed.push("sidebar")),
  };
  const Screen = () => null;
  const Item = () => null;
  const dispose = register(client, Screen, Item);
  assert.deepEqual(added.map(([kind]) => kind), ["screen", "sidebar"]);
  assert.deepEqual(added.map(([, def]) => [def.id, def.title]), [[SCREEN_ID, SCREEN_TITLE], [SCREEN_ID, SCREEN_TITLE]]);
  assert.equal(added[0][1].Component, Screen);
  assert.equal(added[1][1].Component, Item);
  assert.deepEqual(removed, []);
  dispose();
  assert.deepEqual(removed, ["screen", "sidebar"]);
});
