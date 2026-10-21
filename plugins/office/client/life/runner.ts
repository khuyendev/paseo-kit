// No upstream: written for plan 07-08.
// Journey runner (OFFC-12): executes the steps of a journey in order against injected animation primitives, so it is tested without a host.
import type { Dir, Pose } from "../../shared/art-types.ts";
import { JOURNEY_MAX_STEPS } from "../limits-life.ts";
import { footPx } from "./frames.ts";
import type { Journey } from "./journey.ts";

type Px = { x: number; y: number };
type Stop = () => void;

export interface JourneyEnv {
  place(foot: Px): void;
  setOpacity(value: number): void;
  // The primitives below call done once when they finish and return a function that stops them.
  moveTo(foot: Px, ms: number, done: () => void): Stop;
  fade(to: number, ms: number, done: () => void): Stop;
  hold(ms: number, done: () => void): Stop;
}

export interface JourneyHandlers {
  onPhase(pose: Pose, dir: Dir): void;
  onEnd(): void;
}

// Runs the journey and returns a function that stops it; after it, no primitive and no onEnd is called.
export function runJourney(journey: Journey, env: JourneyEnv, handlers: JourneyHandlers): Stop {
  let stopped = false;
  let ended = false;
  let pending: Stop | null = null;

  const finish = (): void => {
    if (stopped || ended) return;
    ended = true;
    pending = null;
    handlers.onEnd();
  };

  if (journey.steps.length === 0 || journey.steps.length > JOURNEY_MAX_STEPS) {
    finish();
    return () => {};
  }

  // Starts one primitive; its done callback counts once and only while the run is live.
  const begin = (start: (done: () => void) => Stop, next: () => void): void => {
    let settled = false;
    const stop = start(() => {
      if (stopped || settled) return;
      settled = true;
      pending = null;
      next();
    });
    if (!settled && !stopped) pending = stop;
  };

  const runStep = (index: number): void => {
    if (stopped) return;
    if (index >= journey.steps.length) {
      finish();
      return;
    }
    const next = (): void => runStep(index + 1);
    const step = journey.steps[index];
    if (step.kind === "appear") {
      env.place(footPx(step.tile));
      env.setOpacity(0);
      handlers.onPhase("stand", step.dir);
      begin((done) => env.fade(1, step.ms, done), next);
    } else if (step.kind === "vanish") {
      begin((done) => env.fade(0, step.ms, done), next);
    } else if (step.kind === "wait") {
      handlers.onPhase(step.pose, step.dir);
      begin((done) => env.hold(step.ms, done), next);
    } else {
      const pose: Pose = step.run ? "run" : "walk";
      const segments = step.plan.segments;
      const leg = (i: number): void => {
        if (stopped) return;
        if (i >= segments.length) {
          next();
          return;
        }
        const segment = segments[i];
        handlers.onPhase(pose, segment.dir);
        begin((done) => env.moveTo({ x: segment.x, y: segment.y }, segment.ms, done), () => leg(i + 1));
      };
      leg(0);
    }
  };

  if (journey.steps[0].kind !== "appear") env.setOpacity(1);
  runStep(0);

  return () => {
    if (stopped) return;
    stopped = true;
    const stop = pending;
    pending = null;
    if (stop !== null) stop();
  };
}
