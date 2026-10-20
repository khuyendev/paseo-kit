// The kit's YAML subset for .planning frontmatter (GSDC-05): block maps and sequences, flow collections
// (also over several lines), quoted and plain scalars, | and > blocks, comments outside quotes.
// Errors are returned as {error, line} (1-based), never thrown and never a silently dropped field.

class YamlError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

const QUOTE_OPENERS = " \t[{,:";

// Cut a trailing comment; a quote opens only at a token start, so an apostrophe inside plain text is text.
export function stripComment(s) {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((ch === '"' || ch === "'") && (i === 0 || QUOTE_OPENERS.includes(s[i - 1]))) {
      i = skipQuoted(s, i);
      if (i < 0) return s;
      continue;
    }
    if (ch === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

// Index of the closing quote of the quoted token starting at i, or -1 when it does not close.
function skipQuoted(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (q === '"' && s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === q) {
      if (q === "'" && s[j + 1] === "'") {
        j++;
        continue;
      }
      return j;
    }
  }
  return -1;
}

function unquote(token, line) {
  const q = token[0];
  const end = skipQuoted(token, 0);
  if (end < 0) throw new YamlError(`unclosed ${q === '"' ? "double" : "single"} quote`, line);
  if (token.slice(end + 1).trim() !== "") throw new YamlError(`unexpected text after quoted value: ${token.slice(end + 1).trim()}`, line);
  const inner = token.slice(1, end);
  if (q === "'") return inner.replace(/''/g, "'");
  try {
    return JSON.parse(`"${inner.replace(/\\'/g, "'").replace(/\t/g, "\\t")}"`);
  } catch {
    throw new YamlError(`invalid escape in double-quoted value`, line);
  }
}

export function plainScalar(text) {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^[-+]?\d+$/.test(t)) return Number(t);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function scalar(text, line) {
  const t = text.trim();
  if (t.startsWith('"') || t.startsWith("'")) return unquote(t, line);
  return plainScalar(t);
}

// Flow collections: [a, b] and {k: v}, nested, with quoted or plain scalars.
function parseFlow(src, line) {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const value = () => {
    ws();
    if (src[i] === "[") return seq();
    if (src[i] === "{") return map();
    if (src[i] === '"' || src[i] === "'") {
      const end = skipQuoted(src, i);
      if (end < 0) throw new YamlError("unclosed quote in flow collection", line);
      const out = unquote(src.slice(i, end + 1), line);
      i = end + 1;
      return out;
    }
    const start = i;
    while (i < src.length && !",]}".includes(src[i])) {
      if (src[i] === ":" && /[\s,\]}]/.test(src[i + 1] ?? " ")) break;
      i++;
    }
    return plainScalar(src.slice(start, i));
  };
  const seq = () => {
    i++;
    const out = [];
    for (;;) {
      ws();
      if (src[i] === "]") {
        i++;
        return out;
      }
      out.push(value());
      ws();
      if (src[i] === ",") i++;
      else if (src[i] !== "]") throw new YamlError("expected , or ] in flow sequence", line);
    }
  };
  const map = () => {
    i++;
    const out = {};
    for (;;) {
      ws();
      if (src[i] === "}") {
        i++;
        return out;
      }
      const key = value();
      ws();
      if (src[i] !== ":") throw new YamlError("expected : in flow mapping", line);
      i++;
      checkKey(out, String(key), line);
      out[String(key)] = value();
      ws();
      if (src[i] === ",") i++;
      else if (src[i] !== "}") throw new YamlError("expected , or } in flow mapping", line);
    }
  };
  const out = value();
  ws();
  if (i < src.length) throw new YamlError(`unexpected text after flow collection: ${src.slice(i)}`, line);
  return out;
}

// Bracket depth of a flow fragment outside quotes (to find where a multi-line flow value ends).
function flowDepth(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const end = skipQuoted(s, i);
      if (end < 0) return depth;
      i = end;
    } else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
  }
  return depth;
}

// Position of the key separator `:` (followed by space or end) outside quotes and brackets, or -1.
function keyColon(s) {
  if (s.startsWith("- ") || s === "-") return -1;
  let i = 0;
  if (s[0] === '"' || s[0] === "'") {
    i = skipQuoted(s, 0);
    if (i < 0) return -1;
    i++;
    while (s[i] === " ") i++;
    return s[i] === ":" && (i + 1 === s.length || s[i + 1] === " ") ? i : -1;
  }
  if (s[0] === "[" || s[0] === "{") return -1;
  for (; i < s.length; i++) {
    if (s[i] === ":" && (i + 1 === s.length || s[i + 1] === " " || s[i + 1] === "\t")) return i;
  }
  return -1;
}

// GSDC-05: a duplicate key would silently drop a value; `__proto__` would set the mapping's prototype, so inherited
// fields (status, ...) could appear that the serialized mapping does not hold.
function checkKey(out, key, line) {
  if (key === "__proto__") throw new YamlError("key __proto__ is not allowed", line);
  if (Object.hasOwn(out, key)) throw new YamlError(`duplicate key ${key}`, line);
}

const isSeqItem = (text) => text === "-" || text.startsWith("- ");

class Parser {
  constructor(lines, lineOffset) {
    this.lines = lines;
    this.offset = lineOffset;
    this.pos = 0;
    this.virtual = new Map();
  }

  no(i) {
    return i + 1 + this.offset;
  }

  info(i) {
    if (this.virtual.has(i)) return this.virtual.get(i);
    const raw = this.lines[i];
    const indent = raw.length - raw.trimStart().length;
    if (/\t/.test(raw.slice(0, indent))) throw new YamlError("tab in indentation", this.no(i));
    return { indent, text: stripComment(raw.slice(indent)) };
  }

