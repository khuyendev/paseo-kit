// Frontmatter parser (PANL-14): a port of the kit's GSD YAML subset (GSDC-05): block maps and sequences
// (including maps inside sequence items), flow `[..]`/`{..}` (also multi-line), quoted and plain scalars (null,
// booleans, integers, floats), `|`/`>` block scalars with chomping, comments outside quotes; BOM and CRLF are
// tolerated. Scalars resolve as in the kit parser (`plan: 01` is the number 1), so values match `ph gsd`.
// A parse error is returned as {error, line} (1-based file line), never thrown and never a silent field drop.

export type Yaml = null | boolean | number | string | Yaml[] | { [key: string]: Yaml };
export type FrontmatterResult = { data: Record<string, Yaml> | null; body: string; endLine: number } | { error: string; line: number };

class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

interface Ctx {
  lines: string[];
  // file line number of lines[0]
  base: number;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const isBlank = (l: string) => l.trim() === "" || l.trimStart().startsWith("#");

// Text before a comment that starts outside quotes.
function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s[{,:]/.test(s[i - 1])) quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function unquoteDouble(s: string, line: number): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, e: string) => {
    if (e.startsWith("u") && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0" };
    if (!(e in map)) throw new YamlError(`unknown escape \\${e}`, line);
    return map[e];
  });
}

