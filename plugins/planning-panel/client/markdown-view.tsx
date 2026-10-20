// Markdown renderer over the pure parser (PANL-18). Only http(s) links open externally; local links and ids open
// in the panel; text is selectable.
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { withAlpha } from "./color.ts";
import { MONO_FONT, T, useKit } from "./kit.tsx";
import { type Block, type LinkContext, type Target, parseInline, parseMarkdown } from "./markdown.ts";

export interface MarkdownProps {
  source: string;
  ctx: LinkContext;
  onOpen: (target: Target) => void;
}

function Inline({ text, ctx, onOpen, size }: { text: string; ctx: LinkContext; onOpen: (t: Target) => void; size: number }) {
  const { colors } = useKit();
  const parts = useMemo(() => parseInline(text, ctx), [text, ctx]);
  const open = (t: Target) => (t.type === "external" ? void openExternalUrl(t.url) : onOpen(t));
  return (
    <Text selectable style={{ color: colors.foreground, fontSize: size, lineHeight: Math.round(size * 1.5) }}>
      {parts.map((p, i) => {
        switch (p.kind) {
          case "text":
            return p.text;
          case "bold":
            return <Text key={i} style={{ fontWeight: "700" }}>{p.text}</Text>;
          case "italic":
            return <Text key={i} style={{ fontStyle: "italic" }}>{p.text}</Text>;
          case "code":
            return (
              <Text key={i} onPress={p.target ? () => open(p.target!) : undefined} style={{ fontFamily: MONO_FONT, fontSize: size - 1, backgroundColor: colors.surface2, color: p.target ? colors.accent : colors.foreground }}>
                {p.text}
              </Text>
            );
          case "link":
            return p.target ? (
              <Text key={i} accessibilityRole="link" onPress={() => open(p.target!)} style={{ color: colors.accent, textDecorationLine: "underline" }}>
                {p.text}
              </Text>
            ) : (
              p.text
            );
        }
      })}
    </Text>
  );
}

function BlockView({ block, ctx, onOpen }: { block: Block; ctx: LinkContext; onOpen: (t: Target) => void }) {
  const { colors } = useKit();
  switch (block.kind) {
    case "heading":
      return <Inline text={block.text} ctx={ctx} onOpen={onOpen} size={[22, 19, 17, 15, 14, 13][block.level - 1]} />;
    case "paragraph":
      return <Inline text={block.text} ctx={ctx} onOpen={onOpen} size={14} />;
    case "code":
      return (
        <View style={{ padding: 10, borderRadius: 8, backgroundColor: colors.surface2 }}>
          <T mono size={12} selectable>
            {block.text}
          </T>
        </View>
      );
    case "list":
      return (
        <View style={{ gap: 3 }}>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 6, paddingLeft: item.depth * 16 }}>
              <T tone="muted" size={14}>
                {item.checked === null ? item.marker : item.checked ? "☑" : "☐"}
              </T>
              <View style={{ flex: 1 }}>
                <Inline text={item.text} ctx={ctx} onOpen={onOpen} size={14} />
              </View>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={{ borderLeftWidth: 3, borderColor: colors.border, paddingLeft: 10 }}>
          <Inline text={block.text} ctx={ctx} onOpen={onOpen} size={14} />
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: colors.border }} />;
    case "table":
      return (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: "hidden" }}>
          {block.rows.map((row, r) => (
            <View key={r} style={{ flexDirection: "row", backgroundColor: r === 0 && block.hasHeader ? withAlpha(colors.foregroundMuted, 0.12) : "transparent", borderTopWidth: r === 0 ? 0 : 1, borderColor: colors.border }}>
              {row.map((cell, c) => (
                <View key={c} style={{ flex: 1, padding: 6 }}>
                  <Inline text={cell} ctx={ctx} onOpen={onOpen} size={12} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export function Markdown({ source, ctx, onOpen }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} onOpen={onOpen} />
      ))}
    </View>
  );
}
