// Screenshot and short GIF export (F8 §14.6). Both read the map canvas only.

import { CONFIG } from '../config';
import { encodeGif, quantize } from './gif';

const C = CONFIG.render.f8.capture;

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves the map canvas as a PNG. */
export function screenshot(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((b) => { if (b) downloadBlob(filename, b); }, 'image/png');
}

/** Records the map canvas for a few seconds at a low frame rate and half size, then saves a looping GIF. */
export class GifRecorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  get busy(): boolean { return this.timer !== null || this.encoding; }
  private encoding = false;

  start(canvas: HTMLCanvasElement, filename: string, status: (text: string) => void): void {
    if (this.busy) return;
    const w = Math.round(canvas.width * C.gifScale), h = Math.round(canvas.height * C.gifScale);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    const frames: Uint8ClampedArray[] = [];
    const total = C.gifFps * C.gifSeconds;
    status(`Recording GIF… (${C.gifSeconds} s)`);
    this.timer = setInterval(() => {
      ctx.drawImage(canvas, 0, 0, w, h);
      frames.push(ctx.getImageData(0, 0, w, h).data);
      if (frames.length < total) return;
      clearInterval(this.timer!);
      this.timer = null;
      this.encoding = true;
      status('Making the GIF…');
      // A timeout first, so the status line shows before the (short) encoding work.
      setTimeout(() => {
        const { palette, indexed } = quantize(frames, C.gifColours);
        const gif = encodeGif(indexed, w, h, palette, Math.round(100 / C.gifFps));
        this.encoding = false;
        downloadBlob(filename, new Blob([gif as BlobPart], { type: 'image/gif' }));
        status(`GIF saved (${indexed.length} frames, ${Math.round(gif.length / 1024)} KB).`);
      }, 30);
    }, 1000 / C.gifFps);
  }
}
