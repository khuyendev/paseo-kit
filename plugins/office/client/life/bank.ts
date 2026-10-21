// No upstream: written for plan 07-08.
// Shared frame clocks (OFFC-09, D-01): a bank of CLOCK_TIER_COUNT values advanced by one tick function, and a ref-counted owner of the one timer.
import { CLOCK_CYCLE, CLOCK_TICKS_PER_FRAME, CLOCK_TICK_MS, CLOCK_TIER_COUNT } from "../limits-life.ts";

// The only thing the bank asks of a clock value.
export interface ClockValue {
  setValue(value: number): void;
}

export interface ClockBank<V extends ClockValue = ClockValue> {
  readonly values: readonly V[];
  readonly ticks: number;
  tick(): void;
}

// One value per tier; a tier gets setValue only when its frame number changes.
export function createClockBank<V extends ClockValue>(makeValue: (initial: number) => V): ClockBank<V> {
  const values: V[] = Array.from({ length: CLOCK_TIER_COUNT }, () => makeValue(0));
  const phases: number[] = Array.from({ length: CLOCK_TIER_COUNT }, () => 0);
  let ticks = 0;
  return {
    values,
    get ticks() {
      return ticks;
    },
    tick() {
      ticks++;
      for (let tier = 0; tier < CLOCK_TIER_COUNT; tier++) {
        const phase = Math.floor(ticks / CLOCK_TICKS_PER_FRAME[tier]) % CLOCK_CYCLE;
        if (phase === phases[tier]) continue;
        phases[tier] = phase;
        values[tier].setValue(phase);
      }
    },
  };
}

export interface SharedClockDeps<V extends ClockValue> {
  makeValue: (initial: number) => V;
  setIntervalFn: (fn: () => void, ms: number) => unknown;
  clearIntervalFn: (handle: unknown) => void;
}

export interface SharedClock<V extends ClockValue = ClockValue> {
  readonly count: number;
  // The bank, made on first use; asking for it starts no timer.
  bank(): ClockBank<V>;
  // Counts one more user; the first user starts the timer.
  acquire(): ClockBank<V>;
  // Counts one user less; the last one clears the timer; an extra release changes nothing.
  release(): void;
}

export function createSharedClock<V extends ClockValue>(deps: SharedClockDeps<V>): SharedClock<V> {
  let bank: ClockBank<V> | null = null;
  let count = 0;
  let timer: unknown = null;
  const ensure = (): ClockBank<V> => {
    if (bank === null) bank = createClockBank(deps.makeValue);
    return bank;
  };
  return {
    get count() {
      return count;
    },
    bank: ensure,
    acquire() {
      const shared = ensure();
      count++;
      if (count === 1) timer = deps.setIntervalFn(() => shared.tick(), CLOCK_TICK_MS);
      return shared;
    },
    release() {
      if (count === 0) return;
      count--;
      if (count === 0 && timer !== null) {
        deps.clearIntervalFn(timer);
        timer = null;
      }
    },
  };
}
