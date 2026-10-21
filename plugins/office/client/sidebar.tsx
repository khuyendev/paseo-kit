// Sidebar (OFFC-14, D-04): Paseo's tree project > workspace > agent as stateless rows. Selecting a row hands its node to the parent,
// which moves the camera to node.target; toggling hands the node id. Read-only: no other action exists (D-09).
// Agent-provided text reaches the screen only as clipped Text children.
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LABEL_MAX_CHARS, SIDEBAR_INDENT_PX } from "./limits-panels.ts";
import type { SidebarNode, SidebarRow } from "./sidebar-model.ts";
import { clipText, text, type StringKey } from "./strings.ts";

export type PanelColors = Pick<PluginTheme["colors"], "surface1" | "surface2" | "border" | "foreground" | "foregroundMuted" | "accent" | "statusWarning" | "statusDanger">;

const FALLBACK: Record<SidebarNode["kind"], StringKey> = {
  project: "sidebarUnnamedProject",
  workspace: "sidebarUnnamedWorkspace",
  agent: "sidebarUntitledAgent",
  unplaced: "sidebarUnplaced",
};

export function Sidebar(props: {
  rows: readonly SidebarRow[];
  hidden: number;
  selectedId: string | null;
  colors: PanelColors;
  onSelect: (node: SidebarNode) => void;
  onToggle: (nodeId: string) => void;
}) {
  const { rows, hidden, selectedId, colors, onSelect, onToggle } = props;
  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ padding: 8, gap: 2 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>{text("sidebarTitle")}</Text>
        {rows.length === 0 && hidden === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text("sidebarEmpty")}</Text> : null}
        {rows.map((row, index) => {
          const selected = selectedId !== null && row.node.id === selectedId;
          const shown = clipText(row.node.label, LABEL_MAX_CHARS);
          return (
            <Pressable
              key={`${index}:${row.node.id}`}
              testID="office-sidebar-row"
              accessibilityRole="button"
              onPress={() => onSelect(row.node)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingRight: 6, paddingLeft: SIDEBAR_INDENT_PX * row.depth, borderRadius: 6, backgroundColor: selected ? colors.surface2 : colors.surface1 }}
            >
              {row.hasChildren ? (
                <Pressable
                  testID="office-sidebar-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={text(row.expanded ? "sidebarCollapse" : "sidebarExpand")}
                  onPress={() => onToggle(row.node.id)}
                  style={{ width: 16, alignItems: "center" }}
                >
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text(row.expanded ? "sidebarGlyphOpen" : "sidebarGlyphClosed")}</Text>
                </Pressable>
              ) : (
                <View style={{ width: 16 }} />
              )}
              {row.node.attention ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.statusWarning }} /> : null}
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1 }}>
                {shown === "" ? text(FALLBACK[row.node.kind]) : shown}
              </Text>
              {row.node.statusKey !== null ? <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text(row.node.statusKey)}</Text> : null}
              {row.node.isChild ? <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text("sidebarChildBadge")}</Text> : null}
              {row.node.kind === "agent" && !row.node.drawn ? <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text("sidebarNotDrawn")}</Text> : null}
            </Pressable>
          );
        })}
        {hidden > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("sidebarMoreRows", { count: hidden })}</Text> : null}
      </View>
    </ScrollView>
  );
}
