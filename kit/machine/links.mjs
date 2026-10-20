// kit-init user-skill links in the template providers' Claude config dirs (MACH-16, D-07). A link is the kit's only
// when the machine record holds its dest and the disk link still points at the recorded target; anything else at
// dest is the owner's and is never touched (INV-03).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { errText } from "../../ship/.agents/harness/lib/cli.mjs";
import { samePath } from "../../ship/.agents/harness/lib/paths.mjs";
import { Fail } from "./fail.mjs";
import { expandHome } from "./template.mjs";

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

// Every distinct rendered CLAUDE_CONFIG_DIR of the template providers.
export function linkDirs(tpl, home) {
  const dirs = [];
  for (const p of Object.values(tpl.providers)) {
    const raw = p?.env?.CLAUDE_CONFIG_DIR;
    if (typeof raw !== "string" || !raw) continue;
    const dir = expandHome(raw, home);
    if (!dirs.some((d) => samePath(d, dir))) dirs.push(dir);
  }
  return dirs;
}

export function readRecord(file) {
  let record;
  try {
    record = readJsonIf(file, { version: 1, links: [] });
  } catch (e) {
    throw new Fail(`cannot read the link record ${file}: ${e.message}`);
  }
  const valid = record?.version === 1 && Array.isArray(record.links) && record.links.every((l) => typeof l?.dest === "string" && typeof l?.target === "string");
  if (!valid) throw new Fail(`the link record ${file} is not {version: 1, links: [{dest, target}]}`);
  return record;
}

// Junction targets may come back with a \\?\ prefix or a trailing separator.
const cleanTarget = (t) => t.replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");

function readLink(dest) {
  let stat;
  try {
    stat = fs.lstatSync(dest);
  } catch (e) {
    if (e.code === "ENOENT") return { exists: false };
    throw e;
  }
  return stat.isSymbolicLink() ? { exists: true, link: cleanTarget(fs.readlinkSync(dest)) } : { exists: true, link: null };
}

// One state per dir: missing | kit (current target) | kit-old (recorded, older target) | owner.
export function linkStates(dirs, record, target) {
  return dirs.map((dir) => {
    const dest = path.join(dir, "skills", "kit-init");
    const disk = readLink(dest);
    const entry = record.links.find((l) => samePath(l.dest, dest));
    let state = "owner";
    if (!disk.exists) state = "missing";
    else if (disk.link && entry && samePath(disk.link, entry.target)) state = samePath(disk.link, target) ? "kit" : "kit-old";
    return { dir, dest, state, link: disk.link };
  });
}

export function linkLines(states) {
  return states.map(({ dest, state, link }) => {
    if (state === "kit") return { level: "ok", text: `${dest}: kit-init link from this kit` };
    if (state === "kit-old") return { level: "note", text: `${dest}: kit-made kit-init link points at ${link} (apply --link-user-skills re-points it)` };
    if (state === "missing") return { level: "note", text: `${dest}: kit-init link missing (kit.mjs machine apply --link-user-skills)` };
    return { level: "note", text: `${dest}: owner entry kept` };
  });
}

// Rename the old link aside, create the new one, restore the old one when creation fails, then drop the aside copy.
function repoint(dest, target) {
  const aside = `${dest}.kit-old-${process.pid}`;
  fs.renameSync(dest, aside);
  try {
    fs.symlinkSync(target, dest, LINK_TYPE);
  } catch (e) {
    fs.renameSync(aside, dest);
    throw e;
  }
  fs.unlinkSync(aside);
}

// mode "link" or "unlink"; returns {lines, failures}. The record is written only when it changed.
export function applyLinks(states, { record, recordFile, target, mode }) {
  const lines = [];
  let failures = 0;
  let links = record.links.slice();
  const forget = (dest) => (links = links.filter((l) => !samePath(l.dest, dest)));
  for (const { dest, state } of states) {
    try {
      if (state === "owner") lines.push(`note ${dest}: owner entry kept`);
      else if (mode === "unlink") {
        if (state === "missing") continue;
        fs.unlinkSync(dest);
        forget(dest);
        lines.push(`link: removed ${dest}`);
      } else if (state === "missing") {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.symlinkSync(target, dest, LINK_TYPE);
        forget(dest);
        links.push({ dest, target });
        lines.push(`link: created ${dest} -> ${target}`);
      } else if (state === "kit-old") {
        repoint(dest, target);
        forget(dest);
        links.push({ dest, target });
        lines.push(`link: re-pointed ${dest} -> ${target}`);
      }
    } catch (e) {
      failures++;
      lines.push(`failed link ${dest}: ${errText(e)}`);
    }
  }
  if (JSON.stringify(links) !== JSON.stringify(record.links)) writeJsonAtomic(recordFile, { version: 1, links });
  return { lines, failures };
}
