// FCLOCK: a virtual clock implementing the kit clock contract {now, sleep, setTimeout, clearTimeout}.
// auto: sleep() jumps virtual time at once (resolving on the next macrotask); otherwise time moves only by advance().

const macrotask = () => new Promise((resolve) => setImmediate(resolve));

export function createFakeClock({ start = Date.UTC(2026, 9, 20), auto = true } = {}) {
  let now = start;
  let seq = 0;
  const timers = [];

  async function advanceTo(target) {
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.fn();
      await macrotask();
    }
    now = Math.max(now, target);
  }

  const clock = {
    auto,
    sleeps: [],
    now: () => now,
    setTimeout(fn, ms) {
      const timer = { at: now + Math.max(0, ms), fn, id: ++seq };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const i = timers.indexOf(timer);
      if (i >= 0) timers.splice(i, 1);
    },
    async sleep(ms) {
      clock.sleeps.push(ms);
      if (!clock.auto) return new Promise((resolve) => clock.setTimeout(resolve, ms));
      await macrotask();
      await advanceTo(now + ms);
    },
    advance: (ms) => advanceTo(now + ms),
    pending: () => timers.length,
  };
  return clock;
}
