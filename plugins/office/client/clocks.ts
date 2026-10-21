// No upstream: written for plan 07-08.
// The shared frame clocks of the office (OFFC-09, D-01): one timer and four Animated values however many characters are drawn.
import { useEffect } from "react";
import { Animated } from "react-native";
import { createSharedClock } from "./life/bank.ts";

const shared = createSharedClock<Animated.Value>({
  makeValue: (initial) => new Animated.Value(initial),
  setIntervalFn: (fn, ms) => setInterval(fn, ms),
  clearIntervalFn: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
});

// The clock values indexed by tier; the first mounted user starts the timer and the last one to unmount clears it.
export function useClock(): readonly Animated.Value[] {
  useEffect(() => {
    shared.acquire();
    return () => {
      shared.release();
    };
  }, []);
  return shared.bank().values;
}
