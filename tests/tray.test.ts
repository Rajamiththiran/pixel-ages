// Toy Diorama phase 5 (docs/diorama-plan/05-ui-tray.md): the tray UI's stylesheets keep the design
// system's rules (docs/mockups/Pixel Ages UI mockups/_ds/: readme.md and tokens/*.css).

import { describe, expect, it } from 'vitest';

// Node's fs, loaded at run time: the project has no Node typings, and Vitest blanks CSS imports.
interface Fs { readFileSync(p: URL, enc: 'utf8'): string; readdirSync(p: URL): string[] }
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as Fs;
const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DS = new URL('../docs/mockups/Pixel%20Ages%20UI%20mockups/_ds/', import.meta.url);
const dsDir = new URL(fs.readdirSync(DS).find((d) => d.startsWith('pixel-ages-design-system'))! + '/', DS);
const dsToken = (file: string): string => fs.readFileSync(new URL('tokens/' + file, dsDir), 'utf8');

const tray = read('../src/ui/tray.css');
const tokens = read('../src/ui/tokens.css');
const old = read('../src/ui/styles.css');
const noComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--name: value` pairs. */
function vars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of noComments(css).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim().toLowerCase();
  return out;
}

describe('tray UI tokens are the design system tokens', () => {
  it('colours equal tokens/colors.css', () => {
    const ds = vars(dsToken('colors.css')), ours = vars(tokens);
    for (const k of ['tray-900', 'tray-800', 'tray-700', 'tray-600', 'tray-500', 'tray-400', 'tray-300', 'cream', 'cream-soft', 'cream-muted',
      'brass', 'brass-light', 'brass-edge', 'brass-track', 'on-brass', 'danger-fill', 'danger-edge', 'danger-text', 'warning', 'ok']) {
      expect(ours[k], k).toBe(ds[k]);
    }
  });

  it('bevels and spacing equal tokens/effects.css and spacing.css', () => {
    const ds = { ...vars(dsToken('effects.css')), ...vars(dsToken('spacing.css')) }, ours = vars(tokens);
    for (const k of ['bevel-raised', 'bevel-pressed', 'bevel-brass', 'bevel-danger', 'plate', 'tray-edge', 'space-xs', 'space-s', 'space-m', 'space-l', 'space-xl', 'size-control', 'size-tool']) {
      expect(ours[k], k).toBe(ds[k]);
    }
  });

  it('the eight type styles equal tokens/typography.css', () => {
    const ds = vars(dsToken('typography.css')), ours = vars(tokens);
    for (const s of ['display', 'year', 'heading', 'body', 'label', 'caption', 'map-name', 'map-era']) {
      expect(ours[`type-${s}`], s).toBe(`${ds[`type-${s}-weight`]} ${ds[`type-${s}-size`]}/${ds[`type-${s}-line`]} var(--font-pixel)`);
    }
  });

  it('the font is the design system font, from the two files in the project', () => {
    expect(tokens).toContain('font-family: "Pixelify Sans"');
    expect(tokens).toContain('./fonts/PixelifySans-latin.woff2');
    expect(tokens).toContain('./fonts/PixelifySans-ext.woff2');
  });
});

describe('tray UI stylesheet keeps the design system rules', () => {
  const css = noComments(tray);

  it('every rule is scoped to the tray, so ?off=tray brings the old UI back', () => {
    for (const m of css.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      const selectors = m[1]!.split(',').map((x) => x.trim()).filter(Boolean);
      for (const sel of selectors) expect(sel.startsWith(':root[data-ui="tray"]'), sel).toBe(true);
    }
  });

  it('type only through the eight type styles (no other font sizes)', () => {
    expect(css).not.toMatch(/font-size\s*:/);
    for (const m of css.matchAll(/font\s*:\s*([^;]+);/g)) {
      expect(['inherit', 'var(--type-display)', 'var(--type-year)', 'var(--type-heading)', 'var(--type-body)', 'var(--type-label)',
        'var(--type-caption)', 'var(--type-map-name)', 'var(--type-map-era)']).toContain(m[1]!.trim());
    }
  });

  it('every old rule that sets a font size has a tray override', () => {
    const oldCss = noComments(old);
    const missing: string[] = [];
    for (const m of oldCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/font(-size)?\s*:/.test(m[2]!)) continue;
      for (let sel of m[1]!.split(',').map((x) => x.trim())) {
        if (sel === 'html' || sel === 'button' || sel === 'input' || sel === 'select') continue;   // body / form controls rules cover them
        sel = sel.replace(/^\.pixel-font /, '');
        const scoped = new RegExp(`:root\\[data-ui="tray"\\](\\.pixel-font)? ${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`);
        if (!scoped.test(css)) missing.push(sel);
      }
    }
    expect(missing).toEqual([]);
  });

  it('square corners, hard edges: no blur, no rounding, no translucent colours', () => {
    expect(css).not.toMatch(/blur\(/);
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/rgba\(|hsla\(/);
    for (const m of css.matchAll(/border-radius\s*:\s*([^;]+);/g)) expect(m[1]!.trim()).toBe('0');
    for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      // Hard offsets only: "0 Npx 0 colour", insets, or a token.
      expect(m[1]!.trim(), m[1]).toMatch(/^(none|var\(--[\w-]+\)|(inset )?0 -?\d+px 0( \d+px)? var\(--[\w-]+\)(, (inset )?0 -?\d+px 0( \d+px)? var\(--[\w-]+\))*|inset 0 0 0 \d+px var\(--[\w-]+\)(, 0 \d+px 0 var\(--[\w-]+\))?)$/);
    }
  });

  it('the dialog scrim is solid tray-900 (no translucent scrim)', () => {
    expect(css).toMatch(/\.modal-back \{ background: var\(--tray-900\); \}/);
  });
});
