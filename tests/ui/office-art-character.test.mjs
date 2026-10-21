// Character art port (plan 07-04): oracle, layout, determinism, size-budget and hygiene tests.
//
// Pinned upstream: marmottajr/habblaud at faa1a012b5fbf632c66dc6801c5383e53a542406. Blob SHAs of the eleven files the oracle read:
// client/src/art/character/render.ts 4b9d89dfa65ea60aca801877537d7e0ec2ff0461, client/src/art/character/hair.ts 6e3d98ffbe36e416e55a771b80e5d5eceed773c8,
// client/src/art/character/appearance.ts 6c99bee0ea7fbcb8befe20e0f4e1bbe38675cba5, client/src/art/icons.ts 975b8e38aeb4dbb174a0dc46e7a2b04441bbd6bf,
// client/src/art/api.ts 736604dc0fbf76b70bc0fcd1d97592739c967232, shared/hash.ts 9428044cdccdcbb75b9cdf5694ce44ab4dbc5eb1,
// shared/appearance.ts 6ee97ac2fb28837e314856ef859c896a06016f74, shared/world/appearance-flat.ts d566e00ae80cdb95a8b131bd653ed84b212e1765,
// client/src/art/core/pixbuf.ts 87175feed781a1efb1597d952993405b5505ba2f, color.ts 1aa7e0c90eee37532474c22b0300c3cec787a133, sprite.ts f5014b97eb03ee1319ad02914992d3d27398b746.
//
// Method of the oracle tables below: a scratch script (never committed) transpiled the unmodified upstream files in memory and ran them in a
// fresh node:vm context that only had a relative-require shim, then printed hash groups. A frame hash is the first 16 hex characters of the
// SHA-256 of the text "<w>x<h>@<ax>,<ay>|" followed by the raw RGBA bytes; a group hash covers the frames of one pose joined by commas.
// The tables are regenerated only when the pinned commit is bumped on purpose; a failing comparison is fixed in the port, never in the tables.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hash32, mulberry32 } from "../../plugins/office/server/art/hash.ts";
import { ICON_NAMES, iconTemplates, renderIcon } from "../../plugins/office/server/art/icons.ts";
import {
  ACC_COLORS,
  BOTTOMS,
  EYES,
  HAIR_FUN,
  HAIR_NATURAL,
  SHOES,
  SKINS,
  appearanceFromSeed,
  appearanceKey,
} from "../../plugins/office/server/art/character/appearance.ts";
import * as hairModule from "../../plugins/office/server/art/character/hair.ts";
import * as partsModule from "../../plugins/office/server/art/character/parts.ts";
import { POSE_DURATION, SEAT_DROP, isSeated, renderCharacter } from "../../plugins/office/server/art/character/render.ts";
import { SHEET_SEATED_POSES, renderCharacterSheet } from "../../plugins/office/server/art/character/sheet.ts";
import * as typesModule from "../../plugins/office/server/art/character/types.ts";
import { PNG_MAX_DIMENSION, SPRITE_PNG_MAX_BYTES } from "../../plugins/office/server/limits.ts";
import { encodePng } from "../../plugins/office/server/png.ts";
import {
  CHAR_AX,
  CHAR_AY,
  CHAR_H,
  CHAR_W,
  DIRS,
  POSE_FRAMES,
  POSE_NAMES,
  ZOOM_CANDIDATES,
  ZOOM_LEVELS,
  sheetCell,
  sheetSize,
} from "../../plugins/office/shared/art-types.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const OFFICE = path.join(KIT_DIR, "plugins", "office");
const ART = path.join(OFFICE, "server", "art");
const normalise = (text) => text.replace(/\r\n/g, "\n");
const readSource = (file) => normalise(fs.readFileSync(file, "utf8"));
const SELF_SOURCE = readSource(new URL(import.meta.url));

// The single source of the pinned commit is the header of the 07-01 core file.
const CORE_HEADER = readSource(path.join(ART, "core", "pixbuf.ts")).split("\n")[0];
const COMMIT = /at ([0-9a-f]{40}) /.exec(CORE_HEADER)?.[1];
assert.ok(COMMIT, "the core pixbuf header names a 40-character commit");

// The eight source files of this plan, relative to server/art, with the habblaud path each one is mapped to.
const UPSTREAM_PATH = {
  "hash.ts": "shared/hash.ts",
  "icons.ts": "client/src/art/icons.ts",
  "character/parts.ts": "shared/appearance.ts",
  "character/types.ts": "client/src/art/api.ts",
  "character/appearance.ts": "shared/world/appearance-flat.ts",
  "character/hair.ts": "client/src/art/character/hair.ts",
  "character/render.ts": "client/src/art/character/render.ts",
  "character/sheet.ts": "client/src/art/character/render.ts",
};

const h16 = (data) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
const bytesOf = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
const sameBytes = (a, b) => bytesOf(a).equals(bytesOf(b));
const frameHash = (sprite) => h16(Buffer.concat([Buffer.from(`${sprite.buf.w}x${sprite.buf.h}@${sprite.ax},${sprite.ay}|`), bytesOf(sprite.buf.data)]));
const canon = (a) =>
  Object.keys(a)
    .sort()
    .map((k) => `${k}=${a[k] === undefined ? "-" : a[k]}`)
    .join("|");
const appearanceOf = (id) => appearanceFromSeed(hash32(id));
const cellBytes = (sheet, col, row) => sheet.buf.crop(col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H).data;
const isBlank = (data) => data.every((v) => v === 0);

// Group hash of all frames of one pose and direction.
function groupHash(appearance, dir, pose, extra = {}) {
  const hashes = [];
  for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) hashes.push(frameHash(renderCharacter({ appearance, dir, pose, frame, ...extra })));
  return h16(hashes.join(","));
}

// ---------------------------------------------------------------- hygiene detectors

const DOM_NAMES = ["document", "localStorage", "requestAnimationFrame", "HTMLCanvasElement", "getContext", "createElement", "ImageData"];
const BANNED_CODE = [
  ...DOM_NAMES.map((n) => new RegExp(`\\b${n}\\b`)),
  /\bwindow\s*\./,
  /\bMath\.random\b/,
  /\bDate\.now\b/,
  /\bnew\s+Date\b/,
  /\bperformance\.now\b/,
  /\bprocess\b/,
  /\brequire\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bconsole\b/,
];
const PORTUGUESE_WORDS = /\b(para|uma|dos|das|pelo|pela|sem|mais|quando|onde|entao|tambem|cada|todo|toda|ainda|porque)\b/;
const ACCENTED = /[\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/;

// Replaces comments, string literals and template literals by spaces (newlines stay) so name searches only see code.
function blankNonCode(text, keepStrings = false) {
  let out = "";
  let i = 0;
  const n = text.length;
  const spaces = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      let j = text.indexOf("\n", i);
      if (j < 0) j = n;
      out += " ".repeat(j - i);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = text.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      out += spaces(text.slice(i, j));
      i = j;
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out += keepStrings ? text.slice(i, j) : spaces(text.slice(i, j));
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Problems of one source file of the plan; relPath is relative to server/art (a key of UPSTREAM_PATH).
function hygieneProblems(relPath, text) {
  const problems = [];
  const upstream = UPSTREAM_PATH[relPath];
  const head = text.split("\n").slice(0, 5).join("\n");
  const headComments = head
    .split("\n")
    .filter((l) => l.startsWith("//"))
    .join("\n");
  if (!headComments.includes("marmottajr/habblaud") || !headComments.includes(upstream)) problems.push("header: upstream path missing");
  if (!headComments.includes(COMMIT)) problems.push("header: pinned commit missing");
  for (const sha of text.match(/\b[0-9a-f]{40}\b/g) ?? []) if (sha !== COMMIT) problems.push(`header: other commit ${sha}`);
  if (text.split(COMMIT).join("").includes(COMMIT.slice(0, 7))) problems.push("commit in another form");
  const code = blankNonCode(text);
  for (const m of code.matchAll(/\bconstructor\s*\(([^)]*)\)/g)) {
    if (/\b(public|private|protected|readonly)\b/.test(m[1])) problems.push("parameter property");
  }
  if (/^\s*(export\s+)?(declare\s+)?(const\s+)?enum\b/m.test(code)) problems.push("enum");
  if (/^\s*(export\s+)?(declare\s+)?namespace\b/m.test(code)) problems.push("namespace");
  for (const m of blankNonCode(text, true).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.startsWith("node:")) problems.push(`node specifier ${spec}`);
    if (spec.startsWith(".") && !spec.endsWith(".ts")) problems.push(`import without .ts ${spec}`);
  }
  for (const re of BANNED_CODE) if (re.test(code)) problems.push(`banned name ${re.source}`);
  if (text.includes("// office-part-continues")) problems.push("leftover part marker");
  if (ACCENTED.test(text)) problems.push("accented letter");
  for (const line of text.split("\n")) {
    const at = line.indexOf("//");
    if (at >= 0 && PORTUGUESE_WORDS.test(line.slice(at))) problems.push(`Portuguese word in comment: ${line.trim()}`);
  }
  return problems;
}

const HEADER = (upstream) => `// Ported from marmottajr/habblaud ${upstream} at ${COMMIT} (MIT; notice added by 07-05).\n`;
const sourceOf = (relPath) => readSource(path.join(ART, relPath));

// ---------------------------------------------------------------- oracle tables (computed from the unmodified upstream, see the file header)

// G1: h16 of canon(appearanceFromSeed(hash32(id))); ALL joins the 300 canon strings of agent-0 to agent-299 by newline
const ORACLE_APPEARANCE = {
  "agent-0": "0673ed8e8218a29f",
  "agent-1": "9423464f97f52b1a",
  "agent-2": "ba6cda0d1e787100",
  "agent-3": "abb0309f05145c5c",
  "agent-4": "e1d61b383f7ac33d",
  "agent-5": "86de89124175ec03",
  "agent-6": "e58bda7e1825c35b",
  "agent-7": "9593bd32d238d966",
  "agent-8": "ba9eeaa8d2c4fa19",
  "agent-9": "11a580ee33e4bb7e",
  "agent-10": "3fff59877683d89b",
  "agent-11": "1e7f44b62b4bede3",
  "agent-12": "aa94f532aa047cb9",
  "agent-13": "7ccb56f15fd55061",
  "agent-14": "f02e457b22b76c68",
  "agent-15": "fd82028d5bece82f",
  "agent-16": "1cc6acf82a9466cd",
  "agent-17": "5ce00442cbd9e060",
  "agent-18": "b9bdbef6f4c47a05",
  "agent-19": "23518878f00c8208",
  "agent-20": "07144997e4d30997",
  "agent-21": "2004983c4c7bde41",
  "agent-22": "36d134e858401c23",
  "agent-23": "16fe610af97ebc5b",
  "agent-24": "7ddfec682eac5164",
  "agent-25": "e7568ca2f1a79f2e",
  "agent-26": "6bd37607fd666e85",
  "agent-27": "8d7aabf9edcc45d3",
  "agent-28": "408f5890902b148c",
  "agent-29": "006ee16686c6363a",
  "agent-30": "d9cef875795de5d3",
  "agent-31": "f4277106a33d834a",
  "agent-32": "b18e8e5a4ccb0da0",
  "agent-33": "e3684fff82d9d2c3",
  "agent-34": "5571fbd377005e61",
  "agent-35": "bb7c88964f2e28b6",
  "agent-36": "bbf54c96f0e9919f",
  "agent-37": "8affe0894ff59f7b",
  "agent-38": "6dcb8346f8f6505b",
  "agent-39": "18271d7413970cdf",
  "agent-40": "3f748b5abecf0cef",
  "agent-41": "83ef2785b86f9c3d",
  "agent-42": "b3e724ec553f250d",
  "agent-43": "22b07c56a10926bd",
  "agent-44": "098449fe13c5afd3",
  "agent-45": "a4a0caca02cf11cf",
  "agent-46": "0fbb775a707cecbe",
  "agent-47": "e4929851127b2cbc",
  "agent-48": "b1a6dcd6325e5063",
  "agent-49": "ffbd0d506ebc081d",
  "agent-50": "8e7458b316d56946",
  "agent-51": "29072feaa1a12399",
  "agent-52": "b7ba822d62ec73f8",
  "agent-53": "5dd42a0145f8a9e4",
  "agent-54": "247302ffab2ed42f",
  "agent-55": "b69fd1ffb7f363d7",
  "agent-56": "825ddbba54d49a3e",
  "agent-57": "347e0686db20e584",
  "agent-58": "f289d2c974fe53b2",
  "agent-59": "cfd77f92c6b4d595",
  "ALL": "90e36bee36a71b07",
  "agent-7|sub": "8cfa4c5f29d7cde0",
  "agent-7|look-f": "91ed5436e6361fcf",
  "agent-7|look-m": "9593bd32d238d966"
};

