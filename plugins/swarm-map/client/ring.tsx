// Circular progress ring from two clipped half-rings (no SVG in the plugin host, PANL-06). A circle with coloured
// top and right borders spans -45..135 degrees; rotating it and clipping to one half shows the wanted arc.
import { Animated, View } from "react-native";

function HalfRing({ size, thickness, hue, rotate }: { size: number; thickness: number; hue: string; rotate: Animated.AnimatedInterpolation<string> }) {
  return (
    <Animated.View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: thickness,
        borderTopColor: hue,
        borderRightColor: hue,
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        transform: [{ rotate }],
      }}
    />
  );
}

export function Ring({ size, thickness, progress, hue, track }: { size: number; thickness: number; progress: Animated.Value; hue: string; track: string }) {
  const half = size / 2;
  const right = progress.interpolate({ inputRange: [0, 0.5], outputRange: ["-135deg", "45deg"], extrapolate: "clamp" });
  const left = progress.interpolate({ inputRange: [0.5, 1], outputRange: ["45deg", "225deg"], extrapolate: "clamp" });
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={{ position: "absolute", width: size, height: size, borderRadius: half, borderWidth: thickness, borderColor: track }} />
      <View style={{ position: "absolute", left: half, width: half, height: size, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: -half, width: size, height: size }}>
          <HalfRing size={size} thickness={thickness} hue={hue} rotate={right} />
        </View>
      </View>
      <View style={{ position: "absolute", left: 0, width: half, height: size, overflow: "hidden" }}>
        <HalfRing size={size} thickness={thickness} hue={hue} rotate={left} />
      </View>
    </View>
  );
}
