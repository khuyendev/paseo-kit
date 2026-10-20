// Shared animation clocks (PANL-50): four looping 0 -> 1 values drive every continuous animation, so the number
// of looping Animated values stays 4 however many agents are drawn. Only transform and opacity are animated.
import { createContext, useContext, useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";

export const NATIVE_DRIVER = Platform.OS !== "web";

export const CLOCK_PERIODS_MS = { flow: 1600, pulse: 2200, spin: 9000, blink: 1000 } as const;
export type Clocks = Record<keyof typeof CLOCK_PERIODS_MS, Animated.Value>;

export const ClockContext = createContext<Clocks | null>(null);

export function useClocks(): Clocks {
  const clocks = useContext(ClockContext);
  if (!clocks) throw new Error("swarm map: ClockContext is missing");
  return clocks;
}

export function useClockSource(): Clocks {
  const ref = useRef<Clocks | null>(null);
  if (!ref.current) ref.current = { flow: new Animated.Value(0), pulse: new Animated.Value(0), spin: new Animated.Value(0), blink: new Animated.Value(0) };
  useEffect(() => {
    const c = ref.current!;
    const loops = (Object.keys(CLOCK_PERIODS_MS) as (keyof Clocks)[]).map((k) =>
      Animated.loop(Animated.timing(c[k], { toValue: 1, duration: CLOCK_PERIODS_MS[k], easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }), {
        resetBeforeIteration: true,
      }),
    );
    for (const l of loops) l.start();
    return () => {
      for (const l of loops) l.stop();
    };
  }, []);
  return ref.current;
}

// 0 -> 1 once on mount after delayMs; with play=false the value starts at 1.
export function useAppear(play: boolean, delayMs = 0, spring = false): Animated.Value {
  const v = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    const anim = spring
      ? Animated.spring(v, { toValue: 1, friction: 5, tension: 70, delay: delayMs, useNativeDriver: NATIVE_DRIVER })
      : Animated.timing(v, { toValue: 1, duration: 450, delay: delayMs, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
    // Mount-only animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

// Follows a number smoothly (e.g. context use 0..1).
export function useSmooth(value: number): Animated.Value {
  const v = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: value, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
  }, [v, value]);
  return v;
}

// One-shot 0 -> 1 on mount; calls onDone when it finishes.
export function useOneShot(durationMs: number, onDone: () => void): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: durationMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE_DRIVER });
    anim.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => anim.stop();
    // Mount-only animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

// A phase-shifted copy of a clock: (clock + offset) mod 1.
export function shifted(clock: Animated.Value, offset: number): Animated.AnimatedInterpolation<number> | Animated.Value {
  if (offset === 0) return clock;
  return Animated.modulo(Animated.add(clock, offset), 1) as unknown as Animated.AnimatedInterpolation<number>;
}
