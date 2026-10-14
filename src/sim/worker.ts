// Worker entry (§5, §9, §17, §22): owns the live simulation, the timeline and the
// past-view state; runs ticks paced by real time; posts frames to the main thread.

import { CONFIG } from '../config';
import { nowMs } from '../shared/clock';
import { packTile, TILE_BYTES, TILE_UPDATE_BYTES, type Frame, type FromWorker, type Speed, type ToWorker } from '../shared/protocol';
import { createState, type SimState } from './state';
import { tick } from './tick';
import { cloneState } from './serialize';
import { createTimeline, keyframeAtOrBefore, recordKeyframe, type Timeline } from './timeline';
import { areaName, computeAreas } from './world/regions';
import { groupViews, inspect, packPeople } from './view';

const T = CONFIG.time;

let live: SimState | null = null;
let view: SimState | null = null;       // a past year being viewed or replayed
let timeline: Timeline | null = null;
let playing = false;
let speed: Speed = 1;

// Silent rebuild of a past year (§17.3 step 2).
let rebuildTarget: number | null = null;
let rebuildFrom = 0;
let lastProgressYear = 0;

// Loop pacing.
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let budget = 0;                         // ticks owed by real time
let lastLoopMs = 0;
let lastFrameMs = 0;
const speedSamples: Array<{ t: number; ticks: number }> = [];

// What the main thread already has, so frames only carry changes.
let lastSent = new Uint8Array(0);
let needFull = true;
let lastAnimalYear = -1;
let selectedGroup: number | null = null;
let lastKnownVersion = -1;              // fog: known version of the selected group last sent
let sentLog = 0;                        // live log entries already sent (absolute count)

const post = (msg: FromWorker, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(msg, transfer);
};

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  try {
    handle(e.data);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};

function handle(msg: ToWorker): void {
  switch (msg.type) {
    case 'start': {
      live = createState(msg.setup);
      timeline = createTimeline(live);
      view = null;
      rebuildTarget = null;
      selectedGroup = null;
      sentLog = 0;
      const m = msg.setup.map;
      const areas = computeAreas(m.wall, m.width, m.height);
      post({
        type: 'started',
        areas: Array.from({ length: areas.count }, (_, r) => ({
          regionId: r, name: areaName(r), tileCount: areas.tileCount[r]!,
          centerX: areas.centerX[r]!, centerY: areas.centerY[r]!,
        })),
      });
      needFull = true;
      setPlaying(true);
      sendFrame();
      return;
    }
    case 'play': setPlaying(true); sendFrame(); return;
    case 'pause': setPlaying(false); sendFrame(); return;
    case 'speed': speed = msg.value; sendFrame(); return;
    case 'step':
      if (!playing && rebuildTarget === null && live) { advanceOne(); sendFrame(); }
      return;
    case 'viewYear': viewYear(msg.year); return;
    case 'backToNow':
      view = null;
      rebuildTarget = null;
      needFull = true;
      sendFrame();
      return;
    case 'inspect': {
      const s = view ?? live;
      if (!s) return;
      post({ type: 'inspectResult', result: inspect(s, msg.x, msg.y, msg.personId, msg.groupId) });
      return;
    }
    case 'select':
      selectedGroup = msg.groupId;
      lastKnownVersion = -1;
      sendFrame();
      return;
    case 'stop':
      if (loopTimer !== null) clearTimeout(loopTimer);
      self.close();
      return;
  }
}

function setPlaying(p: boolean): void {
  playing = p;
  budget = 0;
  lastLoopMs = nowMs();
  speedSamples.length = 0;
  schedule(0);
}

function schedule(delayMs: number): void {
  if (loopTimer !== null) clearTimeout(loopTimer);
  loopTimer = setTimeout(loop, delayMs);
}

/** Jump to a past year: copy the nearest keyframe and replay silently up to it (§17.3). */
function viewYear(year: number): void {
  if (!live || !timeline) return;
  const y = Math.max(0, Math.floor(year));
  // Viewing "now" (or later) is just the live state.
  if (y > live.year || (y === live.year && live.month === 0)) {
    handle({ type: 'backToNow' });
    return;
  }
  playing = false;
  const kf = keyframeAtOrBefore(timeline, y);
  view = cloneState(kf);
  rebuildTarget = y;
  rebuildFrom = kf.year;
  lastProgressYear = kf.year;
  schedule(0);
}

/** One tick of whatever is on screen. A replayed past that catches up becomes live again. */
function advanceOne(): void {
  if (view) {
    tick(view);
    if (view.year === live!.year && view.month === live!.month) view = null;
  } else {
    tick(live!);
    recordKeyframe(timeline!, live!);
  }
}

