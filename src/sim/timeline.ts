// Keyframes for viewing the past (§17.2). A keyframe is a copy of the state at month 0
// of year Y; replaying ticks from it reproduces history exactly (determinism, §16).

import { CONFIG } from '../config';
import type { SimState } from './state';
import { cloneState, stateBytes } from './serialize';

export interface Timeline {
  keyframes: SimState[];         // ascending by year; keyframes[0] is year 0
  interval: number;              // years between keyframes (doubles under memory pressure)
}

export function createTimeline(start: SimState): Timeline {
  return { keyframes: [cloneState(start)], interval: CONFIG.timeline.keyframeEveryYears };
}

/** Call after every live tick: stores a keyframe at month 0 of every `interval`-th year. */
export function recordKeyframe(tl: Timeline, s: SimState): void {
  if (s.month !== 0 || s.year === 0 || s.year % tl.interval !== 0) return;
  const last = tl.keyframes[tl.keyframes.length - 1]!;
  if (last.year >= s.year) return;
  tl.keyframes.push(cloneState(s));
  enforceMemoryCap(tl);
}

/** Over the cap: keep year 0 and every other keyframe, so the interval doubles. */
function enforceMemoryCap(tl: Timeline): void {
  const cap = CONFIG.timeline.memoryCapMB * 1024 * 1024;
  const per = stateBytes(tl.keyframes[0]!);
  while (tl.keyframes.length * per > cap && tl.keyframes.length > 2) {
    tl.interval *= 2;
    tl.keyframes = tl.keyframes.filter((k) => k.year === 0 || k.year % tl.interval === 0);
  }
}

/** The latest keyframe at or before `year`. */
export function keyframeAtOrBefore(tl: Timeline, year: number): SimState {
  let best = tl.keyframes[0]!;
  for (const k of tl.keyframes) if (k.year <= year) best = k;
  return best;
}
