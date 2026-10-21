// No upstream: written for the HUD of the office.
// Feed panel (step D): the latest activity across the visible projects, newest first, each line with its relative time, the generated
// name and what happened. Pressing a line hands the agent id to the parent (select and move the camera). Stateless and read-only.
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FeedRow } from "./feed.ts";
import { FEED_PANEL_MAX_HEIGHT_PX, FEED_PANEL_WIDTH_PX, NARROW_FEED_BAR_PX } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";

// The narrow layout's Activity bar (habblaud's phone feed): the title and the newest line; pressing it opens or closes the feed.
export function FeedBar(props: { latest: FeedRow | null; open: boolean; colors: PanelColors; onToggle: () => void }) {
  const { latest, open, colors, onToggle } = props;
  return (
    <Pressable
      testID="office-feed-bar"
      accessibilityRole="button"
      accessibilityLabel={text("feedTitle")}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={{ height: NARROW_FEED_BAR_PX, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}
    >
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 }}>{text("feedTitle")}</Text>
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1 }}>
        {latest === null ? text("feedEmpty") : text("narrowFeedLine", { name: latest.name, what: text(latest.kindKey) })}
      </Text>
      <Text style={{ color: colors.foreground, fontSize: 14 }}>{text(open ? "narrowFeedClose" : "narrowFeedOpen")}</Text>
    </Pressable>
  );
}

// full: the narrow layout's open feed, as wide as its container (above the Activity bar) instead of the fixed corner panel.
export function FeedPanel(props: { rows: readonly FeedRow[]; colors: PanelColors; onPick: (agentId: string) => void; full?: boolean }) {
  const { rows, colors, onPick } = props;
  const size = props.full === true ? { flex: 1 } : { width: FEED_PANEL_WIDTH_PX, maxHeight: FEED_PANEL_MAX_HEIGHT_PX };
  return (
    <View testID="office-feed" style={{ ...size, padding: 8, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
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
