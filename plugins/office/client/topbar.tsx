// Top bar (OFFC-16, D-05, D-07): counters by agent state, the context readout of one agent, and an empty provider usage slot.
// Stateless and read-only. The usage slot stays an empty View until the owner supplies the usage API; no usage call exists here.
import { Pressable, Text, View } from "react-native";
import { USAGE_SLOT_MIN_WIDTH_PX } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";
import { TOPBAR_COUNTERS, type TopBarModel } from "./topbar-model.ts";

// Counters a compact (narrow) bar keeps, like habblaud's phone bar: work in progress always, the alarms only while non-zero.
const COMPACT_ALWAYS: ReadonlySet<string> = new Set(["running"]);
const COMPACT_WHEN_SET: ReadonlySet<string> = new Set(["attention", "error"]);

// compact: the narrow layout (client/narrow.ts) - a room-list button first, fewer counters, rows wrap, no token text.
export function TopBar(props: { model: TopBarModel; colors: PanelColors; compact?: boolean; onMenu?: () => void }) {
  const { model, colors, onMenu } = props;
  const compact = props.compact === true;
  const context = model.context;
  const pct = context === null ? 0 : Math.max(0, Math.min(100, Math.round(context.percent)));
  const counters = compact ? TOPBAR_COUNTERS.filter((c) => COMPACT_ALWAYS.has(c.id) || (COMPACT_WHEN_SET.has(c.id) && model.counters[c.id] > 0)) : TOPBAR_COUNTERS;
  return (
    <View testID="office-topbar" style={{ flexDirection: "row", flexWrap: compact ? "wrap" : "nowrap", alignItems: "center", gap: compact ? 8 : 16, paddingHorizontal: compact ? 8 : 12, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      {compact && onMenu ? (
        <Pressable testID="office-rooms-open" accessibilityRole="button" accessibilityLabel={text("narrowRoomsLabel")} onPress={onMenu} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.foreground, fontSize: 16 }}>{text("narrowRoomsOpen")}</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {counters.map((counter) => (
          <View key={counter.id} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text(counter.labelKey)}</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>{String(model.counters[counter.id])}</Text>
          </View>
        ))}
      </View>
      {context !== null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("contextLabel")}</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>{text("contextPercent", { percent: pct })}</Text>
          <View style={{ width: 80, height: 6, borderRadius: 3, backgroundColor: colors.surface2 }}>
            <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: context.warn ? colors.statusWarning : colors.accent }} />
          </View>
          {compact ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text("contextTokens", { used: context.usedTokens, max: context.maxTokens })}</Text>}
          {context.warn && !compact ? <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{text("contextHigh")}</Text> : null}
        </View>
      ) : null}
      {/* Compact: the usage slot takes its own full-width row under the buttons, where habblaud's phone bar keeps account usage. */}
      <View testID="office-usage-slot" accessibilityLabel={text("usageSlotLabel")} style={compact ? { flexBasis: "100%" } : { minWidth: USAGE_SLOT_MIN_WIDTH_PX }} />
    </View>
  );
}
