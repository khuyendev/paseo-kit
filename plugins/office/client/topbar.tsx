// Top bar (OFFC-16, D-05, D-07): counters by agent state, the context readout of one agent, and an empty provider usage slot.
// Stateless and read-only. The usage slot stays an empty View until the owner supplies the usage API; no usage call exists here.
import { Text, View } from "react-native";
import { USAGE_SLOT_MIN_WIDTH_PX } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";
import { TOPBAR_COUNTERS, type TopBarModel } from "./topbar-model.ts";

export function TopBar(props: { model: TopBarModel; colors: PanelColors }) {
  const { model, colors } = props;
  const context = model.context;
  const pct = context === null ? 0 : Math.max(0, Math.min(100, Math.round(context.percent)));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {TOPBAR_COUNTERS.map((counter) => (
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
          <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text("contextTokens", { used: context.usedTokens, max: context.maxTokens })}</Text>
          {context.warn ? <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{text("contextHigh")}</Text> : null}
        </View>
      ) : null}
      <View testID="office-usage-slot" accessibilityLabel={text("usageSlotLabel")} style={{ minWidth: USAGE_SLOT_MIN_WIDTH_PX }} />
    </View>
  );
}