// G3: the 24 upstream icon names in order and the frame hash of renderIcon(name)
const ORACLE_ICONS = {
  "names": [
    "alert",
    "question",
    "zzz",
    "check",
    "heart",
    "coffee",
    "music",
    "idea",
    "sweat",
    "star",
    "lightning",
    "chat",
    "box",
    "hourglass",
    "hourglass_flip",
    "cobweb",
    "storm",
    "wave",
    "coin",
    "sparkle",
    "trophy",
    "hand_rock",
    "hand_paper",
    "hand_scissors"
  ],
  "hashes": {
    "alert": "d23f2cd95c4d574a",
    "question": "f316453272276824",
    "zzz": "7d4aadbdb9b947c0",
    "check": "58e6ef0be064c14c",
    "heart": "50d14f0257b219d3",
    "coffee": "a59eba71269ee922",
    "music": "9e3b78be671e2449",
    "idea": "d9859036ad783dd9",
    "sweat": "263a8cc9f6184b5a",
    "star": "502bce3d51df6010",
    "lightning": "9c2a83591000c8af",
    "chat": "a06472ef2cb40a15",
    "box": "1641705438c128a2",
    "hourglass": "e2f672434bc3e3e8",
    "hourglass_flip": "39c97691720851fd",
    "cobweb": "5d56a1d138e38f73",
    "storm": "13a3a761bfcd235e",
    "wave": "e4399b2c66880b52",
    "coin": "cb33eba00aded161",
    "sparkle": "d2b0005b41659e77",
    "trophy": "edc0979463a14c5e",
    "hand_rock": "4e4e5fc9862dfe04",
    "hand_paper": "569175e821f0623f",
    "hand_scissors": "6b94ea3f3aa0aabc"
  }
};

