// No upstream: written for plan 07-11.
// The office scene as a function of prepared props (OFFC-06, OFFC-11, OFFC-17, OFFC-21, D-04): one container holding the base layers,
// the characters, the front layers, the signs, labels and surplus badges, and the effects. It holds no state and reads no store.
import { View } from "react-native";
import type { Dir, Pose, ZoomCandidate } from "../shared/art-types.ts";
import type { AttentionReason, WorkspaceKind } from "../shared/model-types.ts";
import type { TintSource } from "./atmosphere.tsx";
import { SCENE_Z_EFFECT, SCENE_Z_FRONT, SCENE_Z_SEATED_BASE, SCENE_Z_WALKER, type VisibleLayer } from "./camera.ts";
import { CharacterSprite } from "./character.tsx";
import { EffectLayer, type EffectLayerProps } from "./effects.tsx";
import type { EffectPlacement } from "./effects.ts";
import type { CharacterSheet } from "./life/frames.ts";
import { footPx } from "./life/frames.ts";
import type { Journey } from "./life/journey.ts";
import type { LightState } from "./model.ts";
import type { TilePoint } from "../shared/path/grid.ts";
import { ClusterSign, LayerView, RoomLabel, SurplusBadge, type SceneColors } from "./room.tsx";
import { CHAR_H, CHAR_W } from "../shared/art-types.ts";

export interface SceneLayerData {
  layer: VisibleLayer;
  base: readonly (TintSource | null)[];
  front: readonly (TintSource | null)[];
}

export interface SceneCharacterData {
  key: string;
  sheets: readonly CharacterSheet[];
  pose: Pose;
  dir: Dir;
  at: TilePoint;
  journey: Journey | null;
  sheetZoom: ZoomCandidate;
  isChild: boolean;
  attention: AttentionReason | null;
  onJourneyEnd: () => void;
  onPress: () => void;
}

export interface SceneSignData {
  tile: TilePoint;
  name: string | null;
  kind: WorkspaceKind | null;
  light: LightState;
  additions: number | null;
  deletions: number | null;
}

export interface SceneLabelData {
  tile: TilePoint;
  name: string | null;
}

export interface SceneSurplusData {
  tile: TilePoint;
  count: number;
}

export interface SceneProps {
  size: { w: number; h: number };
  zoom: ZoomCandidate;
  // Day position: the fraction between two tint variants.
  position: number;
  layers: readonly SceneLayerData[];
  characters: readonly SceneCharacterData[];
  signs: readonly SceneSignData[];
  labels: readonly SceneLabelData[];
  surplus: readonly SceneSurplusData[];
  effects: readonly EffectPlacement[];
  colors: SceneColors;
  onEffectDone: (id: string) => void;
  // Burst durations; the default is the table of the atmosphere limits.
  effectDurationMs?: EffectLayerProps["durationMs"];
}

const BADGE_PX = 6;
const DOT_PX = 6;

const ATTENTION_COLOR: Readonly<Record<AttentionReason, keyof SceneColors>> = { finished: "statusSuccess", error: "statusDanger", permission: "statusWarning" };

export function Scene(props: SceneProps) {
  const { size, zoom, position, layers, characters, signs, labels, surplus, effects, colors, onEffectDone, effectDurationMs } = props;
  return (
    <View testID="office-scene" style={{ position: "relative", width: size.w, height: size.h }}>
      {layers.map((entry, index) => (
        <LayerView key={`base-${index}`} testID={`office-base-${index}`} layer={entry.layer} zoom={zoom} sources={entry.base} position={position} zIndex={0} />
      ))}
      {characters.map((c, index) => {
        if (c.sheets.length === 0) return null;
        const frameW = CHAR_W * c.sheetZoom;
        const attentionColor = c.attention !== null && Object.hasOwn(ATTENTION_COLOR, c.attention) ? colors[ATTENTION_COLOR[c.attention]] : null;
        return (
          <CharacterSprite
            key={c.key}
            testID={`office-char-${index}`}
            sheets={c.sheets}
            zoom={zoom}
            sheetZoom={c.sheetZoom}
            pose={c.pose}
            dir={c.dir}
            at={c.at}
            journey={c.journey}
            onJourneyEnd={c.onJourneyEnd}
            onPress={c.onPress}
            zIndex={c.journey ? SCENE_Z_WALKER : SCENE_Z_SEATED_BASE + footPx(c.at).y}
          >
            {c.isChild ? <View testID={`office-char-badge-${index}`} style={{ position: "absolute", left: frameW - BADGE_PX, top: CHAR_H * c.sheetZoom - BADGE_PX, width: BADGE_PX, height: BADGE_PX, backgroundColor: colors.accent }} /> : null}
            {attentionColor !== null ? <View testID={`office-char-attention-${index}`} style={{ position: "absolute", left: 0, top: 0, width: DOT_PX, height: DOT_PX, borderRadius: DOT_PX / 2, backgroundColor: attentionColor }} /> : null}
          </CharacterSprite>
        );
      })}
      {layers.map((entry, index) => (
        <LayerView key={`front-${index}`} testID={`office-front-${index}`} layer={entry.layer} zoom={zoom} sources={entry.front} position={position} zIndex={SCENE_Z_FRONT} />
      ))}
      {signs.map((s, index) => (
        <ClusterSign key={`sign-${index}`} testID={`office-sign-${index}`} tile={s.tile} zoom={zoom} name={s.name} kind={s.kind} light={s.light} additions={s.additions} deletions={s.deletions} colors={colors} />
      ))}
      {labels.map((l, index) => (
        <RoomLabel key={`label-${index}`} testID={`office-label-${index}`} tile={l.tile} zoom={zoom} name={l.name} colors={colors} />
      ))}
      {surplus.map((s, index) => (
        <SurplusBadge key={`surplus-${index}`} testID={`office-surplus-${index}`} tile={s.tile} zoom={zoom} count={s.count} colors={colors} />
      ))}
      <View style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, zIndex: SCENE_Z_EFFECT, pointerEvents: "none" }}>
        <EffectLayer effects={effects} zoom={zoom} onDone={onEffectDone} durationMs={effectDurationMs} />
      </View>
    </View>
  );
}
