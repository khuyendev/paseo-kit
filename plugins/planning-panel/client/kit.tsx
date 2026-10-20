// UI kit primitives of the planning panel (PANL-22). Text colours come only from theme.colors (PANL-06).
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, createContext, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import type { Tone } from "../shared/planning.ts";
import { type Colors, toneColor, withAlpha } from "./color.ts";

export { withAlpha };

export const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, Consolas, monospace" });

interface Kit {
  colors: Colors;
  compact: boolean;
}

const KitContext = createContext<Kit | null>(null);

export function KitProvider({ theme, compact, children }: { theme: PluginHostProps["theme"]; compact: boolean; children: ReactNode }) {
  const value = useMemo<Kit>(() => ({ colors: theme.colors, compact }), [theme, compact]);
  return <KitContext.Provider value={value}>{children}</KitContext.Provider>;
}

export function useKit(): Kit {
  const kit = useContext(KitContext);
  if (!kit) throw new Error("useKit must be used inside KitProvider");
  return kit;
}

export type TextTone = Tone | "foreground" | "onAccent";

export function T(props: { tone?: TextTone; size?: number; weight?: TextStyle["fontWeight"]; mono?: boolean; lines?: number; upper?: boolean; selectable?: boolean; style?: StyleProp<TextStyle>; children: ReactNode }) {
  const { colors } = useKit();
  const size = props.size ?? 14;
  return (
    <Text
      numberOfLines={props.lines}
      selectable={props.selectable}
      style={[
        {
          color: toneColor(colors, props.tone ?? "foreground"),
          fontSize: size,
          lineHeight: Math.round(size * 1.45),
          fontWeight: props.weight ?? "400",
          fontFamily: props.mono ? MONO_FONT : undefined,
          textTransform: props.upper ? "uppercase" : "none",
          letterSpacing: props.upper ? 0.7 : 0,
        },
        props.style,
      ]}
    >
      {props.children}
    </Text>
  );
}

export function Press(props: { onPress: () => void; label: string; children: ReactNode; style?: StyleProp<ViewStyle>; hoverStyle?: StyleProp<ViewStyle>; role?: "button" | "link" | "tab"; selected?: boolean; disabled?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole={props.role ?? "button"}
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [props.style, hovered ? props.hoverStyle : null, pressed ? { opacity: 0.8 } : null]}
    >
      {props.children}
    </Pressable>
  );
}

export function Section(props: { title: string; trailing?: string; children: ReactNode }) {
  const { colors } = useKit();
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T size={11} weight="700" tone="muted" upper>
          {props.title}
        </T>
        {props.trailing ? (
          <T size={11} weight="600" tone="muted">
            {props.trailing}
          </T>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

export function MetaRow(props: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <T size={12} tone="muted" style={{ width: 96, paddingTop: 1 }}>
        {props.label}
      </T>
      <View style={{ flex: 1 }}>{props.children}</View>
    </View>
  );
}

// Decorative dot: the only place a fixed hue may appear.
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Badge(props: { label: string; tone: Tone; icon?: string }) {
  const { colors } = useKit();
  const color = toneColor(colors, props.tone);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(color, 0.14) }}>
      {props.icon ? <Icon name={props.icon} size={11} color={color} /> : <Dot color={color} size={6} />}
      <T size={11} weight="600" tone={props.tone} lines={1}>
        {props.label}
      </T>
    </View>
  );
}

export function ProgressBar(props: { value: number; total: number; tone: Tone; height?: number }) {
  const { colors } = useKit();
  const height = props.height ?? 6;
  const ratio = props.total > 0 ? Math.min(1, Math.max(0, props.value / props.total)) : 0;
  return (
    <View style={{ height, width: "100%", borderRadius: height / 2, overflow: "hidden", backgroundColor: withAlpha(colors.foregroundMuted, 0.25) }}>
      <View style={{ height: "100%", width: `${ratio * 100}%`, backgroundColor: toneColor(colors, props.tone) }} />
    </View>
  );
}

export function SegmentedBar(props: { segments: readonly { tone: Tone; count: number }[]; height?: number }) {
  const { colors } = useKit();
  const height = props.height ?? 6;
  return (
    <View style={{ flexDirection: "row", height, borderRadius: height / 2, overflow: "hidden", backgroundColor: withAlpha(colors.foregroundMuted, 0.2) }}>
      {props.segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <View key={s.tone} style={{ flex: s.count, backgroundColor: toneColor(colors, s.tone) }} />
        ))}
    </View>
  );
}

export function Chip(props: { label: string; active: boolean; onPress: () => void; icon?: string }) {
  const { colors } = useKit();
  return (
    <Press
      label={props.label}
      role="tab"
      selected={props.active}
      onPress={props.onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: props.active ? colors.accent : colors.border, backgroundColor: props.active ? withAlpha(colors.accent, 0.14) : "transparent" }}
      hoverStyle={{ backgroundColor: colors.surface2 }}
    >
      {props.icon ? <Icon name={props.icon} size={12} color={props.active ? colors.accent : colors.foregroundMuted} /> : null}
      <T size={12} weight="600" tone={props.active ? "accent" : "muted"} lines={1}>
        {props.label}
      </T>
    </Press>
  );
}

export function IconButton(props: { icon: string; label: string; onPress: () => void; busy?: boolean }) {
  const { colors } = useKit();
  return (
    <Press label={props.label} onPress={props.onPress} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8 }} hoverStyle={{ backgroundColor: colors.surface2 }}>
      {props.busy ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : <Icon name={props.icon} size={16} color={colors.foregroundMuted} />}
    </Press>
  );
}

export function ActionButton(props: { label: string; onPress: () => void; icon?: string }) {
  const { colors } = useKit();
  return (
    <Press label={props.label} onPress={props.onPress} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: colors.accent }}>
      {props.icon ? <Icon name={props.icon} size={14} color={colors.accentForeground} /> : null}
      <T size={13} weight="600" tone="onAccent">
        {props.label}
      </T>
    </Press>
  );
}

export function StatePanel(props: { icon: string; title: string; body?: string; tone?: Tone; busy?: boolean }) {
  const { colors } = useKit();
  const color = toneColor(colors, props.tone ?? "muted");
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(color, 0.14) }}>
        {props.busy ? <ActivityIndicator color={color} /> : <Icon name={props.icon} size={24} color={color} />}
      </View>
      <T size={16} weight="700" style={{ textAlign: "center" }}>
        {props.title}
      </T>
      {props.body ? (
        <T tone="muted" size={13} style={{ textAlign: "center", maxWidth: 440 }} selectable>
          {props.body}
        </T>
      ) : null}
    </View>
  );
}