// G4: group hash of all frames, key pose|seed|pose|dir
const ORACLE_POSES = {
  "pose|agent-0|stand|down": "4efaf925cfede636",
  "pose|agent-0|stand|up": "c51cfc51a9918399",
  "pose|agent-0|stand|left": "4a6a13bcb9186a63",
  "pose|agent-0|stand|right": "5a8d89f7273bbb02",
  "pose|agent-0|walk|down": "56f2a8a5aa91cf15",
  "pose|agent-0|walk|up": "7837766ef7d1027a",
  "pose|agent-0|walk|left": "a0761a637a1a704d",
  "pose|agent-0|walk|right": "162cd07200fcde94",
  "pose|agent-0|run|down": "5d46459307e40d28",
  "pose|agent-0|run|up": "f34d6eca2a91adb3",
  "pose|agent-0|run|left": "ae10fc6f9ab5a0d9",
  "pose|agent-0|run|right": "795b0a9e524b0174",
  "pose|agent-0|sit|down": "df9a237e52720771",
  "pose|agent-0|sit|up": "a4dba4f03d48202a",
  "pose|agent-0|sit|left": "f04368121e8a3a59",
  "pose|agent-0|sit|right": "06c34d57b66a758c",
  "pose|agent-0|type|down": "c8f3919446971103",
  "pose|agent-0|type|up": "3cce0088ede19eb8",
  "pose|agent-0|type|left": "a0f286959d050bb9",
  "pose|agent-0|type|right": "446b1b3bbe26a0b8",
  "pose|agent-0|sleep|down": "474a184222872c07",
  "pose|agent-0|sleep|up": "3493b7eb772e5998",
  "pose|agent-0|sleep|left": "bc06ba54356df307",
  "pose|agent-0|sleep|right": "2888307e5565680d",
  "pose|agent-0|drink|down": "400182ad58245a0d",
  "pose|agent-0|drink|up": "4b3665c3dac9d57a",
  "pose|agent-0|drink|left": "ae39b19d3004c3a9",
  "pose|agent-0|drink|right": "0f3053e2dae62674",
  "pose|agent-0|use|down": "1fd42595895e762a",
  "pose|agent-0|use|up": "59b88f4031bbee9c",
  "pose|agent-0|use|left": "8fcdcc67b9945edb",
  "pose|agent-0|use|right": "40bffcd7949d7b4b",
  "pose|agent-0|raise_hand|down": "b17bcff948646812",
  "pose|agent-0|raise_hand|up": "3e1f161c3a09e3d8",
  "pose|agent-0|raise_hand|left": "3e1a5372b0213291",
  "pose|agent-0|raise_hand|right": "f80c2ea63843da74",
  "pose|agent-0|talk|down": "25ef79236977e66b",
  "pose|agent-0|talk|up": "25b6ed7efb3e7fac",
  "pose|agent-0|talk|left": "872d21d29ab587c4",
  "pose|agent-0|talk|right": "c14e010091678547",
  "pose|agent-0|stretch|down": "57a0c6ef0fa04a1f",
  "pose|agent-0|stretch|up": "b454ca4c6fb54ad0",
  "pose|agent-0|stretch|left": "2e7abab9c021e09e",
  "pose|agent-0|stretch|right": "135a313ee5d64f59",
  "pose|agent-0|read|down": "1df5d812dd2b5774",
  "pose|agent-0|read|up": "6bd2cc898c9fdfb1",
  "pose|agent-0|read|left": "2aee04106af99c58",
  "pose|agent-0|read|right": "270bc57e33179250",
  "pose|agent-0|play|down": "7116763d78e1cb3b",
  "pose|agent-0|play|up": "448ca411a9c152ae",
  "pose|agent-0|play|left": "61945d444872f9f8",
  "pose|agent-0|play|right": "8f63544789e8ed2d",
  "pose|agent-0|wait|down": "b338d6944feeef01",
  "pose|agent-0|wait|up": "3ddf701114f98397",
  "pose|agent-0|wait|left": "aced64bb5c3ff7d1",
  "pose|agent-0|wait|right": "5e0e86863ae506b3",
  "pose|agent-0|cheer|down": "42c802317999b0a9",
  "pose|agent-0|cheer|up": "e905fcd801997b72",
  "pose|agent-0|cheer|left": "7e84be1d8b6e08a4",
  "pose|agent-0|cheer|right": "ba64ed0df0f219ea",
  "pose|agent-0|laugh|down": "d4100d0216db8eed",
  "pose|agent-0|laugh|up": "7ba0b44f720a9b35",
  "pose|agent-0|laugh|left": "5781530c1e59026b",
  "pose|agent-0|laugh|right": "625d8c46dab6a6d3",
  "pose|agent-0|game|down": "7bda736d30f3a2e6",
  "pose|agent-0|game|up": "490b1a3fe1d59558",
  "pose|agent-0|game|left": "fcf1dfa9a0367425",
  "pose|agent-0|game|right": "c65987c3c3f303ca",
  "pose|agent-0|rps|down": "1d1f9caffd698217",
  "pose|agent-0|rps|up": "7424bac4b6033030",
  "pose|agent-0|rps|left": "5f4928f421031072",
  "pose|agent-0|rps|right": "33cedc9561dbe5a0",
  "pose|agent-0|groom|down": "21019d319e485c24",
  "pose|agent-0|groom|up": "42339363f48d7304",
  "pose|agent-0|groom|left": "33ae0df6fa880cc3",
  "pose|agent-0|groom|right": "38f1846a9bef4042",
  "pose|agent-0|sulk|down": "fa3c09b6416f03f3",
  "pose|agent-0|sulk|up": "132f98d86e7e0967",
  "pose|agent-0|sulk|left": "0cb15303ee759e39",
  "pose|agent-0|sulk|right": "8035e184c18c42f5",
  "pose|agent-1|stand|down": "b1faf097412eccc3",
  "pose|agent-1|stand|up": "5056d1c914a90cee",
  "pose|agent-1|stand|left": "2a8c2578a7b63cc2",
  "pose|agent-1|stand|right": "df75f56a6564fc31",
  "pose|agent-1|walk|down": "3d003652c2806aeb",
  "pose|agent-1|walk|up": "388c218c916c57ec",
  "pose|agent-1|walk|left": "59f50c31d3a1231b",
  "pose|agent-1|walk|right": "5ccc6cb7a1a202e0",
  "pose|agent-1|run|down": "e5ad2116b57a5ce8",
  "pose|agent-1|run|up": "d74bb015e8a50443",
  "pose|agent-1|run|left": "c1eb19bc5855a34a",
  "pose|agent-1|run|right": "cbed3c09496b8dc4",
  "pose|agent-1|sit|down": "e7168722ed4d8690",
  "pose|agent-1|sit|up": "c8a4d97b7d25df21",
  "pose|agent-1|sit|left": "743b2cc68a3e9b78",
  "pose|agent-1|sit|right": "dccde6f261a0fbce",
  "pose|agent-1|type|down": "0b65356ec0aba7c3",
  "pose|agent-1|type|up": "925998abd4231118",
  "pose|agent-1|type|left": "b712e5326ebdfe09",
  "pose|agent-1|type|right": "882cedfb426ba6dd",
  "pose|agent-1|sleep|down": "a7c0fdedffb5e2e5",
  "pose|agent-1|sleep|up": "d5bd630ce44db618",
  "pose|agent-1|sleep|left": "7fd7ba82f48e7d91",
  "pose|agent-1|sleep|right": "aba1bb58839e8dc0",
  "pose|agent-1|drink|down": "cc6bfadd100716bb",
  "pose|agent-1|drink|up": "8a3382fab62f0de3",
  "pose|agent-1|drink|left": "dcfb8f01d1ffa8c9",
  "pose|agent-1|drink|right": "328816772c578df5",
  "pose|agent-1|use|down": "de672a2b4fea30f7",
  "pose|agent-1|use|up": "89fdebce1b3c758c",
  "pose|agent-1|use|left": "c1d17fe379f92ed3",
  "pose|agent-1|use|right": "0e1806bd396ab7ab",
  "pose|agent-1|raise_hand|down": "130b0f78c925704f",
  "pose|agent-1|raise_hand|up": "fe7fc89b2bab74e7",
  "pose|agent-1|raise_hand|left": "a1ae7b951571a9fd",
  "pose|agent-1|raise_hand|right": "acaead7fc5e5a8ca",
  "pose|agent-1|talk|down": "124b40cdee256e45",
  "pose|agent-1|talk|up": "581149c938457005",
  "pose|agent-1|talk|left": "91a922bcc060472d",
  "pose|agent-1|talk|right": "c9f2f04a90a4dbcf",
  "pose|agent-1|stretch|down": "9b619e85c2813ab9",
  "pose|agent-1|stretch|up": "26bd99c1213ea8f1",
  "pose|agent-1|stretch|left": "dd3b53c684fc9b52",
  "pose|agent-1|stretch|right": "6d1ee561c753c09b",
  "pose|agent-1|read|down": "8b2adedab064f9ac",
  "pose|agent-1|read|up": "07634b84d743d2bd",
  "pose|agent-1|read|left": "dcd4f2e4545fb52a",
  "pose|agent-1|read|right": "03124dc2a2b4d3a8",
  "pose|agent-1|play|down": "e769efa075b65183",
  "pose|agent-1|play|up": "b8926004530bf95e",
  "pose|agent-1|play|left": "c415c97947ce8ae5",
  "pose|agent-1|play|right": "46449511b252604b",
  "pose|agent-1|wait|down": "4c1f9521f29170e8",
  "pose|agent-1|wait|up": "42d751c96899c05b",
  "pose|agent-1|wait|left": "a52ff6db5eded88f",
  "pose|agent-1|wait|right": "1625792a92780070",
  "pose|agent-1|cheer|down": "9b8a24c635824b6e",
  "pose|agent-1|cheer|up": "8e612c08f0dfcae4",
  "pose|agent-1|cheer|left": "cade02396fcd7bed",
  "pose|agent-1|cheer|right": "cb5da2add2407fed",
  "pose|agent-1|laugh|down": "8dc4767fcdaad485",
  "pose|agent-1|laugh|up": "88b651046ad5d7ef",
  "pose|agent-1|laugh|left": "c852600e782e1b3c",
  "pose|agent-1|laugh|right": "1bba4d00c218d3de",
  "pose|agent-1|game|down": "06a2385653f3b55b",
  "pose|agent-1|game|up": "dba181229ddd3327",
  "pose|agent-1|game|left": "a7a24d2795ae3b4a",
  "pose|agent-1|game|right": "cb1e185e2806246a",
  "pose|agent-1|rps|down": "446af69627dd8177",
  "pose|agent-1|rps|up": "4915dbfa208dfc55",
  "pose|agent-1|rps|left": "6517f3fe9181da34",
  "pose|agent-1|rps|right": "b7585a6ea93b0070",
  "pose|agent-1|groom|down": "9f767ec7e4b00612",
  "pose|agent-1|groom|up": "be43f9365783b129",
  "pose|agent-1|groom|left": "3b0b9d11ddc340da",
  "pose|agent-1|groom|right": "2937c478d0b11e1a",
  "pose|agent-1|sulk|down": "c6edeb371cfc3328",
  "pose|agent-1|sulk|up": "9fb7d32afc0e3cd7",
  "pose|agent-1|sulk|left": "88603ad65f9cbbfa",
  "pose|agent-1|sulk|right": "5db2be41b1df4b88",
  "pose|agent-2|stand|down": "b20f1d42f321374f",
  "pose|agent-2|stand|up": "effd5dc0968b5efe",
  "pose|agent-2|stand|left": "aec0453980022b2e",
  "pose|agent-2|stand|right": "c9a277b9db6e07ec",
  "pose|agent-2|walk|down": "155f8e6cd3982384",
  "pose|agent-2|walk|up": "7879f8a6431cc32d",
  "pose|agent-2|walk|left": "de990bd1b4b24ac8",
  "pose|agent-2|walk|right": "994c0333a2844028",
  "pose|agent-2|run|down": "aef5dad1133d4b7d",
  "pose|agent-2|run|up": "b11220c5c5ac953f",
  "pose|agent-2|run|left": "c5b6dc44c7151e86",
  "pose|agent-2|run|right": "7e6934a348a0ac27",
  "pose|agent-2|sit|down": "4d7e80c65090cc80",
  "pose|agent-2|sit|up": "330da738ac6c1058",
  "pose|agent-2|sit|left": "7934dbd147e0e851",
  "pose|agent-2|sit|right": "4d48a1e389ebaadc",
  "pose|agent-2|type|down": "8e8094b867a2f4f6",
  "pose|agent-2|type|up": "907ceb11dd5c2052",
  "pose|agent-2|type|left": "cb8a01412a1c8388",
  "pose|agent-2|type|right": "141533d3c4b346f8",
  "pose|agent-2|sleep|down": "93e20219feab07fc",
  "pose|agent-2|sleep|up": "f115eef3d52e1d62",
  "pose|agent-2|sleep|left": "2eac028c5ed8c8d5",
  "pose|agent-2|sleep|right": "5d84ab820feac4b4",
  "pose|agent-2|drink|down": "625e2d8823d9d881",
  "pose|agent-2|drink|up": "c5a093b11f5987e9",
  "pose|agent-2|drink|left": "4791633930bffb35",
  "pose|agent-2|drink|right": "9dde8d2b3bc6ce6a",
  "pose|agent-2|use|down": "ddb46abd2238c4ae",
  "pose|agent-2|use|up": "8d22088d1dedda9a",
  "pose|agent-2|use|left": "9358c3efce480d99",
  "pose|agent-2|use|right": "97aa0e0a803f5119",
  "pose|agent-2|raise_hand|down": "49a7ea2408c674d5",
  "pose|agent-2|raise_hand|up": "18d3f5d43d542a81",
  "pose|agent-2|raise_hand|left": "df446b3119e9cee0",
  "pose|agent-2|raise_hand|right": "811c970eeca49ff5",
  "pose|agent-2|talk|down": "c24aa9b234a2a66c",
  "pose|agent-2|talk|up": "019b31fa13053518",
  "pose|agent-2|talk|left": "cccab9dc8ef8c095",
  "pose|agent-2|talk|right": "8d79b3a7679b9a70",
  "pose|agent-2|stretch|down": "9dfe5bbc1ceb3e9e",
  "pose|agent-2|stretch|up": "bf1f595eb3cd0c2e",
  "pose|agent-2|stretch|left": "3c9e28f30fbb3e28",
  "pose|agent-2|stretch|right": "d8c6d8ee5fc22396",
  "pose|agent-2|read|down": "9370caec955aeec0",
  "pose|agent-2|read|up": "16fc9276fd2b95e5",
  "pose|agent-2|read|left": "d35dae3e626002d1",
  "pose|agent-2|read|right": "071ffcb1b9ef02f9",
  "pose|agent-2|play|down": "07324d3d50b5c51d",
  "pose|agent-2|play|up": "fff7b33b5578b963",
  "pose|agent-2|play|left": "633d39fa8775b651",
  "pose|agent-2|play|right": "1af257517baaa824",
  "pose|agent-2|wait|down": "7c1ffadb9cfa4ccc",
  "pose|agent-2|wait|up": "86943ec60772b9b5",
  "pose|agent-2|wait|left": "7e9b25060487483c",
  "pose|agent-2|wait|right": "9f258ce5eacfa2da",
  "pose|agent-2|cheer|down": "041f5327b6f8a79b",
  "pose|agent-2|cheer|up": "eb212aaf14a6c603",
  "pose|agent-2|cheer|left": "8cf3695bccebf356",
  "pose|agent-2|cheer|right": "3e9e32c470ef70d1",
  "pose|agent-2|laugh|down": "a1c4d95e25da4d89",
  "pose|agent-2|laugh|up": "2e4810deed0f8bea",
  "pose|agent-2|laugh|left": "d9f35477384e4d6a",
  "pose|agent-2|laugh|right": "f5b1fb1c041b7f54",
  "pose|agent-2|game|down": "c7b044ba3c145fad",
  "pose|agent-2|game|up": "86928fc74fba05c1",
  "pose|agent-2|game|left": "25a95336819a346d",
  "pose|agent-2|game|right": "494638dd1dd61e7d",
  "pose|agent-2|rps|down": "cc76f3945561a381",
  "pose|agent-2|rps|up": "84d0498919d69609",
  "pose|agent-2|rps|left": "f422e6d4d7c64db2",
  "pose|agent-2|rps|right": "3d559f3688f3c525",
  "pose|agent-2|groom|down": "4df1de3cdd0a73e3",
  "pose|agent-2|groom|up": "e97aea80be0fb482",
  "pose|agent-2|groom|left": "38de944b5b945595",
  "pose|agent-2|groom|right": "ba0f793b8a7f611e",
  "pose|agent-2|sulk|down": "8a5feabacb2444b8",
  "pose|agent-2|sulk|up": "58f054f030dda6c9",
  "pose|agent-2|sulk|left": "06d93c6a0863b307",
  "pose|agent-2|sulk|right": "88cf90c864ad73a7"
};

// G5: group hash with seated true, key seat|seed|pose|dir
const ORACLE_SEATED = {
  "seat|agent-0|raise_hand|down": "051724d7a2d5f35b",
  "seat|agent-0|raise_hand|up": "2f5cf47b2a157cb9",
  "seat|agent-0|raise_hand|left": "2d47fa7cb2de420d",
  "seat|agent-0|raise_hand|right": "3e2c2e0a96bd7c47",
  "seat|agent-0|read|down": "8920a82814aea2ac",
  "seat|agent-0|read|up": "5602a7df23d0f350",
  "seat|agent-0|read|left": "08cdadb6b680ce83",
  "seat|agent-0|read|right": "7cea85c0aebb2b95",
  "seat|agent-0|sulk|down": "db13aeec2b08845c",
  "seat|agent-0|sulk|up": "e0ab64eca38b98a0",
  "seat|agent-0|sulk|left": "c26a824bfe651218",
  "seat|agent-0|sulk|right": "ac3127dcd0042fdc",
  "seat|agent-0|use|down": "514df75a27cdc16a",
  "seat|agent-0|use|up": "56005d043f56871e",
  "seat|agent-0|use|left": "e8cbcb3b5b894e26",
  "seat|agent-0|use|right": "aac27a6debdff166",
  "seat|agent-0|talk|down": "ffc09808810d05bf",
  "seat|agent-0|talk|up": "6c27066b4f2a203a",
  "seat|agent-0|talk|left": "5228d3d4bfc55257",
  "seat|agent-0|talk|right": "be4cb3f5ae2ba66c",
  "seat|agent-0|cheer|down": "486c46a2d11de85a",
  "seat|agent-0|cheer|up": "5d92acb445d7d14c",
  "seat|agent-0|cheer|left": "aec3fb164ae45c39",
  "seat|agent-0|cheer|right": "a53e230b5b857d29",
  "seat|agent-0|laugh|down": "ca4e01c1e1ae9a45",
  "seat|agent-0|laugh|up": "722a614fff9b946e",
  "seat|agent-0|laugh|left": "53cee5d0d22daf0c",
  "seat|agent-0|laugh|right": "bf406979981c6426",
  "seat|agent-0|game|down": "540232887644acbe",
  "seat|agent-0|game|up": "9b57edd43a593bbe",
  "seat|agent-0|game|left": "926d136bba5323fc",
  "seat|agent-0|game|right": "5ea848f9eb6d2b18",
  "seat|agent-0|rps|down": "de071bd08f924434",
  "seat|agent-0|rps|up": "b17b544e428e6b38",
  "seat|agent-0|rps|left": "5dad10348df128f3",
  "seat|agent-0|rps|right": "63e2c0d68b67d9eb",
  "seat|agent-0|drink|down": "27caec67a903a798",
  "seat|agent-0|drink|up": "a60fb7e2ccf5d246",
  "seat|agent-0|drink|left": "93d29847f711ab1d",
  "seat|agent-0|drink|right": "730af90aae04a9c5",
  "seat|agent-0|stand|down": "df9a237e52720771",
  "seat|agent-0|stand|up": "a4dba4f03d48202a",
  "seat|agent-0|stand|left": "f04368121e8a3a59",
  "seat|agent-0|stand|right": "06c34d57b66a758c",
  "seat|agent-0|wait|down": "b338d6944feeef01",
  "seat|agent-0|wait|up": "3ddf701114f98397",
  "seat|agent-0|wait|left": "aced64bb5c3ff7d1",
  "seat|agent-0|wait|right": "5e0e86863ae506b3"
};

