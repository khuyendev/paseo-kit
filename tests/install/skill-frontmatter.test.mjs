// Every shipped SKILL.md front matter must be valid YAML, or Claude Code lists the skill without its description and it
// stops triggering (gsd-research did, 2026-10-22: an unquoted description held "Standalone: never").
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KIT_DIR, SHIP_DIR } from "../helpers/temp.mjs";

// The YAML rules a one-line `key: value` front matter can break: a plain scalar may not start with an indicator or hold
// ": " or " #"; a double-quoted one must be a whole JSON-compatible string; a single-quoted one must close.
export function frontmatterProblems(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return ["no front matter"];
  const problems = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") continue;
    if (value.startsWith('"')) {
      try {
        JSON.parse(value);
      } catch {
        problems.push(`${key}: double-quoted value does not close as one string`);
      }
    } else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) problems.push(`${key}: single-quoted value does not close`);
    } else if (/^[-?:,[\]{}#&*!|>%@`]/.test(value) && !/^\[.*\]$/.test(value)) problems.push(`${key}: plain value starts with an indicator`);
    else if (/: |\s#/.test(value) && !/^\[.*\]$/.test(value)) problems.push(`${key}: plain value holds ": " or " #"; quote it`);
  }
  return problems;
}

const skillFiles = () => {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === "SKILL.md") out.push(p);
    }
  };
  walk(path.join(SHIP_DIR, ".claude", "skills"));
  walk(path.join(KIT_DIR, "user"));
  return out;
};

test("SKIL-01 the front matter check flags the gsd-research regression and accepts quoted and plain values", () => {
  const fm = (line) => `---\nname: x\n${line}\n---\nbody\n`;
  assert.deepEqual(frontmatterProblems(fm("description: Views the research. Standalone: never continues.")), ['description: plain value holds ": " or " #"; quote it']);
  assert.deepEqual(frontmatterProblems(fm('description: "Views the research. Standalone: never continues."')), []);
  assert.deepEqual(frontmatterProblems(fm("description: 'It''s fine: quoted'")), []);
  assert.deepEqual(frontmatterProblems(fm("description: Plain text without a colon-space")), []);
  assert.equal(frontmatterProblems(fm('description: "unclosed')).length, 1);
  assert.equal(frontmatterProblems(fm("description: *alias")).length, 1);
  assert.equal(frontmatterProblems(fm("description: a # comment")).length, 1);
});

test("SKIL-01 every shipped skill's front matter is valid YAML with a description", () => {
  const files = skillFiles();
  assert.ok(files.length >= 17, `found ${files.length} skills`);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(frontmatterProblems(text), [], path.relative(KIT_DIR, file));
    assert.match(text, /^---\r?\n(?:.*\r?\n)*?description: \S/m, `${path.relative(KIT_DIR, file)} has a description`);
  }
});

test("SKIL-02 the owner's GSD and ph skills name trigger phrases in English and Vietnamese", () => {
  const names = ["gsd-debug", "gsd-discuss", "gsd-execute", "gsd-forensics", "gsd-map-codebase", "gsd-new-project", "gsd-pause", "gsd-plan", "gsd-progress", "gsd-quick", "gsd-research", "gsd-undo", "gsd-verify", "ph"];
  for (const name of names) {
    const line = /^description: (.*)$/m.exec(fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", name, "SKILL.md"), "utf8"))[1];
    const desc = JSON.parse(line);
    assert.ok(desc.length <= 1024, `${name} ${desc.length}`);
    const phrases = /Trigger on: (.*)\.$/.exec(desc)?.[1].match(/'[^']+'/g) ?? [];
    assert.ok(phrases.length >= 6, `${name} phrases`);
    assert.ok(phrases.some((p) => /[ạảãáàâầấậẩẫăằắặẳẵđêềếệểễôồốộổỗơờớợởỡưừứựửữìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(p)), `${name} has a Vietnamese phrase`);
    assert.ok(phrases.some((p) => /^'[\x20-\x7e]+'$/.test(p)), `${name} has an English phrase`);
  }
});
