// Sidebar (OFFC-14, D-04): the flat project list as stateless rows. A checkbox shows or hides a project in the scene; pressing the name hands
// the row to the parent, which moves the camera to row.target. "All" and "None" act on the whole list. Read-only: no other action exists (D-09).
// Agent-provided text reaches the screen only as clipped Text children; the labels of the controls come from the strings table.
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LABEL_MAX_CHARS, SIDEBAR_CHECK_PX } from "./limits-panels.ts";
import type { ProjectList, ProjectRow } from "./sidebar-model.ts";
import { clipText, text } from "./strings.ts";

export type PanelColors = Pick<PluginTheme["colors"], "surface1" | "surface2" | "border" | "foreground" | "foregroundMuted" | "accent" | "statusWarning" | "statusDanger">;

export function Sidebar(props: {
  list: ProjectList;
  colors: PanelColors;
  onToggle: (projectId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onFocus: (row: ProjectRow) => void;
}) {
  const { list, colors, onToggle, onShowAll, onHideAll, onFocus } = props;
  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ padding: 8, gap: 2 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>{text("sidebarTitle")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1 }}>{text("sidebarProjects")}</Text>
          <Pressable testID="office-sidebar-all" accessibilityRole="button" accessibilityLabel={text("sidebarShowAll")} onPress={onShowAll} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.surface2 }}>
            <Text style={{ color: colors.foreground, fontSize: 11 }}>{text("sidebarAll")}</Text>
          </Pressable>
          <Pressable testID="office-sidebar-none" accessibilityRole="button" accessibilityLabel={text("sidebarHideAll")} onPress={onHideAll} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.surface2 }}>
            <Text style={{ color: colors.foreground, fontSize: 11 }}>{text("sidebarNone")}</Text>
          </Pressable>
        </View>
        {list.rows.length === 0 && list.more === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text("sidebarEmpty")}</Text> : null}
        {list.rows.map((row, index) => {
          const shown = clipText(row.label, LABEL_MAX_CHARS);
          return (
            <View key={`${index}:${row.projectId}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 }}>
              <Pressable
                testID="office-sidebar-check"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.shown }}
                accessibilityLabel={text("sidebarShowProject")}
                onPress={() => onToggle(row.projectId)}
                style={{ width: SIDEBAR_CHECK_PX, height: SIDEBAR_CHECK_PX, alignItems: "center", justifyContent: "center", borderRadius: 3, borderWidth: 1, borderColor: row.shown ? colors.accent : colors.border, backgroundColor: row.shown ? colors.accent : colors.surface1 }}
              >
                {row.shown ? <Text style={{ color: colors.surface1, fontSize: 10, fontWeight: "800" }}>{text("sidebarCheckGlyph")}</Text> : null}
              </Pressable>
              <Pressable testID="office-sidebar-row" accessibilityRole="button" onPress={() => onFocus(row)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, paddingRight: 4, borderRadius: 6 }}>
                {row.attention ? <View testID="office-sidebar-attention" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.statusWarning }} /> : null}
                <Text numberOfLines={1} style={{ color: row.shown ? colors.foreground : colors.foregroundMuted, fontSize: 12, flex: 1 }}>
                  {shown === "" ? text("sidebarUnnamedProject") : shown}
                </Text>
                <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{text("sidebarCounts", { agents: row.agents, working: row.working })}</Text>
              </Pressable>
            </View>
          );
        })}
        {list.more > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("sidebarMoreRows", { count: list.more })}</Text> : null}
      </View>
    </ScrollView>
  );
}