// G6: frame hash with a costume, key cost|seed|costume|dir|pose|frame
const ORACLE_COSTUMES = {
  "cost|agent-0|santa|down|stand|0": "d713d7a681eba5df",
  "cost|agent-0|santa|down|walk|1": "8e2bbb4939447c77",
  "cost|agent-0|santa|up|stand|0": "71e82094d8aea4eb",
  "cost|agent-0|santa|up|walk|1": "4734205dc2430bf7",
  "cost|agent-0|santa|left|stand|0": "8f7fbba6a43ec7c9",
  "cost|agent-0|santa|left|walk|1": "9550b304cc0bdc1e",
  "cost|agent-0|santa|right|stand|0": "c5174bcc691b366a",
  "cost|agent-0|santa|right|walk|1": "2a43952a678d7bc2",
  "cost|agent-0|witch|down|stand|0": "be8f89cc7956c907",
  "cost|agent-0|witch|down|walk|1": "c4d6dd39e7454e50",
  "cost|agent-0|witch|up|stand|0": "4717747ed53c9e2b",
  "cost|agent-0|witch|up|walk|1": "e48baecf4cd99db4",
  "cost|agent-0|witch|left|stand|0": "651f3e7243f399ae",
  "cost|agent-0|witch|left|walk|1": "cea531889e1b990e",
  "cost|agent-0|witch|right|stand|0": "03df5231c043c901",
  "cost|agent-0|witch|right|walk|1": "62a571e266a2895c",
  "cost|agent-0|pumpkin|down|stand|0": "6b037819634097c8",
  "cost|agent-0|pumpkin|down|walk|1": "edb8662bf38ff81b",
  "cost|agent-0|pumpkin|up|stand|0": "3072901252986c8c",
  "cost|agent-0|pumpkin|up|walk|1": "6ea5ab82f04442e8",
  "cost|agent-0|pumpkin|left|stand|0": "d0548c665596daea",
  "cost|agent-0|pumpkin|left|walk|1": "57cddb085a5774d7",
  "cost|agent-0|pumpkin|right|stand|0": "81706fe59a1ea6dd",
  "cost|agent-0|pumpkin|right|walk|1": "48fdca82ffd49d0a",
  "cost|agent-0|vampire|down|stand|0": "07be15d2730709ad",
  "cost|agent-0|vampire|down|walk|1": "130dc55aab159fa9",
  "cost|agent-0|vampire|up|stand|0": "2f3afd4c90d0b6d9",
  "cost|agent-0|vampire|up|walk|1": "5f523391e2f01874",
  "cost|agent-0|vampire|left|stand|0": "64293264c4350c91",
  "cost|agent-0|vampire|left|walk|1": "a7215bd8fce6e123",
  "cost|agent-0|vampire|right|stand|0": "af18e491b6934b8f",
  "cost|agent-0|vampire|right|walk|1": "f409f12fd152d2de"
};

// G7: group hash with a held item, key held|seed|pose|held|dir
const ORACLE_HELD = {
  "held|agent-1|drink|coffee|down": "cc6bfadd100716bb",
  "held|agent-1|drink|coffee|up": "8a3382fab62f0de3",
  "held|agent-1|drink|coffee|left": "dcfb8f01d1ffa8c9",
  "held|agent-1|drink|coffee|right": "328816772c578df5",
  "held|agent-1|drink|water|down": "92b7d34f54030921",
  "held|agent-1|drink|water|up": "c26996b50d20e796",
  "held|agent-1|drink|water|left": "a294d9a2ca861ee8",
  "held|agent-1|drink|water|right": "349c4a07e04d5422",
  "held|agent-1|read|book|down": "8b2adedab064f9ac",
  "held|agent-1|read|book|up": "07634b84d743d2bd",
  "held|agent-1|read|book|left": "dcd4f2e4545fb52a",
  "held|agent-1|read|book|right": "03124dc2a2b4d3a8",
  "held|agent-1|read|phone|down": "3f8ab77530ddb008",
  "held|agent-1|read|phone|up": "07634b84d743d2bd",
  "held|agent-1|read|phone|left": "87b0c656ce6cdbd4",
  "held|agent-1|read|phone|right": "fff12eaf6048731b",
  "held|agent-1|sit|laptop|down": "b1d827a6d1804d86",
  "held|agent-1|sit|laptop|up": "8beec400161bbc17",
  "held|agent-1|sit|laptop|left": "05cc96308cbf3f5f",
  "held|agent-1|sit|laptop|right": "6da3ef75e2290da7",
  "held|agent-1|stand|box|down": "bc450630f5b03af1",
  "held|agent-1|stand|box|up": "01c43ae13541ba86",
  "held|agent-1|stand|box|left": "159ddb0a0d53690f",
  "held|agent-1|stand|box|right": "0c48a48e028295d0",
  "held|agent-1|stand|papers|down": "00bccde4376bd553",
  "held|agent-1|stand|papers|up": "07634b84d743d2bd",
  "held|agent-1|stand|papers|left": "c6abeca3cf6267f8",
  "held|agent-1|stand|papers|right": "3b29aa15fe29838f",
  "held|agent-1|play|paddle|down": "e769efa075b65183",
  "held|agent-1|play|paddle|up": "b8926004530bf95e",
  "held|agent-1|play|paddle|left": "c415c97947ce8ae5",
  "held|agent-1|play|paddle|right": "46449511b252604b",
  "held|agent-1|game|controller|down": "06a2385653f3b55b",
  "held|agent-1|game|controller|up": "dba181229ddd3327",
  "held|agent-1|game|controller|left": "a7a24d2795ae3b4a",
  "held|agent-1|game|controller|right": "cb1e185e2806246a",
  "held|agent-1|rps|rock|down": "b4a4ee8a20ab9ade",
  "held|agent-1|rps|rock|up": "3fe60173f012d7e0",
  "held|agent-1|rps|rock|left": "207170fb69a561fd",
  "held|agent-1|rps|rock|right": "1ff3291ea173a18a",
  "held|agent-1|rps|paper|down": "a855463a5dc57600",
  "held|agent-1|rps|paper|up": "139cf031e8107820",
  "held|agent-1|rps|paper|left": "74e1e38350f7209c",
  "held|agent-1|rps|paper|right": "0d8822a4ab5c32e3",
  "held|agent-1|rps|scissors|down": "b1e8c28760db681c",
  "held|agent-1|rps|scissors|up": "daf06ea37bd98558",
  "held|agent-1|rps|scissors|left": "87626cd1420df973",
  "held|agent-1|rps|scissors|right": "9b60ef417c1d40bb",
  "held|agent-1|groom|comb|down": "32a44a67d68459ae",
  "held|agent-1|groom|comb|up": "7f3d603f39e7bd63",
  "held|agent-1|groom|comb|left": "5e1bdfdcf5f3d7cb",
  "held|agent-1|groom|comb|right": "92979cd5d1c3ac3c",
  "held|agent-1|groom|lipstick|down": "565e43d5b63dc807",
  "held|agent-1|groom|lipstick|up": "be43f9365783b129",
  "held|agent-1|groom|lipstick|left": "2bfa1fad6ec917c5",
  "held|agent-1|groom|lipstick|right": "f5a10b10561f6644",
  "held|agent-1|wait|popcorn|down": "2a6d81837d360a50",
  "held|agent-1|wait|popcorn|up": "d9ec2792b9ed3dfc",
  "held|agent-1|wait|popcorn|left": "08f605a19ee61b83",
  "held|agent-1|wait|popcorn|right": "211aeadb9deccb97"
};

