import { describe, expect, it } from 'vitest';
import { createState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { createTimeline, keyframeAtOrBefore, recordKeyframe } from '../src/sim/timeline';
import { livingWorld } from './fixtures';

describe('timeline (§17)', () => {
  it('stores keyframes at year 0 and every 200 years, at month 0', () => {
    const live = createState(livingWorld(11, 'slow'));
    const tl = createTimeline(live);
    while (live.year < 650) { tick(live); recordKeyframe(tl, live); }
    expect(tl.keyframes.map((k) => [k.year, k.month])).toEqual([[0, 0], [200, 0], [400, 0], [600, 0]]);
    expect(keyframeAtOrBefore(tl, 399).year).toBe(200);
    expect(keyframeAtOrBefore(tl, 400).year).toBe(400);
  });

  it('viewing year 250 and playing forward reaches exactly the live state', () => {
    const live = createState(livingWorld(48213, 'strong'));
    const tl = createTimeline(live);
    let hash250 = '';
    while (live.year < 450) {
      tick(live);
      recordKeyframe(tl, live);
      if (live.year === 250 && live.month === 0) hash250 = hashState(live);
    }
    for (let k = 0; k < 5; k++) tick(live); // live is mid-year: year 450, month 5

    // Rebuild year 250 from the nearest keyframe (200), as the worker does.
    const view = cloneState(keyframeAtOrBefore(tl, 250));
    expect(view.year).toBe(200);
    while (!(view.year === 250 && view.month === 0)) tick(view);
    expect(hashState(view)).toBe(hash250);

    // Play forward until the view catches up with live.
    while (!(view.year === live.year && view.month === live.month)) tick(view);
    expect(hashState(view)).toBe(hashState(live));
  });

  it('viewing never changes the live state or keyframes', () => {
    const live = createState(livingWorld(2, 'slow'));
    const tl = createTimeline(live);
    while (live.year < 250) { tick(live); recordKeyframe(tl, live); }
    const liveHash = hashState(live);
    const kfHash = hashState(tl.keyframes[1]!);
    const view = cloneState(keyframeAtOrBefore(tl, 220));
    while (view.year < 240) tick(view);
    expect(hashState(live)).toBe(liveHash);
    expect(hashState(tl.keyframes[1]!)).toBe(kfHash);
  });
});
