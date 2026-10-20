// Links and one-shot effects drawn with rotated Views (no SVG in the plugin host, PANL-06, PANL-50).
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Animated, Text, View } from "react-native";
import { shifted, useClocks, useOneShot } from "./anim.ts";
import { type Point, polylineLength } from "./geometry.ts";
import type { Colors } from "./palette.ts";

function Segment({ a, b, color, thickness, opacity }: { a: Point; b: Point; color: string; thickness: number; opacity: number }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - thickness / 2,
        width: len,
        height: thickness,
        borderRadius: thickness / 2,
        backgroundColor: color,
        opacity,
        transform: [{ rotate: `${angle}rad` }],
      }}
    />
  );
}

export function Link({ points, color, active, dim, thickness = 2 }: { points: Point[]; color: string; active: boolean; dim?: boolean; thickness?: number }) {
  const opacity = dim ? 0.25 : active ? 0.85 : 0.5;
  return (
    <>
      {points.slice(1).map((p, i) => (
        <Segment key={i} a={points[i]} b={p} color={color} thickness={thickness} opacity={opacity} />
      ))}
    </>
  );
}

// Position along a polyline driven by a 0..1 phase.
function travel(points: Point[], phase: Animated.Value | Animated.AnimatedInterpolation<number>) {
  const total = polylineLength(points) || 1;
  const stops = [0];
  for (let i = 1; i < points.length; i += 1) stops.push(stops[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / total);
  stops[stops.length - 1] = 1;
  const inputRange = stops.map((s, i) => (i > 0 && s <= stops[i - 1] ? stops[i - 1] + 1e-6 : s));
  return {
    x: phase.interpolate({ inputRange, outputRange: points.map((p) => p.x) }),
    y: phase.interpolate({ inputRange, outputRange: points.map((p) => p.y) }),
  };
}

export function FlowDots({ points, color, count, size, offset = 0 }: { points: Point[]; color: string; count: number; size: number; offset?: number }) {
  const { flow } = useClocks();
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const pos = travel(points, shifted(flow, (i / count + offset) % 1));
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ translateX: pos.x }, { translateY: pos.y }] }}
          />
        );
      })}
    </>
  );
}

export interface PacketSpec {
  points: Point[];
  durationMs: number;
  hue: string;
  icon: string;
  text: string;
  small?: boolean;
}

export function Packet({ spec, c, onDone }: { spec: PacketSpec; c: Colors; onDone: () => void }) {
  const t = useOneShot(spec.durationMs, onDone);
  const pos = travel(spec.points, t);
  const size = spec.small ? 18 : 24;
  const opacity = t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", left: -size / 2, top: -size / 2, flexDirection: "row", alignItems: "center", gap: 4, opacity, transform: [{ translateX: pos.x }, { translateY: pos.y }] }}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: spec.hue, backgroundColor: c.surface1, alignItems: "center", justifyContent: "center" }}>
        <Icon name={spec.icon} size={spec.small ? 10 : 13} color={spec.hue} />
      </View>
      {spec.text ? (
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 10, maxWidth: 180, backgroundColor: c.surface1, paddingHorizontal: 4, borderRadius: 4 }}>
          {spec.text}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function Burst({ x, y, r, hue, onDone }: { x: number; y: number; r: number; hue: string; onDone: () => void }) {
  const t = useOneShot(700, onDone);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 3, borderColor: hue, opacity, transform: [{ scale }] }}
    />
  );
}

export function Sparks({ x, y, hue, onDone }: { x: number; y: number; hue: string; onDone: () => void }) {
  const t = useOneShot(900, onDone);
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const tx = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * 46] });
        const ty = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * 46] });
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{ position: "absolute", left: x - 3, top: y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: hue, opacity, transform: [{ translateX: tx }, { translateY: ty }] }}
          />
        );
      })}
    </>
  );
}