// G8: frame hash of the base appearance with one field changed (stand, frame 0), key var|field|value|dir
const ORACLE_VARIANTS = {
  "var|hairStyle|short|down": "f34a51bb204a3fa5",
  "var|hairStyle|short|up": "d8dc078f6a8cf103",
  "var|hairStyle|short|left": "7a3363576c3af40c",
  "var|hairStyle|short|right": "fe03d2389e1de8f9",
  "var|hairStyle|buzz|down": "46775518429081d5",
  "var|hairStyle|buzz|up": "5f82296304735b6d",
  "var|hairStyle|buzz|left": "fe48d9c806c8feac",
  "var|hairStyle|buzz|right": "f544294f1c17fac3",
  "var|hairStyle|spiky|down": "47845b2f5c57bf1e",
  "var|hairStyle|spiky|up": "d5fa4cb515fb5deb",
  "var|hairStyle|spiky|left": "8374cbabe8578bb5",
  "var|hairStyle|spiky|right": "b6af83120d7ed9f6",
  "var|hairStyle|side_part|down": "e563218156728607",
  "var|hairStyle|side_part|up": "5d58c38e03dd96f1",
  "var|hairStyle|side_part|left": "fcc716352c8abcf0",
  "var|hairStyle|side_part|right": "4862de7194803a96",
  "var|hairStyle|curly|down": "14dfaae4dd31eed6",
  "var|hairStyle|curly|up": "22a0af58b842a023",
  "var|hairStyle|curly|left": "c56cbc80e8207b7f",
  "var|hairStyle|curly|right": "1a8891934e280ffe",
  "var|hairStyle|afro|down": "b7ab42e57806cdb7",
  "var|hairStyle|afro|up": "cc75672de322abca",
  "var|hairStyle|afro|left": "4dfbc1b2b2b3019e",
  "var|hairStyle|afro|right": "0490bd3fa7ed6078",
  "var|hairStyle|bob|down": "3e65904c3764fd01",
  "var|hairStyle|bob|up": "c637407f85fbc3c5",
  "var|hairStyle|bob|left": "7d375959524109a5",
  "var|hairStyle|bob|right": "c139445383d8cae6",
  "var|hairStyle|long|down": "6b6d9563bb8ab57b",
  "var|hairStyle|long|up": "0901e703b3db3c53",
  "var|hairStyle|long|left": "414581bec57ecf4b",
  "var|hairStyle|long|right": "e433c67e5540042d",
  "var|hairStyle|ponytail|down": "7478ebb8c6d55caa",
  "var|hairStyle|ponytail|up": "46fb1263ac69c0cc",
  "var|hairStyle|ponytail|left": "ce2a2603e7e63df6",
  "var|hairStyle|ponytail|right": "36c36d358e0fa625",
  "var|hairStyle|bun|down": "6cbd5a79f43c0f30",
  "var|hairStyle|bun|up": "cc7e4fe3ab07d7c9",
  "var|hairStyle|bun|left": "2aec51a40e36b4d2",
  "var|hairStyle|bun|right": "5b8ee46207bb1728",
  "var|hairStyle|pigtails|down": "7f64f2bdbaff14d5",
  "var|hairStyle|pigtails|up": "3597a059957755bc",
  "var|hairStyle|pigtails|left": "0b83163fb4fa631c",
  "var|hairStyle|pigtails|right": "2ffd55c8cbb66330",
  "var|hairStyle|mohawk|down": "b3c36688a035028e",
  "var|hairStyle|mohawk|up": "0773aaa32bf6cd00",
  "var|hairStyle|mohawk|left": "aa406c6ac4227eda",
  "var|hairStyle|mohawk|right": "d057c85b642ccf4b",
  "var|hairStyle|bald|down": "c1030d98bb89af44",
  "var|hairStyle|bald|up": "4e9a0454d50b3621",
  "var|hairStyle|bald|left": "b49db8cc3bedf9e7",
  "var|hairStyle|bald|right": "1eea7b6b7e89d388",
  "var|hairStyle|wavy|down": "fef5db76de42dc18",
  "var|hairStyle|wavy|up": "79e11bb7b89beac8",
  "var|hairStyle|wavy|left": "c8dc794d4fed3f6d",
  "var|hairStyle|wavy|right": "b126b0b8986a11a8",
  "var|accessory|none|down": "f34a51bb204a3fa5",
  "var|accessory|none|up": "d8dc078f6a8cf103",
  "var|accessory|none|left": "7a3363576c3af40c",
  "var|accessory|none|right": "fe03d2389e1de8f9",
  "var|accessory|glasses|down": "c32dc67873fee57e",
  "var|accessory|glasses|up": "c2d5873ded7e9359",
  "var|accessory|glasses|left": "c27f0607bb74faad",
  "var|accessory|glasses|right": "ba028325c29a97e3",
  "var|accessory|sunglasses|down": "d4793a605c4e343b",
  "var|accessory|sunglasses|up": "d28810e3929dab89",
  "var|accessory|sunglasses|left": "a01786ec2d71a296",
  "var|accessory|sunglasses|right": "00ecaaa531aae10c",
  "var|accessory|headphones|down": "1c9dfd19716eca12",
  "var|accessory|headphones|up": "8b4e6cffedae77a4",
  "var|accessory|headphones|left": "fc479ee1ddd27219",
  "var|accessory|headphones|right": "ad21591f4a7fe6e6",
  "var|accessory|cap|down": "09b7422a280bbdf4",
  "var|accessory|cap|up": "0014b4fa0d1f1c41",
  "var|accessory|cap|left": "a0bceae621f5dd67",
  "var|accessory|cap|right": "cb554e26426593ba",
  "var|accessory|beanie|down": "90c03fb079fca2f2",
  "var|accessory|beanie|up": "08e445c0593309be",
  "var|accessory|beanie|left": "30f857e2af1d5288",
  "var|accessory|beanie|right": "39f2c9c5bf7baad1",
  "var|accessory|earrings|down": "fe95d7513bff0ab8",
  "var|accessory|earrings|up": "d8dc078f6a8cf103",
  "var|accessory|earrings|left": "1049ddf36ff0cc62",
  "var|accessory|earrings|right": "44f79ae5934cab52",
  "var|accessory|bow|down": "939c76c7937a4166",
  "var|accessory|bow|up": "97ae67fc526a11e0",
  "var|accessory|bow|left": "1df8e03f2d2928a7",
  "var|accessory|bow|right": "fcde4803ffbb2670",
  "var|topStyle|tshirt|down": "f34a51bb204a3fa5",
  "var|topStyle|tshirt|up": "d8dc078f6a8cf103",
  "var|topStyle|tshirt|left": "7a3363576c3af40c",
  "var|topStyle|tshirt|right": "fe03d2389e1de8f9",
  "var|topStyle|hoodie|down": "98bbc54d2d1b8882",
  "var|topStyle|hoodie|up": "cf82a4591e648216",
  "var|topStyle|hoodie|left": "a358a7da94f6b109",
  "var|topStyle|hoodie|right": "c4bdafaaa2e7d15c",
  "var|topStyle|shirt_tie|down": "cfc787ea1611537f",
  "var|topStyle|shirt_tie|up": "cdb0eea923b62ecb",
  "var|topStyle|shirt_tie|left": "ec08ec971f191bd3",
  "var|topStyle|shirt_tie|right": "debc81dd5b573f34",
  "var|topStyle|sweater|down": "e0647dca64f1f329",
  "var|topStyle|sweater|up": "a0c58f3313f2ea19",
  "var|topStyle|sweater|left": "33fe2474c642575b",
  "var|topStyle|sweater|right": "37ecf053b04fd929",
  "var|topStyle|jacket|down": "cd94f628641ef145",
  "var|topStyle|jacket|up": "02465be7cb4f945e",
  "var|topStyle|jacket|left": "8221c4def6be4675",
  "var|topStyle|jacket|right": "1ab77f060a733966",
  "var|topStyle|blouse|down": "bfc129bb919962bc",
  "var|topStyle|blouse|up": "2c93dae857fb9d31",
  "var|topStyle|blouse|left": "737b40c4a42b879b",
  "var|topStyle|blouse|right": "459886899a50d732",
  "var|topStyle|polo|down": "af440f051e0f1908",
  "var|topStyle|polo|up": "c58a718cd5388881",
  "var|topStyle|polo|left": "63474c1e41c2d5bc",
  "var|topStyle|polo|right": "6fea9ed425816682",
  "var|facialHair|none|down": "f34a51bb204a3fa5",
  "var|facialHair|none|up": "d8dc078f6a8cf103",
  "var|facialHair|none|left": "7a3363576c3af40c",
  "var|facialHair|none|right": "fe03d2389e1de8f9",
  "var|facialHair|stubble|down": "2946ed2366a70ece",
  "var|facialHair|stubble|up": "d8dc078f6a8cf103",
  "var|facialHair|stubble|left": "edb5e4bedabdc923",
  "var|facialHair|stubble|right": "f8f7124bfad24bbe",
  "var|facialHair|beard|down": "af6270330817f7ff",
  "var|facialHair|beard|up": "d8dc078f6a8cf103",
  "var|facialHair|beard|left": "91e3390919eb5d8a",
  "var|facialHair|beard|right": "1f7b50c8ee2481ab",
  "var|facialHair|mustache|down": "d8db304d8ecedcca",
  "var|facialHair|mustache|up": "d8dc078f6a8cf103",
  "var|facialHair|mustache|left": "b7769a463c602ffe",
  "var|facialHair|mustache|right": "690d83961e858e3e",
  "var|facialHair|goatee|down": "49c1264f7972c879",
  "var|facialHair|goatee|up": "d8dc078f6a8cf103",
  "var|facialHair|goatee|left": "2aa2d4e0c19e310f",
  "var|facialHair|goatee|right": "ac9fed41497d4cf5",
  "var|bottomStyle|pants|down": "f34a51bb204a3fa5",
  "var|bottomStyle|pants|up": "d8dc078f6a8cf103",
  "var|bottomStyle|pants|left": "7a3363576c3af40c",
  "var|bottomStyle|pants|right": "fe03d2389e1de8f9",
  "var|bottomStyle|shorts|down": "939c5a83cbbe0b4d",
  "var|bottomStyle|shorts|up": "dc238fb4120e8c8b",
  "var|bottomStyle|shorts|left": "226cf63d510259a1",
  "var|bottomStyle|shorts|right": "e68632438f0ebcc7",
  "var|bottomStyle|skirt|down": "fdff5c2b4f976f5a",
  "var|bottomStyle|skirt|up": "80057d62c1d9e802",
  "var|bottomStyle|skirt|left": "81ae67b95a7feed4",
  "var|bottomStyle|skirt|right": "648a0ec4d36c5878",
  "var|lanyard|null|down": "f34a51bb204a3fa5",
  "var|lanyard|null|up": "d8dc078f6a8cf103",
  "var|lanyard|null|left": "7a3363576c3af40c",
  "var|lanyard|null|right": "fe03d2389e1de8f9",
  "var|lanyard|#c0392b|down": "4f1681900dede046",
  "var|lanyard|#c0392b|up": "b5afb4a1457ada14",
  "var|lanyard|#c0392b|left": "f3801342f8410302",
  "var|lanyard|#c0392b|right": "9cf6d9951906b5c3",
  "var|look|f|down": "eff13c38783a9c75",
  "var|look|f|up": "d8dc078f6a8cf103",
  "var|look|f|left": "91d92385b92722ed",
  "var|look|f|right": "edaae4faac38621d",
  "var|look|m|down": "f34a51bb204a3fa5",
  "var|look|m|up": "d8dc078f6a8cf103",
  "var|look|m|left": "7a3363576c3af40c",
  "var|look|m|right": "fe03d2389e1de8f9"
};

// G9: POSE_DURATION, POSE_FRAMES, SEAT_DROP and isSeated truth values of the upstream
const ORACLE_TIMING = {
  "duration": {
    "stand": 650,
    "walk": 140,
    "run": 95,
    "sit": 800,
    "type": 120,
    "sleep": 1000,
    "drink": 700,
    "use": 380,
    "raise_hand": 320,
    "talk": 280,
    "stretch": 800,
    "read": 1100,
    "play": 200,
    "wait": 480,
    "cheer": 260,
    "laugh": 190,
    "game": 150,
    "rps": 300,
    "groom": 420,
    "sulk": 1300
  },
  "frames": {
    "stand": 2,
    "walk": 4,
    "run": 4,
    "sit": 2,
    "type": 4,
    "sleep": 2,
    "drink": 2,
    "use": 2,
    "raise_hand": 2,
    "talk": 2,
    "stretch": 2,
    "read": 2,
    "play": 2,
    "wait": 2,
    "cheer": 2,
    "laugh": 2,
    "game": 2,
    "rps": 2,
    "groom": 2,
    "sulk": 2
  },
  "seatDrop": 4,
  "seatedDefault": {
    "stand": false,
    "walk": false,
    "run": false,
    "sit": true,
    "type": true,
    "sleep": true,
    "drink": false,
    "use": false,
    "raise_hand": false,
    "talk": false,
    "stretch": false,
    "read": false,
    "play": false,
    "wait": true,
    "cheer": false,
    "laugh": false,
    "game": false,
    "rps": false,
    "groom": false,
    "sulk": false
  },
  "seatedTrue": {
    "stand": true,
    "walk": false,
    "run": false,
    "sit": true,
    "type": true,
    "sleep": true,
    "drink": true,
    "use": true,
    "raise_hand": true,
    "talk": true,
    "stretch": false,
    "read": true,
    "play": false,
    "wait": true,
    "cheer": true,
    "laugh": true,
    "game": true,
    "rps": true,
    "groom": false,
    "sulk": true
  },
  "poseOrder": [
    "stand",
    "walk",
    "run",
    "sit",
    "type",
    "sleep",
    "drink",
    "use",
    "raise_hand",
    "talk",
    "stretch",
    "read",
    "play",
    "wait",
    "cheer",
    "laugh",
    "game",
    "rps",
    "groom",
    "sulk"
  ]
};

// ---------------------------------------------------------------- Task 1: hash, parts, appearance

// Independent FNV-1a over the UTF-16 code units with BigInt.
function fnv1a(text) {
  let h = 0x811c9dc5n;
  for (let i = 0; i < text.length; i++) h = ((h ^ BigInt(text.charCodeAt(i))) * 0x01000193n) & 0xffffffffn;
  return Number(h);
}

