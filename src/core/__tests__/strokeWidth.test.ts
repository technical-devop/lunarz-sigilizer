import { describe, expect, it } from 'vitest';

import { composeSigil } from '../compose';
import { processIntention } from '../intention';
import {
  compositionToExportSvg,
  SIGIL_STROKE_WIDTH,
  strokeWidthForScale,
} from '../svg';

function matrixScaleMagnitude(matrix: string): number {
  const match = matrix.match(/^matrix\(([^)]+)\)$/);
  if (!match) {
    throw new Error(`not a matrix: ${matrix}`);
  }
  const [a, b, c, d] = match[1]!.trim().split(/\s+/).map(Number);
  // Uniform scale + rotation (+ optional mirror): |scale| = hypot(a, b) = hypot(c, d).
  const fromColumns = Math.hypot(a!, b!);
  const fromRows = Math.hypot(c!, d!);
  expect(fromColumns).toBeCloseTo(fromRows, 9);
  return fromColumns;
}

function exportedPaths(svg: string): { width: number; matrix: string }[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return Array.from(doc.querySelectorAll('path')).map((path) => ({
    width: Number(path.getAttribute('stroke-width')),
    matrix: path.getAttribute('transform') ?? '',
  }));
}

describe('stroke-width RED: effective transformed width is scale-invariant', () => {
  it('keeps effective preview/export width constant across unequal per-letter scales (BE CALM)', () => {
    const composition = composeSigil(processIntention('BE CALM'), { seed: 7 });
    expect(composition.letters.length).toBeGreaterThanOrEqual(3);
    const rawScales = composition.letters.map((letter) => letter.transform.scale);
    // Per-letter scales genuinely differ within one sigil (spine vs companions).
    expect(Math.max(...rawScales) / Math.min(...rawScales)).toBeGreaterThan(1.2);

    const svg = compositionToExportSvg(composition);
    const paths = exportedPaths(svg);
    expect(paths).toHaveLength(composition.letters.length);

    for (const path of paths) {
      expect(Number.isFinite(path.width)).toBe(true);
      const magnitude = matrixScaleMagnitude(path.matrix);
      const effective = path.width * magnitude;
      // The rendered stroke is stroke-width scaled by the path transform.
      expect(effective).toBeCloseTo(SIGIL_STROKE_WIDTH, 6);
    }

    const effectiveValues = paths.map((path) => path.width * matrixScaleMagnitude(path.matrix));
    const spread = Math.max(...effectiveValues) - Math.min(...effectiveValues);
    expect(spread).toBeLessThan(1e-6);
  });

  it('preview helper and SVG export agree, and raster scaling stays proportional', () => {
    const composition = composeSigil(processIntention('BE CALM'), { seed: 7 });
    const svg = compositionToExportSvg(composition);
    const paths = exportedPaths(svg);

    // Preview must use the same per-letter compensation as the export.
    for (const [index, letter] of composition.letters.entries()) {
      const expected = strokeWidthForScale(letter.transform.scale);
      expect(paths[index]!.width).toBeCloseTo(expected, 9);
    }

    // PNG export draws the 512-unit SVG into a 1024 canvas (factor 2).
    const rasterFactor = 1024 / composition.width;
    for (const path of paths) {
      const magnitude = matrixScaleMagnitude(path.matrix);
      const rasterEffective = path.width * magnitude * rasterFactor;
      expect(rasterEffective).toBeCloseTo(SIGIL_STROKE_WIDTH * rasterFactor, 6);
    }
  });
});
