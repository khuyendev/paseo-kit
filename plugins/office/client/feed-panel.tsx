// No upstream: written for the HUD of the office.
// Feed panel (step D): the latest activity across the visible projects, newest first, each line with its relative time, the generated
// name and what happened. Pressing a line hands the agent id to the parent (select and move the camera). Stateless and read-only.
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FeedRow } from "./feed.ts";
import { FEED_PANEL_MAX_HEIGHT_PX, FEED_PANEL_WIDTH_PX } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";

export function FeedPanel(props: { rows: readonly FeedRow[]; colors: PanelColors; onPick: (agentId: string) => void }) {
  const { rows, colors, onPick } = props;
  return (
    <View testID="office-feed" style={{ width: FEED_PANEL_WIDTH_PX, maxHeight: FEED_PANEL_MAX_HEIGHT_PX, padding: 8, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>{text("feedTitle")}</Text>
      {rows.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("feedEmpty")}</Text> : null}
      <ScrollView>
        {rows.map((row) => (
          <Pressable key={row.seq} testID="office-feed-row" accessibilityRole="button" onPress={() => onPick(row.agentId)} style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 10, width: 54 }}>{text(row.when.key, { count: row.when.count })}</Text>
            <Text style={{ color: colors.foreground, fontSize: 11 }}>{row.name}</Text>
            <Text numberOfLines={1} style={{ color: row.kind === "error" ? colors.statusDanger : row.kind === "permission" ? colors.statusWarning : colors.foregroundMuted, fontSize: 11, flex: 1 }}>
              {text(row.kindKey)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