test("OFFC-07 hash: hash32 matches FNV-1a vectors", () => {
  assert.equal(hash32(""), 0x811c9dc5);
  assert.equal(hash32("a"), 0xe40c292c);
  assert.equal(hash32("foobar"), 0xbf9cf968);
  const strings = [
    "agent-0", "agent-299", "abc", "ABC", "Z", "0", " ", "a b", "caf\u00e9", "na\u00efve", "\u00fc\u00f1\u00ee", "\ud800", "\udfff",
    "\ud83d\ude00", "x\ud83d\ude80y", "a".repeat(64), "\u0000", "\u202etxt", "e\u0301", "line\nbreak",
  ];
  assert.equal(strings.length, 20);
  for (const s of strings) {
    const h = hash32(s);
    assert.equal(h, fnv1a(s), JSON.stringify(s));
    assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32, JSON.stringify(s));
  }
});

test("OFFC-07 hash: mulberry32 matches pinned reference values", () => {
  const a = mulberry32(0);
  assert.equal(a(), 0.26642920868471265);
  assert.equal(a(), 0.0003297457005828619);
  assert.equal(mulberry32(123456789)(), 0.2577907438389957);
  const g = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = g();
    assert.ok(v >= 0 && v < 1, `draw ${i}`);
  }
  const x = mulberry32(777);
  const y = mulberry32(777);
  for (let i = 0; i < 50; i++) assert.equal(x(), y());
  const zero = mulberry32(0);
  const wrapped = mulberry32(2 ** 32);
  for (let i = 0; i < 10; i++) assert.equal(zero(), wrapped());
});

test("OFFC-07 parts: style lists equal the upstream lists", () => {
  assert.deepEqual(
    [...partsModule.HAIR_STYLES],
    ["short", "buzz", "spiky", "side_part", "curly", "afro", "bob", "long", "ponytail", "bun", "pigtails", "mohawk", "bald", "wavy"],
  );
  assert.deepEqual([...partsModule.TOP_STYLES], ["tshirt", "hoodie", "shirt_tie", "sweater", "jacket", "blouse", "polo"]);
  assert.deepEqual([...partsModule.ACCESSORIES], ["none", "glasses", "sunglasses", "headphones", "cap", "beanie", "earrings", "bow"]);
  assert.deepEqual([...partsModule.FACIAL_HAIR], ["none", "stubble", "beard", "mustache", "goatee"]);
  assert.deepEqual([...partsModule.BOTTOM_STYLES], ["pants", "shorts", "skirt"]);
});

test("OFFC-11 appearance: same id, same look; different ids differ", () => {
  const keys = new Set();
  for (let i = 0; i < 12; i++) {
    const id = `agent-${i}`;
    const first = appearanceOf(id);
    assert.deepEqual(first, appearanceOf(id));
    keys.add(appearanceKey(first));
  }
  assert.equal(keys.size, 12);
  const a = appearanceOf("agent-0");
  const fields = [a.skin, a.hair, a.hairStyle, a.eyes, a.top, a.topAccent, a.topStyle, a.bottom, a.shoes, a.accessory, a.accessoryColor, a.lanyard ?? "-", a.look, a.facialHair ?? "-", a.bottomStyle ?? "-"];
  assert.equal(appearanceKey(a), fields.join("|"));
  assert.equal(appearanceKey(a).split("|").length, 15);
  const bare = { ...a, lanyard: null, facialHair: undefined, bottomStyle: undefined };
  assert.deepEqual(appearanceKey(bare).split("|").slice(-4), ["-", a.look, "-", "-"]);
});

test("OFFC-07 appearance: field domains and combination rules", (t) => {
  const counts = { hairStyle: {}, accessory: {}, topStyle: {} };
  const tall = ["afro", "bun", "mohawk", "pigtails"];
  for (let i = 0; i < 300; i++) {
    const a = appearanceOf(`agent-${i}`);
    const why = `agent-${i}`;
    assert.ok(SKINS.includes(a.skin), why);
    assert.ok(HAIR_FUN.includes(a.hair) || HAIR_NATURAL.some(([c]) => c === a.hair), why);
    assert.ok(EYES.includes(a.eyes), why);
    assert.ok(partsModule.HAIR_STYLES.includes(a.hairStyle), why);
    assert.ok(partsModule.TOP_STYLES.includes(a.topStyle), why);
    assert.ok(partsModule.ACCESSORIES.includes(a.accessory), why);
    assert.ok(partsModule.FACIAL_HAIR.includes(a.facialHair), why);
    assert.ok(partsModule.BOTTOM_STYLES.includes(a.bottomStyle), why);
    assert.ok(ACC_COLORS[a.accessory].includes(a.accessoryColor), why);
    assert.ok(SHOES.some(([c]) => c === a.shoes), why);
    assert.ok(BOTTOMS.some(([c]) => c === a.bottom), why);
    assert.equal(a.lanyard, null, why);
    assert.ok(a.look === "f" || a.look === "m", why);
    if (a.look === "f") assert.equal(a.facialHair, "none", why);
    if (a.accessory === "cap" || a.accessory === "beanie") assert.ok(!tall.includes(a.hairStyle), why);
    if (a.accessory === "bow") assert.ok(a.hairStyle !== "bald" && a.hairStyle !== "buzz", why);
    if (a.look === "f") assert.notEqual(a.hairStyle, "bald", why);
    for (const field of Object.keys(counts)) counts[field][a[field]] = (counts[field][a[field]] ?? 0) + 1;
  }
  t.diagnostic(`distribution over 300 seeds: ${JSON.stringify(counts)}`);
});

test("OFFC-07 appearance: options sub and look", () => {
  const lanyards = new Set();
  for (let i = 0; i < 60; i++) {
    const seed = hash32(`agent-${i}`);
    const plain = appearanceFromSeed(seed);
    const sub = appearanceFromSeed(seed, { sub: true });
    assert.equal(plain.lanyard, null);
    assert.equal(typeof sub.lanyard, "string");
    lanyards.add(sub.lanyard);
    assert.deepEqual({ ...sub, lanyard: null }, plain);
    assert.equal(appearanceFromSeed(seed, { look: "f" }).look, "f");
    assert.equal(appearanceFromSeed(seed, { look: "m" }).look, "m");
  }
  assert.ok([...lanyards].every((c) => ["#f2b33d", "#e2604f", "#4a86d8", "#4bab72", "#8d66cf", "#36b0b0"].includes(c)));
  assert.ok(lanyards.size > 1);
  const seed = hash32("agent-5");
  assert.deepEqual(appearanceFromSeed(seed, { parts: { hairStyle: "bald", skin: "#000000" } }), appearanceFromSeed(seed));
});

test("OFFC-07 appearance: matches the upstream oracle", () => {
  const expectedKeys = [];
  for (let i = 0; i < 60; i++) expectedKeys.push(`agent-${i}`);
  expectedKeys.push("ALL", "agent-7|sub", "agent-7|look-f", "agent-7|look-m");
  assert.deepEqual(Object.keys(ORACLE_APPEARANCE).sort(), expectedKeys.sort());
  for (let i = 0; i < 60; i++) assert.equal(h16(canon(appearanceOf(`agent-${i}`))), ORACLE_APPEARANCE[`agent-${i}`], `agent-${i}`);
  const all = [];
  for (let i = 0; i < 300; i++) all.push(canon(appearanceOf(`agent-${i}`)));
  assert.equal(h16(all.join("\n")), ORACLE_APPEARANCE.ALL);
  const seven = hash32("agent-7");
  assert.equal(h16(canon(appearanceFromSeed(seven, { sub: true }))), ORACLE_APPEARANCE["agent-7|sub"]);
  assert.equal(h16(canon(appearanceFromSeed(seven, { look: "f" }))), ORACLE_APPEARANCE["agent-7|look-f"]);
  assert.equal(h16(canon(appearanceFromSeed(seven, { look: "m" }))), ORACLE_APPEARANCE["agent-7|look-m"]);
});

// ---------------------------------------------------------------- hygiene fixtures and files

const GOOD = (upstream) => `${HEADER(upstream)}export function f(a: number): number {\n  return a + 1; // adds one\n}\n`;

test("OFFC-07 hygiene: task 1 files", () => {
  const rel = "hash.ts";
  assert.deepEqual(hygieneProblems(rel, GOOD("shared/hash.ts")), []);
  const bad = {
    "missing header": "export const a = 1;\n",
    "another commit": `// Ported from marmottajr/habblaud shared/hash.ts at ${"0".repeat(40)} (MIT; notice added by 07-05).\nexport const a = 1;\n`,
    "parameter property": `${HEADER("shared/hash.ts")}class A {\n  constructor(\n    private x: number,\n  ) {}\n}\n`,
    enum: `${HEADER("shared/hash.ts")}enum E {\n  A,\n}\n`,
    namespace: `${HEADER("shared/hash.ts")}namespace N {\n  export const a = 1;\n}\n`,
    "import without .ts": `${HEADER("shared/hash.ts")}import { x } from './other';\n`,
    "dom name": `${HEADER("shared/hash.ts")}export const a = document.title;\n`,
    "random name": `${HEADER("shared/hash.ts")}export const a = Math.random();\n`,
    "clock name": `${HEADER("shared/hash.ts")}export const a = Date.now();\n`,
    "node specifier": `${HEADER("shared/hash.ts")}import fs from 'node:fs';\n`,
    "accented comment": `${HEADER("shared/hash.ts")}// caf\u00e9\nexport const a = 1;\n`,
    "portuguese comment": `${HEADER("shared/hash.ts")}// uma linha para teste\nexport const a = 1;\n`,
    "part marker": `${HEADER("shared/hash.ts")}export const a = 1;\n// office-part-continues\n`,
  };
  for (const [name, text] of Object.entries(bad)) assert.ok(hygieneProblems(rel, text).length > 0, `fixture must report a problem: ${name}`);
  // The word process in an English comment or a string is not a code name.
  assert.deepEqual(hygieneProblems(rel, `${HEADER("shared/hash.ts")}// the process of drawing\nexport const a = "process";\n`), []);
  for (const file of ["hash.ts", "character/parts.ts", "character/types.ts", "character/appearance.ts"]) {
    const text = sourceOf(file);
    assert.deepEqual(hygieneProblems(file, text), [], file);
    assert.ok(text.split("\n")[0].includes(UPSTREAM_PATH[file]), `${file}: header names ${UPSTREAM_PATH[file]}`);
  }
  assert.deepEqual(Object.keys(typesModule), []);
  assert.deepEqual(Object.keys(partsModule).sort(), ["ACCESSORIES", "BOTTOM_STYLES", "FACIAL_HAIR", "HAIR_STYLES", "TOP_STYLES"]);
});

