import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { composeSigil } from '../compose';
import { processIntention } from '../intention';
import {
  compositionToExportSvg,
  SIGIL_STROKE_HIGHLIGHT_WIDTH,
  SIGIL_STROKE_WIDTH,
  strokeWidthForScale,
} from '../svg';

const here = dirname(fileURLToPath(import.meta.url));
const RITUAL_CSS = join(here, '..', '..', 'ritual.css');
const APP_TSX = join(here, '..', '..', 'App.tsx');

/**
 * Extract the declared `stroke-width` value (as a number) from the FIRST
 * rule block whose selector list contains exactly `selector`.
 * Returns null when the rule declares no stroke-width.
 *
 * This models the real browser cascade for this app: any CSS `stroke-width`
 * declaration on `.sigilpath` / `.sigilpath.is-lit` OVERRIDES the per-letter
 * `stroke-width` presentation attribute (CSS beats presentation attributes).
 * The old CSS declared `.sigilpath { stroke-width: 4 }` and
 * `.sigilpath.is-lit { stroke-width: 6 }`, so the computed width was the
 * fixed 4/6 — not the scale-compensated attribute (≈0.0085) — and the
 * effective paint became 4*|scale| / 6*|scale| (hundreds of px).
 */
function cssDeclaredStrokeWidth(css: string, selector: string): number | null {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the selector as a full selector (not a prefix of a longer one):
  // `.sigilpath` must be followed by optional whitespace + `{`, so
  // `.sigilpath.is-lit` does not match the `.sigilpath` query.
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const values: (number | null)[] = [];
  for (const match of css.matchAll(pattern)) {
    const body = match[1] ?? '';
    const decl = body.match(/stroke-width\s*:\s*([^;]+);/);
    if (!decl) {
      values.push(null);
      continue;
    }
    const raw = decl[1]!.trim();
    // Only unitless numbers participate in this test; var()/px would also
    // override the attribute and must fail the "no override" assertion.
    const numeric = Number(raw);
    values.push(Number.isFinite(numeric) ? numeric : Number.NaN);
  }
  expect(values.length).toBeGreaterThan(0);
  // Every matching block must be override-free; return the first declared
  // value if any block declares one.
  return values.find((value) => value !== null) ?? null;
}

function matrixMagnitude(matrix: string): number {
  const match = matrix.match(/^matrix\(([^)]+)\)$/);
  expect(match).not.toBeNull();
  const [a, b] = match![1]!.trim().split(/\s+/).map(Number);
  return Math.hypot(a!, b!);
}

describe('stroke cascade: CSS must not override the scale-compensated attribute', () => {
  it('declares no fixed stroke-width on .sigilpath (normal state)', () => {
    const css = readFileSync(RITUAL_CSS, 'utf8');
    const declared = cssDeclaredStrokeWidth(css, '.sigilpath');
    // Old CSS declared 4 here: fail with the exact overriding value so the
    // failure names the cascade culprit, not the attribute.
    expect(declared).toBeNull();
  });

  it('declares no fixed stroke-width on .sigilpath.is-lit (highlighted state)', () => {
    const css = readFileSync(RITUAL_CSS, 'utf8');
    const declared = cssDeclaredStrokeWidth(css, '.sigilpath.is-lit');
    // Old CSS declared 6 here.
    expect(declared).toBeNull();
  });

  it('preview normal paths resolve through the cascade to effective width 4', () => {
    const css = readFileSync(RITUAL_CSS, 'utf8');
    const cssNormal = cssDeclaredStrokeWidth(css, '.sigilpath');
    const composition = composeSigil(processIntention('BE CALM'), { seed: 7 });

    for (const letter of composition.letters) {
      const magnitude = Math.abs(letter.transform.scale);
      expect(magnitude).toBeGreaterThan(0);
      const attrWidth = strokeWidthForScale(letter.transform.scale, SIGIL_STROKE_WIDTH);
      // Cascade: CSS wins over the presentation attribute when present.
      const computed = cssNormal ?? attrWidth;
      const effective = computed * magnitude;
      // With the old `.sigilpath { stroke-width: 4 }`, computed is 4 and
      // effective is 4 * ~350 ≈ 1400 — this assertion fails showing the
      // blow-out instead of 4, which is the right reason.
      expect(effective).toBeCloseTo(SIGIL_STROKE_WIDTH, 6);
    }
  });

  it('preview highlighted paths resolve through the cascade to effective width 6', () => {
    const css = readFileSync(RITUAL_CSS, 'utf8');
    const cssLit = cssDeclaredStrokeWidth(css, '.sigilpath.is-lit');
    const composition = composeSigil(processIntention('BE CALM'), { seed: 7 });

    for (const letter of composition.letters) {
      const magnitude = Math.abs(letter.transform.scale);
      const attrLitWidth = strokeWidthForScale(
        letter.transform.scale,
        SIGIL_STROKE_HIGHLIGHT_WIDTH,
      );
      const computed = cssLit ?? attrLitWidth;
      const effective = computed * magnitude;
      // Old `.sigilpath.is-lit { stroke-width: 6 }` gives 6 * ~350 ≈ 2100.
      expect(effective).toBeCloseTo(SIGIL_STROKE_HIGHLIGHT_WIDTH, 6);
    }
    expect(SIGIL_STROKE_HIGHLIGHT_WIDTH).toBe(6);
  });

  it('highlight helper compensates per scale while the default stays at 4', () => {
    for (const scale of [0.5, 0.675, 1.22, 350]) {
      expect(strokeWidthForScale(scale) * Math.abs(scale)).toBeCloseTo(4, 6);
      expect(
        strokeWidthForScale(scale, SIGIL_STROKE_HIGHLIGHT_WIDTH) * Math.abs(scale),
      ).toBeCloseTo(6, 6);
    }
  });

  it('App preview wires the wheel path to the constant stroke width (source check)', () => {
    const source = readFileSync(APP_TSX, 'utf8');
    // The wheel is one untransformed path: its stroke-width is the literal
    // SIGIL_STROKE_WIDTH, so no per-letter compensation can inflate it. Wheel
    // and sequence inspection are overlays and never change the path width.
    expect(source).toContain('strokeWidth={SIGIL_STROKE_WIDTH}');
    expect(source).not.toContain('strokeWidthForScale');
  });

  it('SVG export and PNG source stay at effective width 4 (no highlight leak)', () => {
    const composition = composeSigil(processIntention('BE CALM'), { seed: 7 });
    const svg = compositionToExportSvg(composition);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const paths = Array.from(doc.querySelectorAll('path'));
    expect(paths).toHaveLength(composition.letters.length);

    for (const [index, path] of paths.entries()) {
      const letter = composition.letters[index]!;
      const width = Number(path.getAttribute('stroke-width'));
      // Export carries the NORMAL compensation even for letters that may be
      // highlighted in the preview — highlights are inspection overlays only.
      expect(width).toBeCloseTo(strokeWidthForScale(letter.transform.scale), 9);
      expect(width * Math.abs(letter.transform.scale)).toBeCloseTo(SIGIL_STROKE_WIDTH, 6);
      const magnitude = matrixMagnitude(path.getAttribute('transform') ?? '');
      expect(width * magnitude).toBeCloseTo(SIGIL_STROKE_WIDTH, 6);
      // PNG rasterizes this same vector scene at 1024/512 = factor 2.
      const rasterFactor = 1024 / composition.width;
      expect(width * magnitude * rasterFactor).toBeCloseTo(
        SIGIL_STROKE_WIDTH * rasterFactor,
        6,
      );
    }
    expect(svg).not.toContain('is-lit');
  });
});
