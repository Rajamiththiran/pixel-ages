// Story mode (F8 §14.6): the camera jumps to big moments as they happen — first contact, wars,
// conquests, breached walls, new eras, villages, deadly disasters, lineages dying out — and
// holds each for a few seconds with a caption. Pure logic: the caller moves the camera.

import { CONFIG } from '../config';
import type { LogEntry } from '../shared/types';

const ST = CONFIG.render.f8.story;

const BIG = new Set<LogEntry['type']>([
  'firstContact', 'war', 'conquered', 'breach', 'lineageExtinct', 'alliance', 'event', 'intervention', 'eraUp', 'becameVillage',
]);

/** Is this log line a big moment? Disasters count when at least `minDead` died. */
export function isBigMoment(e: LogEntry, minDead = 10): boolean {
  if (e.x === null || e.y === null) return false;
  if (BIG.has(e.type)) return true;
  if (e.type === 'hazard') {
    const m = /\((\d+) (?:died|drowned|dead)/.exec(e.text);
    return m !== null && Number(m[1]) >= minDead;
  }
  return false;
}

export class StoryDirector {
  private queue: LogEntry[] = [];
  private current: LogEntry | null = null;
  private until = 0;
  private quietUntil = 0;
  on = false;

  /** New live log lines. */
  push(entries: readonly LogEntry[]): void {
    if (!this.on) return;
    for (const e of entries) {
      if (!isBigMoment(e)) continue;
      this.queue.push(e);
      // Keep the latest few: at 8× old moments are stale before their turn comes.
      if (this.queue.length > ST.queueMax) this.queue.shift();
    }
  }

  /** The owner panned, zoomed or clicked: let them look around for a while. */
  userActed(nowMs: number): void {
    this.quietUntil = nowMs + ST.idleAfterInputMs;
  }

  /** The moment to show now (changes at most every holdMs), or null. */
  update(nowMs: number): { entry: LogEntry; fresh: boolean } | null {
    if (!this.on) { this.current = null; return null; }
    let fresh = false;
    if ((!this.current || nowMs >= this.until) && nowMs >= this.quietUntil && this.queue.length > 0) {
      this.current = this.queue.shift()!;
      this.until = nowMs + ST.holdMs;
      fresh = true;
    } else if (this.current && nowMs >= this.until) {
      this.current = null;
    }
    return this.current ? { entry: this.current, fresh } : null;
  }

  clear(): void {
    this.queue = [];
    this.current = null;
  }
}