test("OFFC-07 excluded: editor, World and canvas names are absent", () => {
  const names = [
    "editorOptions", "editorConflict", "fitToOptions", "flattenAppearance", "parseAppearanceParts", "parseCharacterName", "nameKey", "partsKey",
    "PART_KEYS",
  ];
  for (const file of ["hash.ts", "character/parts.ts", "character/types.ts", "character/appearance.ts"]) {
    const text = sourceOf(file);
    for (const name of names) assert.ok(!text.includes(name), `${file} mentions ${name}`);
    assert.doesNotMatch(blankNonCode(text), /\btr\s*\(/, `${file}: translation helper`);
    assert.doesNotMatch(text, /shared\/i18n/, file);
  }
});

// ---------------------------------------------------------------- Task 2: poses and the character renderer

const POSE_LIST = [...POSE_NAMES];
const DIR_LIST = [...DIRS];
const BASE_APPEARANCE = {
  skin: "#eab894", hair: "#4a3426", hairStyle: "short", eyes: "#2b2236", top: "#3d6fb5", topAccent: "#f4f4f0", topStyle: "tshirt",
  bottom: "#2f3b55", shoes: "#262a33", accessory: "none", accessoryColor: "#222222", lanyard: null, look: "m", facialHair: "none",
  bottomStyle: "pants",
};
const VARIANT_FIELDS = {
  hairStyle: [...partsModule.HAIR_STYLES],
  accessory: [...partsModule.ACCESSORIES],
  topStyle: [...partsModule.TOP_STYLES],
  facialHair: [...partsModule.FACIAL_HAIR],
  bottomStyle: [...partsModule.BOTTOM_STYLES],
  lanyard: [null, "#c0392b"],
  look: ["f", "m"],
};
const SEATED_POSES = ["raise_hand", "read", "sulk", "use", "talk", "cheer", "laugh", "game", "rps", "drink", "stand", "wait"];
const HELD_PAIRS = [
  ["drink", "coffee"], ["drink", "water"], ["read", "book"], ["read", "phone"], ["sit", "laptop"], ["stand", "box"], ["stand", "papers"],
  ["play", "paddle"], ["game", "controller"], ["rps", "rock"], ["rps", "paper"], ["rps", "scissors"], ["groom", "comb"], ["groom", "lipstick"],
  ["wait", "popcorn"],
];
const COSTUMES = ["santa", "witch", "pumpkin", "vampire"];

test("OFFC-09 poses: POSE_FRAMES has the 20 upstream poses and 46 frames", () => {
  const names = ["stand", "walk", "run", "sit", "type", "sleep", "drink", "use", "raise_hand", "talk", "stretch", "read", "play", "wait", "cheer", "laugh", "game", "rps", "groom", "sulk"];
  assert.deepEqual(Object.keys(POSE_FRAMES), names);
  assert.deepEqual(Object.values(POSE_FRAMES), [2, 4, 4, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(Object.values(POSE_FRAMES).reduce((a, b) => a + b, 0), 46);
  assert.deepEqual({ ...POSE_FRAMES }, ORACLE_TIMING.frames);
  assert.deepEqual(Object.keys(POSE_FRAMES), ORACLE_TIMING.poseOrder);
  assert.deepEqual([CHAR_W, CHAR_H, CHAR_AX, CHAR_AY], [24, 34, 12, 31]);
});

test("OFFC-07 render: poses match the upstream oracle", () => {
  for (const [key, expected] of Object.entries(ORACLE_POSES)) {
    const [, seed, pose, dir] = key.split("|");
    assert.equal(groupHash(appearanceOf(seed), dir, pose), expected, key);
  }
});

test("OFFC-07 render: seated poses match the upstream oracle", () => {
  for (const [key, expected] of Object.entries(ORACLE_SEATED)) {
    const [, seed, pose, dir] = key.split("|");
    assert.equal(groupHash(appearanceOf(seed), dir, pose, { seated: true }), expected, key);
  }
});

test("OFFC-07 render: costumes match the upstream oracle", () => {
  for (const [key, expected] of Object.entries(ORACLE_COSTUMES)) {
    const [, seed, costume, dir, pose, frame] = key.split("|");
    const sprite = renderCharacter({ appearance: appearanceOf(seed), dir, pose, frame: Number(frame), costume });
    assert.equal(frameHash(sprite), expected, key);
  }
});

test("OFFC-07 render: held items match the upstream oracle", () => {
  for (const [key, expected] of Object.entries(ORACLE_HELD)) {
    const [, seed, pose, held, dir] = key.split("|");
    assert.equal(groupHash(appearanceOf(seed), dir, pose, { held }), expected, key);
  }
});

test("OFFC-07 render: appearance variants match the upstream oracle", () => {
  for (const [key, expected] of Object.entries(ORACLE_VARIANTS)) {
    const [, field, text, dir] = key.split("|");
    const value = text === "null" ? null : text;
    const sprite = renderCharacter({ appearance: { ...BASE_APPEARANCE, [field]: value }, dir, pose: "stand", frame: 0 });
    assert.equal(frameHash(sprite), expected, key);
  }
});

test("OFFC-07 render: timing and seating tables match the upstream oracle", () => {
  assert.deepEqual({ ...POSE_DURATION }, ORACLE_TIMING.duration);
  assert.equal(SEAT_DROP, ORACLE_TIMING.seatDrop);
  for (const pose of POSE_LIST) {
    assert.equal(isSeated(pose), ORACLE_TIMING.seatedDefault[pose], `isSeated(${pose})`);
    assert.equal(isSeated(pose, true), ORACLE_TIMING.seatedTrue[pose], `isSeated(${pose}, true)`);
  }
});

test("OFFC-07 render: frame size, anchor, mirror and determinism", () => {
  const appearance = appearanceOf("agent-0");
  for (const pose of POSE_LIST) {
    for (const dir of DIR_LIST) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const why = `${pose}/${dir}/${frame}`;
        const sprite = renderCharacter({ appearance, dir, pose, frame });
        assert.deepEqual([sprite.buf.w, sprite.buf.h, sprite.ax, sprite.ay], [CHAR_W, CHAR_H, CHAR_AX, CHAR_AY], why);
        assert.ok(sprite.buf.countOpaque() > 0, why);
        if (dir === "right") {
          const left = renderCharacter({ appearance, dir: "left", pose, frame });
          assert.ok(sameBytes(sprite.buf.data, left.buf.flipped().data), `${why}: mirror`);
          assert.equal(sprite.ax, CHAR_W - left.ax, why);
        }
      }
    }
  }
  const once = renderCharacter({ appearance, dir: "down", pose: "type", frame: 1 });
  const twice = renderCharacter({ appearance, dir: "down", pose: "type", frame: 1 });
  const copy = renderCharacter({ appearance: { ...appearance }, dir: "down", pose: "type", frame: 1 });
  assert.ok(sameBytes(once.buf.data, twice.buf.data));
  assert.ok(sameBytes(once.buf.data, copy.buf.data));
  const source = sourceOf("character/render.ts");
  assert.doesNotMatch(source, /\b(?:const|let|var|function)\s+(?:CHAR_W|CHAR_H|CHAR_AX|CHAR_AY|POSE_FRAMES)\b/);
  assert.doesNotMatch(source, /\bexport\s+(?:const|let|var|function)\s+(?:CHAR_W|CHAR_H|CHAR_AX|CHAR_AY|POSE_FRAMES)\b/);
  assert.match(source, /shared\/art-types\.ts/);
});

test("OFFC-07 render: oracle tables are complete", () => {
  const poses = new Set();
  const seated = new Set();
  const costumes = new Set();
  const held = new Set();
  const variants = new Set();
  for (const seed of ["agent-0", "agent-1", "agent-2"]) for (const pose of POSE_LIST) for (const dir of DIR_LIST) poses.add(`pose|${seed}|${pose}|${dir}`);
  for (const pose of SEATED_POSES) for (const dir of DIR_LIST) seated.add(`seat|agent-0|${pose}|${dir}`);
  for (const costume of COSTUMES) for (const dir of DIR_LIST) for (const [pose, frame] of [["stand", 0], ["walk", 1]]) costumes.add(`cost|agent-0|${costume}|${dir}|${pose}|${frame}`);
  for (const [pose, item] of HELD_PAIRS) for (const dir of DIR_LIST) held.add(`held|agent-1|${pose}|${item}|${dir}`);
  for (const [field, values] of Object.entries(VARIANT_FIELDS)) for (const value of values) for (const dir of DIR_LIST) variants.add(`var|${field}|${value}|${dir}`);
  const tables = [
    [ORACLE_POSES, poses, 240],
    [ORACLE_SEATED, seated, 48],
    [ORACLE_COSTUMES, costumes, 32],
    [ORACLE_HELD, held, 60],
    [ORACLE_VARIANTS, variants, 164],
  ];
  for (const [table, expected, count] of tables) {
    assert.equal(Object.keys(table).length, count);
    assert.deepEqual(new Set(Object.keys(table)), expected);
    for (const value of Object.values(table)) assert.match(value, /^[0-9a-f]{16}$/);
  }
  assert.equal(Object.keys(ORACLE_TIMING.duration).length, 20);
});

test("OFFC-07 hygiene: task 2 files", () => {
  for (const file of ["character/hair.ts", "character/render.ts"]) {
    const text = sourceOf(file);
    assert.deepEqual(hygieneProblems(file, text), [], file);
    assert.ok(text.split("\n")[0].includes(`marmottajr/habblaud ${UPSTREAM_PATH[file]} at ${COMMIT}`), `${file}: header`);
  }
  assert.deepEqual(Object.keys(hairModule).sort(), ["HAIR", "HEAD_BASE", "TEXTURED"]);
});

// ---------------------------------------------------------------- Task 3: the sheet, icons and the folder gates

const DESK_POSES = ["type", "read", "use", "wait", "raise_hand", "sulk", "sleep"];
const SHEET_SETS = [["stand"], ["walk", "stand"], DESK_POSES, POSE_LIST];

// The direct frame a sheet cell must hold (the sheet draws the desk poses of SHEET_SEATED_POSES seated).
function directFrame(appearance, pose, dir, frame, seated) {
  return renderCharacter({ appearance, dir, pose, frame, seated }).buf.data;
}

test("OFFC-09 sheet: size, frame envelope and transparent filler", () => {
  const stand = renderCharacterSheet({ seed: "agent-1", poses: ["stand"] });
  assert.deepEqual([stand.buf.w, stand.buf.h], [48, 136]);
  assert.deepEqual(stand.frame, { w: 24, h: 34, cols: 2, rows: 4 });
  const two = renderCharacterSheet({ seed: "agent-1", poses: ["walk", "stand"] });
  assert.deepEqual([two.buf.w, two.buf.h], [96, 272]);
  assert.deepEqual(two.frame, { w: 24, h: 34, cols: 4, rows: 8 });
  const all = renderCharacterSheet({ seed: "agent-1", poses: POSE_LIST });
  assert.deepEqual([all.buf.w, all.buf.h], [96, 2720]);
  assert.deepEqual(all.frame, { w: 24, h: 34, cols: 4, rows: 80 });
  for (const set of SHEET_SETS) {
    const { cols, rows } = sheetSize(set);
    const sheet = renderCharacterSheet({ seed: "agent-1", poses: set });
    assert.deepEqual([sheet.buf.w, sheet.buf.h], [cols * CHAR_W, rows * CHAR_H]);
  }
  // Order and duplicates of the poses do not change the bytes.
  const canonical = renderCharacterSheet({ seed: "agent-1", poses: ["walk", "stand"] });
  for (const poses of [["stand", "walk"], ["walk", "stand", "walk"], ["stand", "stand", "walk"]]) {
    assert.ok(sameBytes(renderCharacterSheet({ seed: "agent-1", poses }).buf.data, canonical.buf.data), poses.join());
  }
  // Stand has 2 frames: its rows have two unused columns in the 4-column sheet.
  for (let row = 0; row < 4; row++) {
    for (const col of [2, 3]) assert.ok(isBlank(cellBytes(two, col, row)), `blank cell ${col},${row}`);
  }
});

test("OFFC-09 sheet: every cell equals the direct renderCharacter frame", () => {
  const appearance = appearanceOf("agent-3");
  for (const set of SHEET_SETS) {
    const sheet = renderCharacterSheet({ seed: "agent-3", poses: set });
    const named = new Set();
    for (const pose of set) {
      for (const dir of DIR_LIST) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
          const { col, row } = sheetCell(set, pose, dir, frame);
          named.add(`${col},${row}`);
          const expected = directFrame(appearance, pose, dir, frame, SHEET_SEATED_POSES.has(pose));
          assert.ok(sameBytes(cellBytes(sheet, col, row), expected), `${set.length} poses: ${pose}/${dir}/${frame}`);
        }
      }
    }
    const { cols, rows } = sheetSize(set);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!named.has(`${col},${row}`)) assert.ok(isBlank(cellBytes(sheet, col, row)), `unnamed cell ${col},${row} is transparent`);
      }
    }
  }
});

