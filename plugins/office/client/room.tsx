// No upstream: written for plan 07-11.
// Room pieces of the scene (OFFC-06, OFFC-17, OFFC-21, D-04): a layer image slot with its tint cross-fade, the cluster sign, the room label and the exact surplus badge.
// Agent-provided text reaches the screen only as clipped Text children; positions and sizes come from tile numbers (OFFC-14).
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import { TILE } from "../shared/art-types.ts";
import type { WorkspaceKind } from "../shared/model-types.ts";
import { TintFade, type TintSource } from "./atmosphere.tsx";
import { SCENE_LABEL_FONT_PX, SCENE_SIGN_WIDTH_PX, SCENE_Z_LABEL, type VisibleLayer } from "./camera.ts";
import type { TilePoint } from "../shared/path/grid.ts";
import type { LightState } from "./model.ts";
import { LABEL_MAX_CHARS } from "./limits-panels.ts";
import { ROOM_DARK_OPACITY, ROOM_LIGHT_FADE_MS, ROOM_SHADE_COLOR } from "./limits-atmosphere.ts";
import type { TileRect } from "../shared/layout/types.ts";
import { WORKSPACE_KIND_KEY, clipText, text } from "./strings.ts";

export type SceneColors = Pick<PluginTheme["colors"], "surface1" | "surface2" | "border" | "foreground" | "foregroundMuted" | "accent" | "statusSuccess" | "statusWarning" | "statusDanger">;

// One colour per light state, so the five states differ on any theme.
export function lightColor(state: LightState, colors: SceneColors): string {
  switch (state) {
    case "waiting":
      return colors.statusWarning;
    case "failed":
      return colors.statusDanger;
    case "active":
      return colors.statusSuccess;
    case "alert":
      return colors.accent;
    case "idle":
      return colors.foregroundMuted;
  }
}

const LIGHT_PX = 8;
const SIGN_PAD_PX = 3;
const SIGN_GAP_PX = 4;

export interface LayerViewProps {
  layer: VisibleLayer;
  zoom: number;
  // Variants indexed by tint, null where not requested or not loaded.
  sources: readonly (TintSource | null)[];
  // Day position: the fraction between two variants is the cross-fade.
  position: number;
  testID: string;
  zIndex: number;
}

// An absolutely positioned, non-interactive slot at the layer's tile rect holding one tint cross-fade.
export function LayerView({ layer, zoom, sources, position, testID, zIndex }: LayerViewProps) {
  const width = layer.rect.w * TILE * zoom;
  const height = layer.rect.h * TILE * zoom;
  return (
    <View testID={testID} style={{ position: "absolute", left: layer.rect.x * TILE * zoom, top: layer.rect.y * TILE * zoom, width, height, zIndex, pointerEvents: "none" }}>
      <TintFade sources={sources} position={position} width={width} height={height} />
    </View>
  );
}

const pxOf = (tile: TilePoint, zoom: number): { left: number; top: number } => ({ left: tile.x * TILE * zoom, top: tile.y * TILE * zoom });

export interface ClusterSignProps {
  tile: TilePoint;
  zoom: number;
  name: string | null;
  kind: WorkspaceKind | null;
  light: LightState;
  additions: number | null;
  deletions: number | null;
  colors: SceneColors;
  testID: string;
}

// Workspace name, kind, status light and diff stat at the top-left of a cluster.
export function ClusterSign({ tile, zoom, name, kind, light, additions, deletions, colors, testID }: ClusterSignProps) {
  const shown = clipText(name, LABEL_MAX_CHARS);
  const kindKey = kind !== null && Object.hasOwn(WORKSPACE_KIND_KEY, kind) ? WORKSPACE_KIND_KEY[kind] : null;
  const diff = typeof additions === "number" && typeof deletions === "number" ? text("sceneDiff", { additions, deletions }) : null;
  return (
    <View
      testID={testID}
      style={{
        position: "absolute",
        ...pxOf(tile, zoom),
        maxWidth: SCENE_SIGN_WIDTH_PX,
        flexDirection: "row",
        alignItems: "center",
        gap: SIGN_GAP_PX,
        padding: SIGN_PAD_PX,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        zIndex: SCENE_Z_LABEL,
        pointerEvents: "none",
      }}
    >
      <View testID={`${testID}-light`} style={{ width: LIGHT_PX, height: LIGHT_PX, borderRadius: LIGHT_PX / 2, backgroundColor: lightColor(light, colors) }} />
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: SCENE_LABEL_FONT_PX, flexShrink: 1 }}>
        {shown === "" ? text("sidebarUnnamedWorkspace") : shown}
      </Text>
      {kindKey !== null ? <Text style={{ color: colors.foregroundMuted, fontSize: SCENE_LABEL_FONT_PX }}>{text(kindKey)}</Text> : null}
      {diff !== null ? <Text style={{ color: colors.foregroundMuted, fontSize: SCENE_LABEL_FONT_PX }}>{diff}</Text> : null}
    </View>
  );
}

export interface RoomLabelProps {
  tile: TilePoint;
  zoom: number;
  name: string | null;
  colors: SceneColors;
  testID: string;
}

// Project name at the top-left tile of a room.
export function RoomLabel({ tile, zoom, name, colors, testID }: RoomLabelProps) {
  const shown = clipText(name, LABEL_MAX_CHARS);
  return (
    <View testID={testID} style={{ position: "absolute", ...pxOf(tile, zoom), maxWidth: SCENE_SIGN_WIDTH_PX, zIndex: SCENE_Z_LABEL, pointerEvents: "none" }}>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: SCENE_LABEL_FONT_PX, fontWeight: "700" }}>
        {shown === "" ? text("sidebarUnnamedProject") : shown}
      </Text>
    </View>
  );
}

export interface SurplusBadgeProps {
  tile: TilePoint;
  zoom: number;
  count: number;
  colors: SceneColors;
  testID: string;
}

// The exact "+N agents" group of agents that no longer fit under the caps.
export function SurplusBadge({ tile, zoom, count, colors, testID }: SurplusBadgeProps) {
  return (
    <View
      testID={testID}
      style={{ position: "absolute", ...pxOf(tile, zoom), padding: SIGN_PAD_PX, borderRadius: 4, backgroundColor: colors.surface2, zIndex: SCENE_Z_LABEL, pointerEvents: "none" }}
    >
      <Text style={{ color: colors.foreground, fontSize: SCENE_LABEL_FONT_PX }}>{text("sceneSurplus", { count })}</Text>
    </View>
  );
}

const NATIVE_DRIVER = Platform.OS !== "web";

export interface RoomShadeProps {
  rect: TileRect;
  zoom: number;
  dark: boolean;
  testID: string;
  zIndex: number;
}

// The lights of a room: a non-interactive shade over its tile rect that fades in when the room is empty and out when someone is present.
export function RoomShade({ rect, zoom, dark, testID, zIndex }: RoomShadeProps) {
  const value = useRef<Animated.Value | null>(null);
  if (value.current === null) value.current = new Animated.Value(dark ? ROOM_DARK_OPACITY : 0);
  const opacity = value.current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const animation = Animated.timing(opacity, { toValue: dark ? ROOM_DARK_OPACITY : 0, duration: ROOM_LIGHT_FADE_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [dark]);
  return (
    <Animated.View
      testID={testID}
      style={{ position: "absolute", left: rect.x * TILE * zoom, top: rect.y * TILE * zoom, width: rect.w * TILE * zoom, height: rect.h * TILE * zoom, backgroundColor: ROOM_SHADE_COLOR, opacity, zIndex, pointerEvents: "none" } as never}
    />
  );
}
