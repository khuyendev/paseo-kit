// No upstream: written for the HUD of the office.
// Search (step D): a text field that filters the project list and finds agents by generated name or title; choosing a result hands its
// id to the parent, which selects the agent and moves the camera. Read-only: no other action. The query never reaches a uri or a style.
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import type { SearchResult } from "./hud.ts";
import { SEARCH_QUERY_MAX_CHARS } from "./limits-panels.ts";
import type { PanelColors } from "./sidebar.tsx";
import { text } from "./strings.ts";

// The field is mounted on demand: a "Search" button opens it and closing it clears the query.
export function SearchBox(props: { open: boolean; query: string; results: readonly SearchResult[]; colors: PanelColors; onOpen: (open: boolean) => void; onQuery: (query: string) => void; onPick: (agentId: string) => void }) {
  const { open, query, results, colors, onOpen, onQuery, onPick } = props;
  if (!open) {
    return (
      <View style={{ padding: 8, paddingBottom: 0 }}>
        <Pressable testID="office-search-open" accessibilityRole="button" accessibilityLabel={text("searchLabel")} onPress={() => onOpen(true)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text("searchPlaceholder")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ padding: 8, paddingBottom: 0, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <TextInput
        testID="office-search"
        value={query}
        onChangeText={(value: string) => onQuery(typeof value === "string" ? value.slice(0, SEARCH_QUERY_MAX_CHARS) : "")}
        placeholder={text("searchPlaceholder")}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={text("searchLabel")}
        autoCorrect={false}
        autoFocus
        style={{ flex: 1, color: colors.foreground, fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 }}
      />
        <Pressable testID="office-search-close" accessibilityRole="button" accessibilityLabel={text("searchClose")} onPress={() => onOpen(false)} style={{ paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text("searchCloseGlyph")}</Text>
        </Pressable>
      </View>
      {query.trim() !== "" && results.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{text("searchNoMatch")}</Text> : null}
      {results.map((result, index) => (
        <Pressable key={`${index}:${result.agentId}`} testID="office-search-result" accessibilityRole="button" onPress={() => onPick(result.agentId)} style={{ flexDirection: "row", gap: 6, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 6, backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.foreground, fontSize: 11 }}>{result.name}</Text>
          {result.label !== null ? (
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1 }}>
              {result.label}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
