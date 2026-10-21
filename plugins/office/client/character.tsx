// No upstream: written for plan 07-08.
// One character as a clipped frame over a whole server sheet (OFFC-09, D-01): frames step by transform on the shared clocks, journeys move it by transform.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { ZOOM_CANDIDATES } from "../shared/art-types.ts";
import type { Dir, Pose, ZoomCandidate } from "../shared/art-types.ts";
import { useClock } from "./clocks.ts";
import { footPx, frameOrigin, restPoseOf, rowOffset, sheetFor, sheetWindow, tierOf, xRamp } from "./life/frames.ts";
import type { CharacterSheet } from "./life/frames.ts";
import type { Journey } from "./life/journey.ts";
import { runJourney } from "./life/runner.ts";
import type { JourneyEnv } from "./life/runner.ts";
import type { TilePoint } from "../shared/path/grid.ts";

const NATIVE_DRIVER = Platform.OS !== "web";

export interface CharacterSpriteProps {
  sheets: readonly CharacterSheet[];
  zoom: ZoomCandidate;
  // Zoom of the loaded sheets for a smaller character standing on the same foot pixel; defaults to zoom and may not exceed it.
  sheetZoom?: ZoomCandidate;
  pose: Pose;
  dir: Dir;
  at: TilePoint;
  journey?: Journey | null;
  onJourneyEnd?: () => void;
  onPress?: () => void;
  zIndex?: number;
  testID?: string;
  children?: ReactNode;
}

// Pose and direction a running journey sets at its step boundaries; the only React state of the component.
interface Phase {
  pose: Pose;
  dir: Dir;
}

const isZoom = (value: number): boolean => (ZOOM_CANDIDATES as readonly number[]).includes(value);

export function CharacterSprite(props: CharacterSpriteProps) {
  const { sheets, zoom, pose, dir, at, journey, onPress, zIndex, testID, children } = props;
  const sheetZoom = props.sheetZoom ?? zoom;
  const valid = isZoom(zoom) && isZoom(sheetZoom) && sheetZoom <= zoom;
  const clocks = useClock();
  const [phase, setPhase] = useState<Phase | null>(null);

  const originRef = useRef<Animated.ValueXY | null>(null);
  const opacityRef = useRef<Animated.Value | null>(null);
  if (originRef.current === null) {
    const origin = valid ? frameOrigin(footPx(at), zoom, sheetZoom) : { left: 0, top: 0 };
    originRef.current = new Animated.ValueXY({ x: origin.left, y: origin.top });
  }
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(journey?.steps[0]?.kind === "appear" ? 0 : 1);
  const origin = originRef.current;
  const opacity = opacityRef.current;

  // Latest props for the journey closures, so a changed callback or zoom never restarts a journey.
  const latest = useRef({ zoom, sheetZoom, onJourneyEnd: props.onJourneyEnd });
  latest.current = { zoom, sheetZoom, onJourneyEnd: props.onJourneyEnd };
  const goneRef = useRef(false);

  const shownPose = phase?.pose ?? pose;
  const shownDir = phase?.dir ?? dir;
  const shown = useMemo(() => {
    if (!valid) return null;
    const sheet = sheetFor(sheets, shownPose);
    if (sheet) return { sheet, pose: shownPose };
    const first = sheets[0];
    return first ? { sheet: first, pose: restPoseOf(first) } : null;
  }, [valid, sheets, shownPose]);

  const shownTier = shown ? tierOf(shown.pose) : 0;
  const frameX = useMemo(() => {
    if (!shown) return null;
    return clocks[shownTier].interpolate({ ...xRamp(shown.pose, sheetZoom), extrapolate: "clamp" });
  }, [shown?.pose, shownTier, sheetZoom, clocks]);

  // No journey running: stand on the foot pixel of the tile; a departed character stays hidden until the next journey.
  useEffect(() => {
    if (journey || !valid) return;
    const target = frameOrigin(footPx(at), zoom, sheetZoom);
    origin.setValue({ x: target.left, y: target.top });
    if (!goneRef.current) opacity.setValue(1);
  }, [at.x, at.y, zoom, sheetZoom, journey, valid]);

  useEffect(() => {
    if (!journey || !valid) {
      setPhase(null);
      return undefined;
    }
    goneRef.current = false;
    const last = journey.steps[journey.steps.length - 1];
    const toOrigin = (foot: { x: number; y: number }) => {
      const target = frameOrigin(foot, latest.current.zoom, latest.current.sheetZoom);
      return { x: target.left, y: target.top };
    };
    const animate = (value: Animated.Value | Animated.ValueXY, toValue: number | { x: number; y: number }, ms: number, done: () => void) => {
      const handle = Animated.timing(value as Animated.Value, { toValue: toValue as number, duration: ms, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
      handle.start((result) => {
        if (result.finished) done();
      });
      return () => handle.stop();
    };
    const env: JourneyEnv = {
      place: (foot) => origin.setValue(toOrigin(foot)),
      setOpacity: (value) => opacity.setValue(value),
      moveTo: (foot, ms, done) => animate(origin, toOrigin(foot), ms, done),
      fade: (to, ms, done) => animate(opacity, to, ms, done),
      hold: (ms, done) => {
        const handle = Animated.delay(ms);
        handle.start((result) => {
          if (result.finished) done();
        });
        return () => handle.stop();
      },
    };
    const stop = runJourney(journey, env, {
      onPhase: (nextPose, nextDir) => setPhase({ pose: nextPose, dir: nextDir }),
      onEnd: () => {
        goneRef.current = last?.kind === "vanish";
        setPhase(null);
        latest.current.onJourneyEnd?.();
      },
    });
    return stop;
  }, [journey, valid]);

  if (!valid || !shown || !frameX) return null;
  const win = sheetWindow(shown.sheet.poses, sheetZoom);
  const frame = (
    <View style={{ width: win.frameW, height: win.frameH, overflow: "hidden" }}>
      <Animated.Image
        source={shown.sheet.source}
        style={
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: win.sheetW,
            height: win.sheetH,
            transform: [{ translateX: frameX }, { translateY: rowOffset(shown.sheet.poses, shown.pose, shownDir, sheetZoom) }],
          } as never
        }
      />
    </View>
  );
  return (
    <Animated.View
      testID={testID}
      style={
        {
          position: "absolute",
          left: 0,
          top: 0,
          opacity,
          ...(zIndex === undefined ? {} : { zIndex }),
          transform: [{ translateX: origin.x }, { translateY: origin.y }],
        } as never
      }
    >
      {onPress ? <Pressable onPress={onPress}>{frame}</Pressable> : frame}
      {children}
    </Animated.View>
  );
}
