// Drawer (OFFC-15, OFFC-21, D-05): one agent's activity, todos, child agents, last error, attention, provider and model, as stateless Cards.
// Read-only (D-09): the only action is closing. Agent-provided text is a Text child only; an absent value shows nothing.
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { DrawerModel } from "./drawer-model.ts";
import { TOKEN_BAR_WIDTH_PX } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";

function Card(props: { colors: PanelColors; heading: string; children: ReactNode }) {
  const { colors, children } = props;
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>{props.heading}</Text>
      {children}
    </View>
  );
}

function Row(props: { colors: PanelColors; caption: string; value: string }) {
  const { colors } = props;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, width: 90 }}>{props.caption}</Text>
      <Text style={{ color: colors.foreground, fontSize: 11, flex: 1 }}>{props.value}</Text>
    </View>
  );
}

export function Drawer(props: { model: DrawerModel | null; colors: PanelColors; onClose: () => void; following?: boolean; onFollow?: () => void }) {
  const { model, colors, onClose, onFollow } = props;
  if (model === null) return null;
  const following = props.following === true;
  const hasDetails = model.attentionKey !== null || model.permissions > 0 || model.provider !== null || model.model !== null;
  const tokens = model.tokens;
  const pct = tokens === null ? 0 : Math.max(0, Math.min(100, Math.round(tokens.percent)));
  const chip = model.chip;
  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ padding: 8, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
            {model.label ?? text("drawerUntitled")}
          </Text>
          {onFollow !== undefined ? (
            <Pressable testID="office-drawer-follow" accessibilityRole="button" accessibilityLabel={text("cameraFollow")} accessibilityState={{ selected: following }} onPress={onFollow} style={{ padding: 6, borderRadius: 6, backgroundColor: following ? colors.accent : colors.surface2 }}>
              <Text style={{ color: following ? colors.surface1 : colors.foreground, fontSize: 12 }}>{text(following ? "cameraFollowing" : "cameraFollow")}</Text>
            </Pressable>
          ) : null}
          <Pressable testID="office-drawer-close" accessibilityRole="button" accessibilityLabel={text("drawerClose")} onPress={onClose} style={{ padding: 6, borderRadius: 6 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text("drawerClose")}</Text>
          </Pressable>
        </View>

        <Card colors={colors} heading={text("drawerSectionStats")}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, width: 90 }}>{text("drawerName")}</Text>
            {chip !== null ? (
              <View style={{ width: 14, height: 14, borderRadius: 3, alignItems: "center", justifyContent: "center", backgroundColor: chip.color }}>
                <Text style={{ color: colors.surface1, fontSize: 9, fontWeight: "800" }}>{chip.letter}</Text>
              </View>
            ) : null}
            <Text style={{ color: colors.foreground, fontSize: 11, flex: 1 }}>{model.name}</Text>
          </View>
          {tokens !== null ? (
            <View style={{ gap: 4 }}>
              <Row colors={colors} caption={text("drawerTokens")} value={text("drawerTokensValue", { used: tokens.used, max: tokens.max, percent: pct })} />
              <View style={{ width: TOKEN_BAR_WIDTH_PX, height: 6, borderRadius: 3, backgroundColor: colors.surface2 }}>
                <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: pct >= 80 ? colors.statusWarning : colors.accent }} />
              </View>
            </View>
          ) : null}
          {model.workspaceName !== null ? <Row colors={colors} caption={text("drawerWorkspace")} value={model.workspaceName} /> : null}
          {model.workspaceKindKey !== null ? <Row colors={colors} caption={text("drawerKind")} value={text(model.workspaceKindKey)} /> : null}
          {model.diff !== null ? <Row colors={colors} caption={text("drawerLines")} value={text("drawerLinesValue", { additions: model.diff.additions, deletions: model.diff.deletions })} /> : null}
          {model.toolCalls.map((entry, index) => (
            <Row key={index} colors={colors} caption={index === 0 ? text("drawerToolCalls") : ""} value={`${text(entry.key)} ${entry.count}`} />
          ))}
          {model.cost !== null ? <Row colors={colors} caption={text("drawerCost")} value={model.cost} /> : null}
          {model.age !== null ? <Row colors={colors} caption={text("drawerAge")} value={text(model.age.key, { count: model.age.count })} /> : null}
        </Card>

        <Card colors={colors} heading={text("drawerSectionActivity")}>
          {model.statusKey !== null ? <Row colors={colors} caption={text("drawerStatus")} value={text(model.statusKey)} /> : null}
          {model.toolKey !== null ? <Row colors={colors} caption={text("drawerTool")} value={text(model.toolKey)} /> : null}
          <Text style={{ color: colors.foreground, fontSize: 11 }}>{text(model.activityKey)}</Text>
        </Card>

        <Card colors={colors} heading={text("drawerSectionTodos")}>
          {model.todos.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text(model.todoEmptyKey)}</Text> : null}
          {model.todos.map((todo, index) => (
            <Row key={index} colors={colors} caption={todo.statusKey !== null ? text(todo.statusKey) : ""} value={todo.text} />
          ))}
          {model.hiddenTodos > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("drawerMoreItems", { count: model.hiddenTodos })}</Text> : null}
        </Card>

        <Card colors={colors} heading={text("drawerSectionChildren")}>
          {model.children.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("drawerNoChildren")}</Text> : null}
          {model.children.map((child, index) => (
            <Row key={index} colors={colors} caption={child.statusKey !== null ? text(child.statusKey) : ""} value={child.label ?? text("sidebarUntitledAgent")} />
          ))}
          {model.hiddenChildren > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("drawerMoreItems", { count: model.hiddenChildren })}</Text> : null}
        </Card>

        <Card colors={colors} heading={text("drawerSectionError")}>
          {model.lastError !== null ? (
            <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{model.lastError}</Text>
          ) : (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("drawerNoError")}</Text>
          )}
        </Card>

        {hasDetails ? (
          <Card colors={colors} heading={text("drawerSectionDetails")}>
            {model.attentionKey !== null ? <Row colors={colors} caption={text("drawerAttention")} value={text(model.attentionKey)} /> : null}
            {model.permissions > 0 ? <Row colors={colors} caption={text("drawerPermissions")} value={String(model.permissions)} /> : null}
            {model.provider !== null ? <Row colors={colors} caption={text("drawerProvider")} value={model.provider} /> : null}
            {model.model !== null ? <Row colors={colors} caption={text("drawerModel")} value={model.model} /> : null}
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