export function plainScalar(raw: string): Yaml {
  const s = raw.trim();
  if (s === "" || s === "~" || /^null$/i.test(s)) return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function scalar(raw: string, line: number): Yaml {
  const s = raw.trim();
  if (s.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw new YamlError("unterminated double-quoted string", line);
    return unquoteDouble(s.slice(1, -1), line);
  }
  if (s.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw new YamlError("unterminated single-quoted string", line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!|>%@`]/.test(s)) throw new YamlError(`unsupported value '${s}'`, line);
  return plainScalar(s);
}

// Flow collections: [a, "b", {c: 1}].
function parseFlow(text: string, line: number): Yaml {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const value = (): Yaml => {
    ws();
    const ch = text[i];
    if (ch === "[") {
      i += 1;
      const out: Yaml[] = [];
      ws();
      if (text[i] === "]") return (i += 1), out;
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ",") {
          i += 1;
          ws();
          if (text[i] === "]") return (i += 1), out;
          continue;
        }
        if (text[i] === "]") return (i += 1), out;
        throw new YamlError("expected , or ] in flow sequence", line);
      }
    }
    if (ch === "{") {
      i += 1;
      const out: Record<string, Yaml> = {};
      ws();
      if (text[i] === "}") return (i += 1), out;
      for (;;) {
        const k = value();
        ws();
        if (text[i] !== ":") throw new YamlError("expected : in flow mapping", line);
        i += 1;
        out[String(k)] = value();
        ws();
        if (text[i] === ",") {
          i += 1;
          ws();
          if (text[i] === "}") return (i += 1), out;
          continue;
        }
        if (text[i] === "}") return (i += 1), out;
        throw new YamlError("expected , or } in flow mapping", line);
      }
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < text.length && text[i] !== ch) i += ch === '"' && text[i] === "\\" ? 2 : 1;
      if (ch === "'" && text[i + 1] === "'") {
        i += 2;
        while (i < text.length && text[i] !== "'") i += 1;
      }
      if (i >= text.length) throw new YamlError("unterminated string in flow collection", line);
      i += 1;
      return scalar(text.slice(start, i), line);
    }
    const start = i;
    while (i < text.length && !/[,\]}]/.test(text[i]) && !(text[i] === ":" && /[\s,\]}]/.test(text[i + 1] ?? " "))) i += 1;
    return plainScalar(text.slice(start, i));
  };
  const v = value();
  ws();
  if (i < text.length) throw new YamlError(`unexpected '${text.slice(i, i + 10)}' after flow collection`, line);
  return v;
}

function balanced(s: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
  }
  return depth <= 0 && quote === null;
}

function nextContent(ctx: Ctx, i: number): number {
  while (i < ctx.lines.length && isBlank(ctx.lines[i])) i += 1;
  return i;
}

// Value text after "key:" or "- ": flow (possibly continued on later lines), block scalar, nested block, scalar.
function inlineValue(ctx: Ctx, i: number, ind: number, rest: string): [Yaml, number] {
  const line = ctx.base + i;
  const text = stripComment(rest).trim();
  if (text === "") {
    const j = nextContent(ctx, i + 1);
    if (j < ctx.lines.length) {
      const childInd = indentOf(ctx.lines[j]);
      const isSeq = /^-(\s|$)/.test(ctx.lines[j].trimStart());
      if (childInd > ind || (childInd === ind && isSeq && ind >= 0)) return parseBlock(ctx, j, childInd);
    }
    return [null, i + 1];
  }
  if (/^[|>][-+]?$/.test(text)) return blockScalar(ctx, i, ind, text);
  if (text.startsWith("[") || text.startsWith("{")) {
    let joined = text;
    let j = i + 1;
    while (!balanced(joined)) {
      if (j >= ctx.lines.length) throw new YamlError("unclosed flow collection", line);
      joined += ` ${stripComment(ctx.lines[j]).trim()}`;
      j += 1;
    }
    return [parseFlow(joined, line), j];
  }
  return [scalar(text, line), i + 1];
}

function blockScalar(ctx: Ctx, i: number, ind: number, header: string): [Yaml, number] {
  const out: string[] = [];
  let j = i + 1;
  let blockInd = -1;
  while (j < ctx.lines.length) {
    const l = ctx.lines[j];
    if (l.trim() === "") {
      out.push("");
      j += 1;
      continue;
    }
    const li = indentOf(l);
    if (li <= ind) break;
    if (blockInd < 0) blockInd = li;
    if (li < blockInd) break;
    out.push(l.slice(blockInd));
    j += 1;
  }
  let trailing = 0;
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
    trailing += 1;
  }
  // Folded: lines join with a space; an empty line becomes one newline.
  const body = header[0] === "|" ? out.join("\n") : out.reduce((acc, l, k) => (k === 0 ? l : l === "" ? `${acc}\n` : out[k - 1] === "" ? `${acc}${l}` : `${acc} ${l}`), "");
  const chomp = header[1];
  const value = chomp === "-" ? body : chomp === "+" ? body + "\n".repeat(trailing + 1) : body === "" ? "" : `${body}\n`;
  return [value, j];
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"[\]{},][^:#]*?|[^\s#'"[\]{},]):(\s|$)(.*)$/;

function parseMap(ctx: Ctx, i: number, ind: number): [Yaml, number] {
  const out: Record<string, Yaml> = {};
  while (i < ctx.lines.length) {
    i = nextContent(ctx, i);
    if (i >= ctx.lines.length) break;
    const l = ctx.lines[i];
    const li = indentOf(l);
    if (li < ind) break;
    if (li > ind) throw new YamlError("unexpected indentation", ctx.base + i);
    const body = l.slice(li);
    if (/^-(\s|$)/.test(body)) break;
    const m = KEY.exec(body);
    if (!m) throw new YamlError(`expected 'key: value', got '${body.trim().slice(0, 40)}'`, ctx.base + i);
    const key = String(scalar(m[1], ctx.base + i));
    if (key in out) throw new YamlError(`duplicate key '${key}'`, ctx.base + i);
    const [v, next] = inlineValue(ctx, i, ind, m[3]);
    out[key] = v;
    i = next;
  }
  return [out, i];
}

function parseSeq(ctx: Ctx, i: number, ind: number): [Yaml, number] {
  const out: Yaml[] = [];
  while (i < ctx.lines.length) {
    i = nextContent(ctx, i);
    if (i >= ctx.lines.length) break;
    const l = ctx.lines[i];
    const li = indentOf(l);
    if (li < ind) break;
    if (li > ind) throw new YamlError("unexpected indentation in sequence", ctx.base + i);
    const body = l.slice(li);
    if (!/^-(\s|$)/.test(body)) break;
    const rest = body.slice(1);
    const pad = rest.length - rest.trimStart().length;
    const item = rest.trimStart();
    if (item !== "" && KEY.test(item) && !/^["'[{]/.test(item)) {
      // "- key: v" starts a map whose keys sit at the column after the dash.
      const keyInd = li + 1 + pad;
      ctx.lines[i] = " ".repeat(keyInd) + item;
      const [v, next] = parseMap(ctx, i, keyInd);
      out.push(v);
      i = next;
    } else {
      const [v, next] = inlineValue(ctx, i, ind, item);
      out.push(v);
      i = next;
    }
  }
  return [out, i];
}

function parseBlock(ctx: Ctx, i: number, ind: number): [Yaml, number] {
  return /^-(\s|$)/.test(ctx.lines[i].trimStart()) ? parseSeq(ctx, i, ind) : parseMap(ctx, i, ind);
}

export function parseYaml(text: string, baseLine = 1): { value: Yaml } | { error: string; line: number } {
  const ctx: Ctx = { lines: text.split("\n"), base: baseLine };
  try {
    const start = nextContent(ctx, 0);
    if (start >= ctx.lines.length) return { value: null };
    if (/^\t/.test(ctx.lines[start])) throw new YamlError("tabs are not allowed for indentation", baseLine + start);
    const [value, end] = parseBlock(ctx, start, indentOf(ctx.lines[start]));
    const rest = nextContent(ctx, end);
    if (rest < ctx.lines.length) throw new YamlError(`unexpected '${ctx.lines[rest].trim().slice(0, 40)}'`, baseLine + rest);
    return { value };
  } catch (err) {
    if (err instanceof YamlError) return { error: `line ${err.line}: ${err.message}`, line: err.line };
    throw err;
  }
}

// Splits `---` frontmatter from the body. No frontmatter -> data null; an unclosed block is an error.
export function parseFrontmatter(raw: string): FrontmatterResult {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^---[ \t]*(\n|$)/.test(text)) return { data: null, body: text, endLine: 0 };
  const lines = text.split("\n");
  const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)[ \t]*$/.test(l));
  if (close < 0) return { error: "line 1: frontmatter is not closed by ---", line: 1 };
  const parsed = parseYaml(lines.slice(1, close).join("\n"), 2);
  if ("error" in parsed) return parsed;
  const v = parsed.value;
  if (v !== null && (typeof v !== "object" || Array.isArray(v))) return { error: "line 2: frontmatter is not a mapping", line: 2 };
  return { data: (v ?? {}) as Record<string, Yaml>, body: lines.slice(close + 1).join("\n"), endLine: close + 1 };
}