function loop(): void {
  loopTimer = null;
  if (!live) return;
  const t0 = nowMs();

  if (rebuildTarget !== null && view) {
    // Rebuilding a past year: tick as fast as possible, in 50 ms slices so messages
    // (like "Back to now") still get through.
    while (!(view.year === rebuildTarget && view.month === 0) && nowMs() - t0 < T.maxWorkMsPerLoop) tick(view);
    if (view.year - lastProgressYear >= CONFIG.timeline.progressEveryYears) {
      lastProgressYear = view.year;
      post({
        type: 'progress', label: `Rebuilding year ${view.year.toLocaleString('en-US')}…`,
        done: view.year - rebuildFrom, total: rebuildTarget - rebuildFrom,
      });
    }
    if (view.year === rebuildTarget && view.month === 0) {
      rebuildTarget = null;
      needFull = true;
      sendFrame();
      return;
    }
    schedule(0);
    return;
  }

  if (!playing) return;
  const tps = T.ticksPerSecond1x * (speed === 8 ? T.fastMultiplier : 1);
  budget = Math.min(budget + ((t0 - lastLoopMs) / 1000) * tps, tps * T.maxBacklogSeconds + 1);
  lastLoopMs = t0;
  let ran = 0;
  while (budget >= 1 && nowMs() - t0 < T.maxWorkMsPerLoop) {
    advanceOne();
    budget -= 1;
    ran++;
  }
  speedSamples.push({ t: t0, ticks: ran });
  while (speedSamples.length > 0 && t0 - speedSamples[0]!.t > T.speedWindowMs) speedSamples.shift();
  if (t0 - lastFrameMs >= 1000 / T.maxFramesPerSecond) sendFrame();
  // Sleep until the next tick is due instead of spinning.
  schedule(budget >= 1 ? 0 : Math.max(0, ((1 - budget) / tps) * 1000));
}

function yearsPerSecond(): number {
  if (!playing || speedSamples.length < 2) return 0;
  const span = speedSamples[speedSamples.length - 1]!.t - speedSamples[0]!.t;
  if (span <= 0) return 0;
  let ticks = 0;
  for (let k = 1; k < speedSamples.length; k++) ticks += speedSamples[k]!.ticks;
  return ticks / T.ticksPerYear / (span / 1000);
}

function sendFrame(): void {
  if (!live) return;
  lastFrameMs = nowMs();
  const s = view ?? live;
  const n = s.width * s.height;
  const frame: Frame = {
    year: s.year,
    month: s.month,
    isPast: view !== null,
    liveYear: live.year,
    liveMonth: live.month,
    playing,
    speed,
    yearsPerSecond: yearsPerSecond(),
    people: packPeople(s),
    groups: groupViews(s),
  };
  const transfer: Transferable[] = [frame.people.buffer];

  // Fog for the selected group: its known bitset, whenever it changes.
  const sel = selectedGroup !== null ? s.groups.find((g) => g.id === selectedGroup) : undefined;
  if (sel && (sel.knownVersion !== lastKnownVersion || needFull)) {
    lastKnownVersion = sel.knownVersion;
    frame.selectedKnown = sel.known.slice();
    transfer.push(frame.selectedKnown.buffer);
  }

  if (needFull || lastSent.length !== n * TILE_BYTES) {
    needFull = false;
    const full = new Uint8Array(n * TILE_BYTES);
    for (let i = 0; i < n; i++) packTile(s, s.rainNow, s.crossing, i, full, i * TILE_BYTES);
    lastSent = full.slice();
    frame.fullTiles = full;
    transfer.push(full.buffer);
    lastAnimalYear = -1;
  } else {
    frame.tileUpdates = tileDiff(s);
    if (frame.tileUpdates) transfer.push(frame.tileUpdates.buffer);
  }

  if (s.year !== lastAnimalYear) {
    lastAnimalYear = s.year;
    const dens = new Uint8Array(4 * n);
    for (let sp = 0; sp < 4; sp++) {
      const a = s.animal[sp]!;
      for (let i = 0; i < n; i++) dens[sp * n + i] = Math.round(a[i]! * 255);
    }
    frame.animalDensity = dens;
    transfer.push(dens.buffer);
  }
  post({ type: 'frame', frame }, transfer);

  // New live log entries. A replayed past makes the same entries again, so only live ones go out.
  const total = live.logDropped + live.log.length;
  if (total > sentLog) {
    const from = Math.max(0, sentLog - live.logDropped);
    post({ type: 'log', entries: live.log.slice(from) });
    sentLog = total;
  }
}

const scratchTile = new Uint8Array(TILE_BYTES);

/** Changed tiles since the last frame, as [index lo, index hi, 7 bytes] records. */
function tileDiff(s: SimState): Uint8Array | undefined {
  const n = s.width * s.height;
  const changed: number[] = [];
  for (let i = 0; i < n; i++) {
    packTile(s, s.rainNow, s.crossing, i, scratchTile, 0);
    const o = i * TILE_BYTES;
    for (let k = 0; k < TILE_BYTES; k++) {
      if (scratchTile[k] !== lastSent[o + k]) { changed.push(i); break; }
    }
  }
  if (changed.length === 0) return undefined;
  const out = new Uint8Array(changed.length * TILE_UPDATE_BYTES);
  changed.forEach((i, k) => {
    const o = k * TILE_UPDATE_BYTES;
    out[o] = i & 255;
    out[o + 1] = i >> 8;
    packTile(s, s.rainNow, s.crossing, i, out, o + 2);
    lastSent.set(out.subarray(o + 2, o + 2 + TILE_BYTES), i * TILE_BYTES);
  });
  return out;
}