  nextContent(from = this.pos) {
    for (let i = from; i < this.lines.length; i++) {
      if (this.virtual.has(i) || this.info(i).text !== "") return i;
    }
    return -1;
  }

  parseNode(minIndent) {
    const i = this.nextContent();
    if (i < 0) return null;
    const { indent, text } = this.info(i);
    if (indent < minIndent) return null;
    if (isSeqItem(text)) return this.parseSeq(indent);
    if (keyColon(text) >= 0) return this.parseMap(indent);
    this.pos = i + 1;
    return this.parseValue(text, indent, i, false);
  }

  parseMap(n) {
    const out = {};
    for (;;) {
      const i = this.nextContent();
      if (i < 0) break;
      const { indent, text } = this.info(i);
      if (indent < n) break;
      if (indent > n) throw new YamlError("unexpected indentation", this.no(i));
      if (isSeqItem(text)) break;
      const c = keyColon(text);
      if (c < 0) throw new YamlError(`expected "key: value", got: ${text.slice(0, 80)}`, this.no(i));
      const rawKey = text.slice(0, c).trim();
      const key = rawKey.startsWith('"') || rawKey.startsWith("'") ? unquote(rawKey, this.no(i)) : rawKey;
      checkKey(out, key, this.no(i));
      this.pos = i + 1;
      out[key] = this.parseValue(text.slice(c + 1).trim(), n, i, true);
    }
    return out;
  }

  parseSeq(n) {
    const out = [];
    for (;;) {
      const i = this.nextContent();
      if (i < 0) break;
      const { indent, text } = this.info(i);
      if (indent < n) break;
      if (indent > n) throw new YamlError("unexpected indentation", this.no(i));
      if (!isSeqItem(text)) break;
      const rest = text === "-" ? "" : text.slice(2);
      const item = rest.trimStart();
      if (item !== "" && (keyColon(item) >= 0 || isSeqItem(item))) {
        this.virtual.set(i, { indent: n + text.length - item.length, text: item });
        out.push(this.parseNode(n + 1));
        continue;
      }
      this.pos = i + 1;
      out.push(this.parseValue(item, n, i, false));
    }
    return out;
  }

  parseValue(rest, n, i, sameIndentSeq) {
    if (rest === "") {
      const j = this.nextContent();
      if (j < 0) return null;
      const { indent, text } = this.info(j);
      if (indent > n) return this.parseNode(n + 1);
      if (sameIndentSeq && indent === n && isSeqItem(text)) return this.parseSeq(n);
      return null;
    }
    const block = /^([|>])([+-]?)$/.exec(rest);
    if (block) return this.parseBlockScalar(n, block[1], block[2]);
    if (rest.startsWith("[") || rest.startsWith("{")) {
      let buf = rest;
      while (flowDepth(buf) > 0) {
        if (this.pos >= this.lines.length) throw new YamlError("unclosed flow collection", this.no(i));
        buf += ` ${stripComment(this.lines[this.pos++].trim())}`;
      }
      return parseFlow(buf, this.no(i));
    }
    return scalar(rest, this.no(i));
  }

  parseBlockScalar(n, style, chomp) {
    const taken = [];
    let blockIndent = -1;
    while (this.pos < this.lines.length) {
      const raw = this.lines[this.pos];
      const blank = raw.trim() === "";
      const indent = raw.length - raw.trimStart().length;
      if (!blank && (indent <= n || (blockIndent >= 0 && indent < blockIndent))) break;
      if (!blank && blockIndent < 0) blockIndent = indent;
      taken.push(blank ? "" : raw.slice(blockIndent));
      this.pos++;
    }
    let trailing = 0;
    while (taken.length && taken[taken.length - 1] === "") {
      taken.pop();
      trailing++;
    }
    let text;
    if (style === "|") text = taken.join("\n");
    else {
      text = "";
      for (const line of taken) {
        if (line === "") text += "\n";
        else text += text === "" || text.endsWith("\n") ? line : ` ${line}`;
      }
    }
    if (taken.length === 0) return "";
    if (chomp === "-") return text;
    if (chomp === "+") return `${text}\n${"\n".repeat(trailing)}`;
    return `${text}\n`;
  }
}

// Parse a YAML-subset document: {value} or {error, line}.
export function parseYaml(text, lineOffset = 0) {
  const lines = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const parser = new Parser(lines, lineOffset);
  try {
    const value = parser.parseNode(0);
    const left = parser.nextContent();
    if (left >= 0) throw new YamlError(`unexpected content: ${parser.info(left).text.slice(0, 80)}`, parser.no(left));
    return { value };
  } catch (e) {
    if (e instanceof YamlError) return { error: `line ${e.line}: ${e.message}`, line: e.line };
    throw e;
  }
}

// Split a markdown file into frontmatter and body: {fm, body, present, error, line}.
export function frontmatter(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  if (lines[0].trim() !== "---") return { fm: {}, body: src, present: false, error: null };
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (end < 0) return { fm: {}, body: "", present: true, error: "line 1: unterminated frontmatter (no closing ---)", line: 1 };
  const body = lines.slice(end + 1).join("\n");
  const parsed = parseYaml(lines.slice(1, end).join("\n"), 1);
  if (parsed.error) return { fm: {}, body, present: true, error: parsed.error, line: parsed.line };
  const fm = parsed.value ?? {};
  if (typeof fm !== "object" || Array.isArray(fm)) return { fm: {}, body, present: true, error: "line 2: frontmatter is not a mapping", line: 2 };
  return { fm, body, present: true, error: null };
}
