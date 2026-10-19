// Worker entry (§5, §9, §17, §22): owns the live simulation, the timeline and the
// past-view state; runs ticks paced by real time; posts frames to the main thread.

import { CONFIG } from '../config';
import { nowMs } from '../shared/clock';
import { packTile, TILE_BYTES, TILE_UPDATE_BYTES, type Frame, type FromWorker, type Speed, type ToWorker } from '../shared/protocol';
import { computeMarks } from './world/landscape';
import { computeHazardMarks } from './world/hazards';
import type { MapLayer, RelationView } from '../shared/protocol';
import { mapLayer } from './layers';
import { observe, startStory, storyView, type StoryRecorder } from './story';

// F5 risk views and F7 heatmaps: which layer the UI shows, and the year (and past/live) it was last sent for.
let layerKind: MapLayer | null = null;
let layerKey = '';
// F7 territory fills, sent alongside any heatmap.
let territoryOn = false;
let territoryKey = '';
// F7 life story of the followed person (live run only).
let story: StoryRecorder | null = null;
let storySent = -1;
import { createState, type SimState } from './state';
import { tick } from './tick';
import { cloneState } from './serialize';
import { createTimeline, keyframeAtOrBefore, recordKeyframe, type Timeline } from './timeline';
import { areaName, computeAreas } from './world/regions';
import { computeLook, groupViews, inspect, packPeople } from './view';

const T = CONFIG.time;

let live: SimState | null = null;
let view: SimState | null = null;       // a past year being viewed or replayed
let timeline: Timeline | null = null;
let playing = false;
// F7 Compare: a second run with no screen, kept in step with the first (stats and log only).
let headless = false;
let headlessTarget = 0;
let speed: Speed = 1;
// F8 time-lapse: the past replays from year 0 as fast as the machine allows, then pauses at now.
let timelapse = false;

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
let sentStats = 0;                      // live yearly stats rows already sent

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
      headless = msg.headless === true;
      headlessTarget = 0;
      timeline = headless ? null : createTimeline(live);
      view = null;
      rebuildTarget = null;
      selectedGroup = null;
      story = null;
      storySent = -1;
      sentLog = 0;
      sentStats = 0;
      const m = msg.setup.map;
      const areas = computeAreas(m.wall, m.width, m.height);
      post({
        type: 'started',
        areas: Array.from({ length: areas.count }, (_, r) => ({
          regionId: r, name: areaName(r), tileCount: areas.tileCount[r]!,
          centerX: areas.centerX[r]!, centerY: areas.centerY[r]!,
        })),
      });
      if (headless) return;
      needFull = true;
      setPlaying(true);
      sendFrame();
      return;
    }
    case 'runTo':
      headlessTarget = msg.year;
      if (headless) schedule(0);
      return;
    case 'play': setPlaying(true); sendFrame(); return;
    case 'pause': timelapse = false; setPlaying(false); sendFrame(); return;
    case 'timelapse': startTimelapse(); return;
    case 'speed': speed = msg.value; sendFrame(); return;
    case 'step':
      if (!playing && rebuildTarget === null && live) { advanceOne(); sendFrame(); }
      return;
    case 'viewYear': timelapse = false; viewYear(msg.year); return;
    case 'backToNow':
      timelapse = false;
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
    case 'layer':
      layerKind = msg.layer;
      layerKey = '';
      sendFrame();
      return;
    case 'territory':
      territoryOn = msg.on;
      territoryKey = '';
      sendFrame();
      return;
    case 'person':
      story = msg.personId !== null && live ? startStory(live, msg.personId) : null;
      storySent = -1;
      if (!story) post({ type: 'person', story: null });
      sendFrame();
      return;
    case 'intervene': {
      // Intervention mode only, and only on the live world: it becomes part of the run (F7, D5).
      if (!live || !live.setup.interventionMode || view || rebuildTarget !== null) return;
      const iv = { ...msg.intervention, year: live.year, month: live.month };
      (live.setup.interventions ??= []).push(iv);
      post({ type: 'intervened', intervention: iv });
      if (!playing) { advanceOne(); needFull = true; }
      sendFrame();
      return;
    }
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

/** Time-lapse (F8): a copy of the first keyframe (year 0) replays forward fast; it is the past, so the live run is untouched. */
function startTimelapse(): void {
  if (!live || !timeline || live.year === 0) return;
  view = cloneState(keyframeAtOrBefore(timeline, 0));
  rebuildTarget = null;
  timelapse = true;
  needFull = true;
  setPlaying(true);
  sendFrame();
}

