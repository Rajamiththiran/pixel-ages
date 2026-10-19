// Ambient sound (F8 §14.7, D8: on by default, with a mute button). Everything is made in code
// with the Web Audio API — no sound files. The mix follows what is on screen: wind (more over
// mountains and in winter), rain under the clouds, lapping water, birds by day in spring and
// summer, fire crackle from campfires and wildfires, and the knock of work. Browsers only allow
// sound after the first click or key press, so the audio starts then.

import { CONFIG } from '../config';
import type { SoundScene } from '../render/renderer';

const S = CONFIG.render.f8.sound;

export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private rain: GainNode | null = null;
  private water: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean;
  private nextUpdate = 0;
  private scene: SoundScene | null = null;

  constructor(muted: boolean) {
    this.muted = muted;
    // Browsers start audio only from a user gesture.
    const start = (): void => {
      this.start();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  get isMuted(): boolean { return this.muted; }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : S.master, this.ctx.currentTime, 0.1);
  }

  private start(): void {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : S.master;
      this.master.connect(ctx.destination);
      // Two seconds of white noise, looped, feeds the wind, rain and water beds.
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
      this.wind = this.bed('bandpass', 380, 0.6);
      this.rain = this.bed('highpass', 1800, 0.4);
      this.water = this.bed('lowpass', 500, 0.5);
    } catch {
      this.ctx = null;           // no audio on this browser: the game runs silent
    }
  }

  /** A looping noise bed through one filter, starting silent. */
  private bed(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    return g;
  }

  /** Called every frame; the mix changes a few times a second. */
  update(nowMs: number, scene: SoundScene): void {
    this.scene = scene;
    if (!this.ctx || this.muted || nowMs < this.nextUpdate) return;
    const dt = (S.updateMs + Math.max(0, nowMs - this.nextUpdate)) / 1000;
    this.nextUpdate = nowMs + S.updateMs;
    const t = this.ctx.currentTime;
    const sc = this.scene;
    // Render-only randomness: the wind gusts.
    const gust = 0.7 + Math.random() * 0.6;
    this.wind!.gain.setTargetAtTime((S.wind + S.windMountain * sc.mountain + S.wind * sc.winter) * gust, t, S.rampS);
    this.rain!.gain.setTargetAtTime(S.rain * Math.min(1, sc.rain * 2 + sc.snow * 0.3), t, S.rampS);
    this.water!.gain.setTargetAtTime(S.water * sc.water, t, S.rampS);
    // Sparse sounds: how many to start in this slice is drawn by chance.
    const birds = S.birdsPerS * dt * sc.day * sc.birdSeason * Math.min(1, sc.forest + sc.grass * 0.6) * (1 - sc.rain);
    if (Math.random() < birds) this.chirp(t + Math.random() * dt);
    const crackles = Math.min(6, sc.fires * S.cracklePerFire) * dt * (sc.playing ? 1 : 0.4);
    for (let k = 0; k < 3; k++) if (Math.random() < crackles / 3) this.crackle(t + Math.random() * dt);
    const knocks = sc.playing ? Math.min(1, sc.workers / 6) * S.workPerS * dt * sc.day : 0;
    if (Math.random() < knocks) this.knock(t + Math.random() * dt);
  }

  /** A bird: two or three quick rising whistles. */
  private chirp(at: number): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 2);
    const base = 2600 + Math.random() * 1600;
    for (let k = 0; k < notes; k++) {
      const t = at + k * 0.09;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.06);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(S.birdGain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  /** A crackle: a very short burst of filtered noise. */
  private crackle(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(S.crackleGain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.03);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at, Math.random());
    src.stop(at + 0.06);
  }

  /** A knock of wood on wood (axes, building, hoes). */
  private knock(at: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(260 + Math.random() * 160, at);
    o.frequency.exponentialRampToValueAtTime(120, at + 0.05);
    g.gain.setValueAtTime(S.workGain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.07);
  }
}
