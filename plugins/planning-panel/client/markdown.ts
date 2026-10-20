// Library-free Markdown parser (PANL-18): headings 1-6, paragraphs, fenced code, nested bullet/numbered lists
// (depth <= 3) with checkboxes, blockquotes, rules and pipe tables; inline code, bold, italic, links, bare
// http(s) URLs and ids known in the index. No HTML, no images. Rendering lives in markdown-view.tsx.

export type ListItem = { depth: number; marker: string; text: string; checked: boolean | null };

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][]; hasHeader: boolean };

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;
export const MAX_LIST_DEPTH = 3;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^\s*>/.test(line) || /^\s*\|/.test(line) || LIST.test(line);
}

const splitRow = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i += 1;
      blocks.push({ kind: "code", lang: fence[2], text: buf.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      let hasHeader = false;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (TABLE_SEP.test(lines[i])) hasHeader = rows.length === 1;
        else rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", rows, hasHeader });
      continue;
    }
    if (LIST.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m) {
          const box = CHECKBOX.exec(m[3]);
          items.push({
            depth: Math.min(MAX_LIST_DEPTH, Math.floor(m[1].replace(/\t/g, "  ").length / 2)),
            marker: /^\d/.test(m[2]) ? m[2] : "•",
            text: box ? box[2] : m[3],
            checked: box ? box[1].toLowerCase() === "x" : null,
          });
          i += 1;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0 && !startsBlock(lines[i])) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i += 1;
        } else break;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && (buf.length === 0 || !startsBlock(lines[i]))) buf.push(lines[i++].trim());
    blocks.push({ kind: "paragraph", text: buf.join(" ") });
  }
  return blocks;
}

export type Target = { type: "file"; path: string } | { type: "external"; url: string } | { type: "id"; id: string };

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; target: Target | null }
  | { kind: "bold" | "italic"; text: string }
  | { kind: "link"; text: string; target: Target | null };

export interface LinkContext {
  // `.planning/`-relative path of the file being rendered.
  from: string;
  // Indexed `.planning/`-relative paths.
  files: ReadonlySet<string>;
  // Phase ids ("Phase 2"), plan ids ("01-02") and requirement ids known in the index.
  ids: ReadonlySet<string>;
}

// A local link opens the in-panel reader only when it names an indexed file inside `.planning/` (PANL-13);
// only http(s) opens externally; anything else stays plain text.
export function resolveTarget(href: string, ctx: LinkContext): Target | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return { type: "external", url: h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//") || h.startsWith("/") || /^[A-Za-z]:[\\/]/.test(h)) return null;
  const clean = h.replace(/[#?].*$/, "").replace(/\\/g, "/");
  if (!clean) return null;
  const base = clean.startsWith(".planning/") ? [] : ctx.from.split("/").slice(0, -1);
  const parts = [...base];
  for (const seg of (clean.startsWith(".planning/") ? clean.slice(".planning/".length) : clean).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  const path = parts.join("/");
  return ctx.files.has(path) ? { type: "file", path } : null;
}

// Underscore emphasis is not supported: it would break snake_case identifiers in plans.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)<>]+|\bPhase \d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?-\d+\b|\b[A-Z][A-Z0-9]*-\d+\b)/g;

export function parseInline(text: string, ctx: LinkContext): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (t: Inline) => {
    const prev = out[out.length - 1];
    if (t.kind === "text" && prev?.kind === "text") prev.text += t.text;
    else out.push(t);
  };
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) push({ kind: "text", text: text.slice(last, at) });
    last = at + tok.length;
    if (tok.startsWith("`")) {
      const code = tok.slice(1, -1);
      push({ kind: "code", text: code, target: /\s/.test(code) ? null : resolveTarget(code, ctx) });
    } else if (tok.startsWith("**")) push({ kind: "bold", text: tok.slice(2, -2) });
    else if (tok.startsWith("*")) push({ kind: "italic", text: tok.slice(1, -1) });
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      push({ kind: "link", text: lm[1], target: resolveTarget(lm[2], ctx) });
    } else if (/^https?:/.test(tok)) push({ kind: "link", text: tok, target: { type: "external", url: tok } });
    else if (ctx.ids.has(tok)) push({ kind: "link", text: tok, target: { type: "id", id: tok } });
    else push({ kind: "text", text: tok });
  }
  if (last < text.length) push({ kind: "text", text: text.slice(last) });
  return out;
}