test("OFFC-11 sheet: same id same bytes, different ids differ, look from the id only", () => {
  const a = renderCharacterSheet({ seed: "agent-0", poses: ["stand"] });
  assert.ok(sameBytes(a.buf.data, renderCharacterSheet({ seed: "agent-0", poses: ["stand"] }).buf.data));
  const hashes = new Set();
  for (let i = 0; i < 12; i++) hashes.add(h16(bytesOf(renderCharacterSheet({ seed: `agent-${i}`, poses: ["stand"] }).buf.data)));
  assert.equal(hashes.size, 12);
  const extras = [
    { kind: "character-sheet", scale: 2, tint: 0 },
    { kind: "character-sheet", scale: 4, tint: 4 },
    { look: "f", sub: true, parts: { hairStyle: "bald", skin: "#000000" } },
    { held: "book", costume: "santa", seated: true },
  ];
  for (const extra of extras) {
    const sheet = renderCharacterSheet({ seed: "agent-0", poses: ["stand"], ...extra });
    assert.ok(sameBytes(sheet.buf.data, a.buf.data), JSON.stringify(extra));
  }
  // The look is appearanceFromSeed(hash32(seed)) with no option.
  const appearance = appearanceOf("agent-0");
  for (const dir of DIR_LIST) {
    const { col, row } = sheetCell(["stand"], "stand", dir, 0);
    assert.ok(sameBytes(cellBytes(a, col, row), directFrame(appearance, "stand", dir, 0, false)));
  }
});

test("OFFC-11 sheet: desk poses are drawn seated, the others standing", () => {
  assert.deepEqual([...SHEET_SEATED_POSES].sort(), ["raise_hand", "read", "sulk"]);
  const appearance = appearanceOf("agent-4");
  const sheet = renderCharacterSheet({ seed: "agent-4", poses: DESK_POSES.concat(["stand", "walk", "drink", "sit"]) });
  const set = POSE_LIST.filter((p) => DESK_POSES.concat(["stand", "walk", "drink", "sit"]).includes(p));
  for (const pose of ["raise_hand", "read", "sulk"]) {
    let differs = false;
    for (const dir of DIR_LIST) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const { col, row } = sheetCell(set, pose, dir, frame);
        assert.ok(sameBytes(cellBytes(sheet, col, row), directFrame(appearance, pose, dir, frame, true)), `${pose}/${dir}/${frame} seated`);
        if (!sameBytes(cellBytes(sheet, col, row), directFrame(appearance, pose, dir, frame, false))) differs = true;
      }
    }
    assert.ok(differs, `${pose}: seated differs from standing`);
  }
  for (const pose of ["use", "stand", "walk", "drink", "type", "sit", "sleep", "wait"]) {
    for (const dir of DIR_LIST) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const { col, row } = sheetCell(set, pose, dir, frame);
        const plain = renderCharacter({ appearance, dir, pose, frame }).buf.data;
        assert.ok(sameBytes(cellBytes(sheet, col, row), plain), `${pose}/${dir}/${frame} default`);
      }
    }
  }
});

test("OFFC-09 sheet: errors and edge seeds", () => {
  assert.throws(() => renderCharacterSheet({ seed: "a", poses: [] }), RangeError);
  assert.throws(() => renderCharacterSheet({ seed: "a", poses: ["nope"] }), RangeError);
  for (const seed of [7, undefined, null, {}, ["a"]]) assert.throws(() => renderCharacterSheet({ seed, poses: ["stand"] }), TypeError, String(seed));
  const seeds = ["", "a".repeat(64), "nul\u0000byte", "rtl\u202eoverride", "combining e\u0301", "emoji \ud83d\ude00", "lone \ud800 surrogate"];
  for (const seed of seeds) {
    const first = renderCharacterSheet({ seed, poses: ["stand"] });
    const second = renderCharacterSheet({ seed, poses: ["stand"] });
    assert.ok(sameBytes(first.buf.data, second.buf.data), JSON.stringify(seed));
    const appearance = appearanceOf(seed);
    for (const dir of DIR_LIST) {
      const { col, row } = sheetCell(["stand"], "stand", dir, 0);
      assert.ok(sameBytes(cellBytes(first, col, row), directFrame(appearance, "stand", dir, 0, false)), JSON.stringify(seed));
    }
  }
  // A single pose and all 20 poses both render.
  assert.equal(renderCharacterSheet({ seed: "agent-9", poses: ["sulk"] }).frame.rows, 4);
  assert.equal(renderCharacterSheet({ seed: "agent-9", poses: POSE_LIST }).frame.rows, 80);
});

test("OFFC-08 sheet: PNG fit and pose budget per zoom", (t) => {
  assert.ok(ZOOM_LEVELS.every((z) => ZOOM_CANDIDATES.includes(z)));
  const sizes = {};
  for (const zoom of ZOOM_CANDIDATES) {
    for (const [name, poses] of [["desk", DESK_POSES], ["free", ["stand", "walk", "drink"]]]) {
      const sheet = renderCharacterSheet({ seed: "agent-2", poses });
      const png = encodePng(sheet.buf.data, sheet.buf.w, sheet.buf.h, zoom);
      assert.ok(png.length < SPRITE_PNG_MAX_BYTES, `${name} at zoom ${zoom}: ${png.length} bytes`);
      sizes[`${name}@${zoom}`] = png.length;
    }
    const budget = Math.floor(PNG_MAX_DIMENSION / (4 * CHAR_H * zoom));
    assert.equal(budget, { 4: 7, 3: 10, 2: 15 }[zoom]);
    const fits = renderCharacterSheet({ seed: "agent-2", poses: POSE_LIST.slice(0, budget) });
    assert.ok(encodePng(fits.buf.data, fits.buf.w, fits.buf.h, zoom).length < SPRITE_PNG_MAX_BYTES, `${budget} poses at zoom ${zoom}`);
    const over = renderCharacterSheet({ seed: "agent-2", poses: POSE_LIST.slice(0, budget + 1) });
    assert.throws(() => encodePng(over.buf.data, over.buf.w, over.buf.h, zoom), RangeError, `${budget + 1} poses at zoom ${zoom}`);
  }
  t.diagnostic(`PNG bytes: ${JSON.stringify(sizes)}`);
});

test("OFFC-07 icons: all 24 icons match the upstream oracle", () => {
  assert.deepEqual([...ICON_NAMES], ORACLE_ICONS.names);
  assert.equal(ICON_NAMES.length, 24);
  assert.deepEqual(Object.keys(ORACLE_ICONS.hashes), ORACLE_ICONS.names);
  for (const name of ICON_NAMES) assert.equal(frameHash(renderIcon(name)), ORACLE_ICONS.hashes[name], name);
});

test("OFFC-07 icons: names and failure", () => {
  assert.deepEqual(Object.keys(iconTemplates()).sort(), [...ICON_NAMES].sort());
  for (const name of ["", "nope", "ALERT", "constructor", "__proto__"]) {
    assert.throws(() => renderIcon(name), undefined, name);
  }
  for (const name of ICON_NAMES) assert.ok(sameBytes(renderIcon(name).buf.data, renderIcon(name).buf.data), name);
  const web = renderIcon("cobweb").buf.data;
  let soft = 0;
  for (let i = 3; i < web.length; i += 4) if (web[i] !== 0 && web[i] !== 255) soft++;
  assert.ok(soft > 0, "the soft outline of the cobweb has partial alpha");
});

test("OFFC-07 hygiene: task 3 files", () => {
  const sheet = sourceOf("character/sheet.ts");
  const icons = sourceOf("icons.ts");
  assert.deepEqual(hygieneProblems("character/sheet.ts", sheet), []);
  assert.deepEqual(hygieneProblems("icons.ts", icons), []);
  assert.match(sheet, /appearanceFromSeed\(hash32\(/);
  assert.match(sheet, /renderCharacter\(/);
  assert.match(sheet, /sheetCell\(/);
  assert.match(sheet, /SpriteRenderer/);
  assert.doesNotMatch(sheet, /\bawait\b|\basync\b|\bPromise\b/);
});

test("OFFC-20 headers: every file names its upstream path and the pinned commit", () => {
  const files = Object.keys(UPSTREAM_PATH);
  assert.equal(files.length, 8);
  for (const file of files) {
    const text = sourceOf(file);
    const first = text.split("\n").slice(0, 5).filter((l) => l.startsWith("//")).join("\n");
    assert.ok(first.includes(`marmottajr/habblaud`), `${file}: habblaud`);
    assert.ok(first.includes(UPSTREAM_PATH[file]), `${file}: ${UPSTREAM_PATH[file]}`);
    assert.ok(first.includes(COMMIT), `${file}: commit`);
    assert.deepEqual([...new Set(text.match(/\b[0-9a-f]{40}\b/g) ?? [])], [COMMIT], `${file}: only the pinned commit`);
    assert.ok(!text.split(COMMIT).join("").includes(COMMIT.slice(0, 7)), `${file}: commit in another form`);
  }
});

test("OFFC-07 excluded: the character folder holds exactly the expected files", () => {
  assert.deepEqual(fs.readdirSync(path.join(ART, "character")).sort(), ["appearance.ts", "hair.ts", "parts.ts", "render.ts", "sheet.ts", "types.ts"]);
  assert.ok(fs.existsSync(path.join(ART, "hash.ts")));
  assert.ok(fs.existsSync(path.join(ART, "icons.ts")));
  const owned = [...fs.readdirSync(path.join(ART, "character")), "hash.ts", "icons.ts", path.basename(new URL(import.meta.url).pathname)];
  for (const name of owned) {
    assert.doesNotMatch(name, /editor|dynamic|world|permission|message|terminal|docker|codex|dictation|deliver|timelapse|index/i, name);
  }
  // The editor, World and canvas halves of habblaud are not in any ported file.
  const banned = ["editorOptions", "editorConflict", "fitToOptions", "flattenAppearance", "parseAppearanceParts", "parseCharacterName", "nameKey", "partsKey"];
  for (const file of Object.keys(UPSTREAM_PATH)) {
    const text = sourceOf(file);
    for (const name of banned) assert.ok(!text.includes(name), `${file} mentions ${name}`);
  }
});

test("OFFC-22 coverage: the test imports every module of the plan", () => {
  for (const module of ["hash", "parts", "types", "appearance", "hair", "render", "sheet", "icons"]) {
    const rel = module === "hash" || module === "icons" ? `server/art/${module}.ts` : `server/art/character/${module}.ts`;
    assert.ok(SELF_SOURCE.includes(`plugins/office/${rel}`), `${rel} is imported by this test`);
  }
});
