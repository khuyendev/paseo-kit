// Effect layer (OFFC-18, D-05): one-shot confetti and ring bursts, each driven by one Animated.Value through transform and opacity only (PANL-50 pattern).
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import { RING_COLORS, particlesFor, type EffectPlacement } from "./effects.ts";
import {
  EFFECT_DURATION_MS,
  EFFECT_FADE_FROM,
  EFFECT_MAX_ACTIVE,
  EFFECT_RING_PX,
  EFFECT_RING_START_SCALE,
  EFFECT_RISE_AT,
  EFFECT_ZOOM_FALLBACK,
  type EffectKind,
} from "./limits-atmosphere.ts";

export interface EffectLayerProps {
  effects: readonly EffectPlacement[];
  zoom: number;
  onDone: (id: string) => void;
  durationMs?: Readonly<Record<EffectKind, number>>;
}

const NATIVE_DRIVER = Platform.OS !== "web";

interface BurstProps {
  placement: EffectPlacement;
  index: number;
  zoom: number;
  durationMs: Readonly<Record<EffectKind, number>>;
  onDone: (id: string) => void;
}

function Burst({ placement, index, zoom, durationMs, onDone }: BurstProps) {
  const progress = useRef<Animated.Value | null>(null);
  if (progress.current === null) progress.current = new Animated.Value(0);
  const value = progress.current;
  const latestDone = useRef(onDone);
  latestDone.current = onDone;
  const { id, kind } = placement;
  useEffect(() => {
    const wanted = durationMs[kind];
    const duration = typeof wanted === "number" && Number.isFinite(wanted) && wanted >= 0 ? wanted : EFFECT_DURATION_MS[kind];
    const animation = Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
    animation.start((result) => {
      if (result.finished) latestDone.current(id);
    });
    return () => animation.stop();
    // Mount-only: a burst plays once for its placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const particles = useMemo(() => particlesFor({ id, kind }), [id, kind]);
  const ringRadius = EFFECT_RING_PX[kind] * zoom;
  const nodes = useMemo(
    () =>
      particles.map((p, n) => {
        const size = p.size * zoom;
        return {
          key: n,
          style: {
            position: "absolute" as const,
            left: -size / 2,
            top: -size / 2,
            width: size,
            height: size,
            backgroundColor: p.color,
            opacity: value.interpolate({ inputRange: [0, EFFECT_FADE_FROM, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx * zoom] }) },
              { translateY: value.interpolate({ inputRange: [0, EFFECT_RISE_AT, 1], outputRange: [0, -p.rise * zoom, p.fall * zoom] }) },
              { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
            ],
          },
        };
      }),
    [particles, zoom, value],
  );
  return (
    <View testID={`office-fx-burst-${index}`} style={{ position: "absolute", left: placement.x, top: placement.y, width: 0, height: 0 }}>
      <Animated.View
        testID={`office-fx-ring-${index}`}
        style={{
          position: "absolute",
          left: -ringRadius,
          top: -ringRadius,
          width: ringRadius * 2,
          height: ringRadius * 2,
          borderRadius: ringRadius,
          borderWidth: zoom,
          borderColor: RING_COLORS[kind],
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [EFFECT_RING_START_SCALE, 1] }) }],
        }}
      />
      {nodes.map((node) => (
        <Animated.View key={node.key} testID={`office-fx-particle-${index}-${node.key}`} style={node.style} />
      ))}
    </View>
  );
}

export function EffectLayer({ effects, zoom, onDone, durationMs = EFFECT_DURATION_MS }: EffectLayerProps) {
  const drawZoom = typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : EFFECT_ZOOM_FALLBACK;
  const seen = new Set<string>();
  const unique: EffectPlacement[] = [];
  for (const placement of effects) {
    if (seen.has(placement.id)) continue;
    seen.add(placement.id);
    unique.push(placement);
  }
  const shown = unique.slice(Math.max(0, unique.length - EFFECT_MAX_ACTIVE));
  if (shown.length === 0) return null;
  return (
    <View testID="office-fx" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
      {shown.map((placement, index) => (
        <Burst key={placement.id} placement={placement} index={index} zoom={drawZoom} durationMs={durationMs} onDone={onDone} />
      ))}
    </View>
  );
}