/** One tick of whatever is on screen. A replayed past that catches up becomes live again. */
function advanceOne(): void {
  if (view) {
    tick(view);
    if (view.year === live!.year && view.month === live!.month) {
      view = null;
      // The time-lapse reached now: stop there, so the owner sees the present.
      if (timelapse) { timelapse = false; playing = false; }
    }
  } else {
    tick(live!);
    recordKeyframe(timeline!, live!);
    if (story) observe(story, live!);
  }
}

function loop(): void {
  loopTimer = null;
  if (!live) return;
  const t0 = nowMs();
  if (headless) {
    while (live.year < headlessTarget && nowMs() - t0 < T.maxWorkMsPerLoop) tick(live);
    sendHistory();
    if (live.year < headlessTarget) schedule(0);
    return;
  }

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
  if (timelapse) {
    let ran = 0;
    while (timelapse && ran < CONFIG.render.f8.timelapseTicksPerLoop && nowMs() - t0 < T.maxWorkMsPerLoop) { advanceOne(); ran++; }
    speedSamples.push({ t: t0, ticks: ran });
    while (speedSamples.length > 0 && t0 - speedSamples[0]!.t > T.speedWindowMs) speedSamples.shift();
    sendFrame();
    if (playing) schedule(1000 / T.maxFramesPerSecond);
    return;
  }
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
    timelapse,
    yearsPerSecond: yearsPerSecond(),
    people: packPeople(s),
    groups: groupViews(s),
    relations: relationViews(s),
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
    const marks = computeMarks(s, marksScratch(n));
    const hz = computeHazardMarks(s, hazardScratch(n));
    const look = computeLook(s, lookScratch(n));
    for (let i = 0; i < n; i++) packTile(s, s.rainNow, s.crossing, marks, hz, look, i, full, i * TILE_BYTES);
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
  // Heatmaps and territory fills follow the year on screen.
  const key = `${s.year}|${view ? 1 : 0}`;
  if (layerKind && key !== layerKey) {
    layerKey = key;
    const data = mapLayer(s, layerKind, live.log);
    post({ type: 'layer', layer: layerKind, data }, [data.buffer]);
  }
  if (territoryOn && key !== territoryKey) {
    territoryKey = key;
    const data = mapLayer(s, 'territory', live.log);
    post({ type: 'layer', layer: 'territory', data }, [data.buffer]);
  }
  if (story && story.version !== storySent) {
    storySent = story.version;
    post({ type: 'person', story: storyView(story, live) });
  }

  sendHistory();
}

/** New live log entries and yearly stats rows. A replayed past makes the same entries again, so only live ones go out. */
function sendHistory(): void {
  if (!live) return;
  const total = live.logDropped + live.log.length;
  if (total > sentLog) {
    const from = Math.max(0, sentLog - live.logDropped);
    post({ type: 'log', entries: live.log.slice(from) });
    sentLog = total;
  }
  // New yearly stats rows for the graphs (live only, like the log).
  if (live.stats.length > sentStats) {
    post({ type: 'stats', rows: live.stats.slice(sentStats) });
    sentStats = live.stats.length;
  }
}

/** F7 relation lines: every relation between groups on screen, plus alliances. */
function relationViews(s: SimState): RelationView[] {
  const out: RelationView[] = s.relations.map((r) => ({ a: r.a, b: r.b, kind: r.kind }));
  for (const al of s.alliances) {
    if (!out.some((r) => r.kind === 'alliance' && r.a === al.a && r.b === al.b)) out.push({ a: al.a, b: al.b, kind: 'alliance' });
  }
  return out;
}

const scratchTile = new Uint8Array(TILE_BYTES);
let marksBuf = new Uint8Array(0);
const marksScratch = (n: number): Uint8Array => (marksBuf.length === n ? marksBuf : (marksBuf = new Uint8Array(n)));
let hazardBuf = new Uint8Array(0);
const hazardScratch = (n: number): Uint8Array => (hazardBuf.length === n ? hazardBuf : (hazardBuf = new Uint8Array(n)));
let lookBuf = new Uint8Array(0);
const lookScratch = (n: number): Uint8Array => (lookBuf.length === n ? lookBuf : (lookBuf = new Uint8Array(n)));

/** Changed tiles since the last frame, as [index lo, index hi, 10 bytes] records. */
function tileDiff(s: SimState): Uint8Array | undefined {
  const n = s.width * s.height;
  const marks = computeMarks(s, marksScratch(n));
  const hz = computeHazardMarks(s, hazardScratch(n));
  const look = computeLook(s, lookScratch(n));
  const changed: number[] = [];
  for (let i = 0; i < n; i++) {
    packTile(s, s.rainNow, s.crossing, marks, hz, look, i, scratchTile, 0);
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
    packTile(s, s.rainNow, s.crossing, marks, hz, look, i, out, o + 2);
    lastSent.set(out.subarray(o + 2, o + 2 + TILE_BYTES), i * TILE_BYTES);
  });
  return out;
}
