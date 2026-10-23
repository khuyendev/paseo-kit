// G199: the icon scan that smoke.mjs runs must see the icons the planning panel passes through a constant or a ternary.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { iconNames } from "../../plugins/smoke-icons.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const PLUGINS = path.join(KIT_DIR, "plugins");

test("G199 the icon scan finds ListTree, the sidebar ternary icons and the workspace chip icons in the real plugins", () => {
  const names = iconNames(PLUGINS);
  for (const icon of ["ListTree", "ChevronUp", "ChevronDown", "GitBranch", "FolderGit2"]) assert.ok(names.includes(icon), icon);
});

test("G199 the icon scan follows icon: NAME and icon={NAME} to a const in the same file, and ignores other constants and props", () => {
  const root = makeTempDir("paseo kit icons ");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text, "utf8");
  };
  write("office/client/empty.ts", "export {};\n");
  write("planning-panel/client/register.ts", [
    'const ICON = "ListTree";',
    'const LABEL = "Planning";',
    'const OTHER = "FolderSearch";',
    'client.addSidebarItem({ id: "planning", title: LABEL, icon: ICON });',
    "<Chip icon={ICON} />;",
    "<Chip icon={props.icon} />;",
    '<Icon name={open ? "ChevronUp" : "ChevronDown"} />;',
    "",
  ].join("\n"));
  assert.deepEqual(iconNames(root), ["ChevronDown", "ChevronUp", "ListTree"]);
});
