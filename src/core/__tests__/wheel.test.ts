import { describe, expect, it } from 'vitest';

import { processIntention } from '../intention';
import {
  CURVE_SUBTLE,
  WHEEL1_RADIUS,
  WHEEL2_GROUPS,
  WHEEL2_RADII,
  WHEEL_CANVAS,
  WHEEL_CENTER,
  buildWheelSigil,
  composeWheelSigil,
  glyphSegments,
  quadPoint,
  segmentControls,
  wheel1Points,
  wheel2Points,
  wheelPathD,
  type WheelMode,
} from '../wheel';

const CX = WHEEL_CENTER;
const CY = WHEEL_CENTER;

// Generated directly from the Python wheel reference script
// (CURVE_SUBTLE, max_wheel_radius bound) at the app's canonical 260×260 wheel
// canvas centre.
const REFERENCE_PATHS: Record<WheelMode, Record<string, string>> = {
  single: {
    'BE CALM':
      'M 153.932 32.906 Q 165.460 36.498 176.472 41.454 Q 197.723 130.000 176.472 218.546 Q 165.460 223.502 153.932 227.094',
    'I MAKE TIME TO CREATE':
      'M 153.932 227.094 Q 172.453 210.887 196.312 204.851 Q 105.985 193.322 30.729 142.054 Q 91.529 74.265 176.472 41.454 Q 129.529 129.583 47.702 186.806',
    'I PROTECT MY SPACE':
      'M 83.528 218.546 Q 63.688 204.851 47.702 186.806 Q 36.498 165.460 30.729 142.054 Q 91.529 74.265 176.472 41.454 Q 187.479 136.979 153.932 227.094 Q 96.453 142.723 83.528 41.454 Q 74.894 109.101 36.498 165.460',
    'I BUILD RESILIENT STRENGTH':
      'M 153.932 32.906 Q 187.479 123.021 176.472 218.546 Q 166.785 134.466 196.312 55.149 Q 137.806 138.811 47.702 186.806 Q 41.454 176.472 36.498 165.460 Q 90.994 186.510 130.000 230.000 Q 69.811 197.939 30.729 142.054 Q 127.107 106.175 229.271 117.946 Q 230.000 130.000 229.271 142.054',
    'BCDFGHJKLMNPQRSTVWXYZ':
      'M 153.932 32.906 Q 165.460 36.498 176.472 41.454 Q 186.806 47.702 196.312 55.149 Q 212.298 73.194 223.502 94.540 Q 227.094 106.068 229.271 117.946 Q 230.000 130.000 229.271 142.054 Q 223.502 165.460 212.298 186.806 Q 204.851 196.312 196.312 204.851 Q 186.806 212.298 176.472 218.546 Q 165.460 223.502 153.932 227.094 Q 142.054 229.271 130.000 230.000 Q 106.068 227.094 83.528 218.546 Q 73.194 212.298 63.688 204.851 Q 55.149 196.312 47.702 186.806 Q 41.454 176.472 36.498 165.460 Q 32.906 153.932 30.729 142.054 Q 30.729 117.946 36.498 94.540 Q 41.454 83.528 47.702 73.194 Q 55.149 63.688 63.688 55.149 Q 73.194 47.702 83.528 41.454 Q 94.540 36.498 106.068 32.906',
  },
  multi: {
    'BE CALM':
      'M 176.472 41.454 Q 196.312 55.149 212.298 73.194 Q 130.000 92.945 47.702 73.194 Q 63.688 55.149 83.528 41.454',
    'I MAKE TIME TO CREATE':
      'M 83.528 41.454 Q 66.307 86.036 30.729 117.946 Q 48.811 119.981 64.000 130.000 Q 131.332 83.801 212.298 73.194 Q 185.886 144.473 130.000 196.000',
    'I PROTECT MY SPACE':
      'M 196.000 130.000 Q 170.920 170.920 130.000 196.000 Q 89.080 170.920 64.000 130.000 Q 131.332 83.801 212.298 73.194 Q 144.104 72.776 83.528 41.454 Q 109.911 98.202 107.664 160.743 Q 97.409 171.626 83.331 176.669',
    'I BUILD RESILIENT STRENGTH':
      'M 176.472 41.454 Q 115.896 72.776 47.702 73.194 Q 143.857 73.782 229.271 117.946 Q 189.002 168.886 130.000 196.000 Q 104.346 191.935 83.331 176.669 Q 93.145 114.734 130.000 64.000 Q 104.920 104.920 64.000 130.000 Q 120.617 167.755 153.932 227.094 Q 130.000 230.000 106.068 227.094',
    'BCDFGHJKLMNPQRSTVWXYZ':
      'M 176.472 41.454 Q 196.312 55.149 212.298 73.194 Q 223.502 94.540 229.271 117.946 Q 223.220 165.354 196.312 204.851 Q 176.472 218.546 153.932 227.094 Q 130.000 230.000 106.068 227.094 Q 63.887 204.626 36.498 165.460 Q 30.729 142.054 30.729 117.946 Q 36.498 94.540 47.702 73.194 Q 63.688 55.149 83.528 41.454 Q 109.469 47.151 130.000 64.000 Q 170.920 89.080 196.000 130.000 Q 191.935 155.654 176.669 176.669 Q 155.654 191.935 130.000 196.000 Q 104.346 191.935 83.331 176.669 Q 68.065 155.654 64.000 130.000 Q 92.440 103.080 130.000 92.000 Q 151.221 100.792 166.140 118.257 Q 164.336 141.157 152.336 160.743 Q 130.000 166.103 107.664 160.743 Q 95.664 141.157 93.860 118.257',
  },
};

const PHRASES = Object.keys(REFERENCE_PATHS.single) as (keyof typeof REFERENCE_PATHS.single)[];

function expectPoint(actual: { x: number; y: number }, expected: [number, number]): void {
  expect(actual.x).toBeCloseTo(expected[0], 9);
  expect(actual.y).toBeCloseTo(expected[1], 9);
}

describe('wheel reference parity (Python → TypeScript)', () => {
  it('uses the exact reference constants and ring group order', () => {
    expect(CURVE_SUBTLE).toBe(0.12);
    expect(WHEEL1_RADIUS).toBe(100);
    expect(WHEEL2_RADII).toEqual({ outer: 100, middle: 66, inner: 38 });
    expect(WHEEL2_GROUPS).toEqual([
      { ring: 'outer', letters: 'ABCDEFGHIJKLM' },
      { ring: 'middle', letters: 'NOPQRSTU' },
      { ring: 'inner', letters: 'VWXYZ' },
    ]);
    expect(WHEEL_CENTER).toBe(130);
    expect(WHEEL_CANVAS).toBe(260);
  });

  it('places single-ring A–Z and three-ring A–M / N–U / V–Z clockwise from top', () => {
    const single = wheel1Points(CX, CY);
    const multi = wheel2Points(CX, CY);

    expectPoint(single.get('A')!, [130, 30]);
    expectPoint(single.get('B')!, [153.9315664287558, 32.9058182573948]);
    expectPoint(multi.get('A')!, [130, 30]);
    expectPoint(multi.get('N')!, [130, 64]);
    expectPoint(multi.get('V')!, [130, 92]);

    for (let index = 0; index < 26; index += 1) {
      const letter = String.fromCharCode(65 + index);
      const point = single.get(letter)!;
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 26;
      expectPoint(point, [
        CX + WHEEL1_RADIUS * Math.cos(angle),
        CY + WHEEL1_RADIUS * Math.sin(angle),
      ]);
    }

    const ringCounts = WHEEL2_GROUPS.map((group) => group.letters.length);
    expect(ringCounts).toEqual([13, 8, 5]);
    let cursor = 0;
    for (const group of WHEEL2_GROUPS) {
      for (let index = 0; index < group.letters.length; index += 1) {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / group.letters.length;
        expectPoint(multi.get(group.letters[index]!)!, [
          CX + WHEEL2_RADII[group.ring] * Math.cos(angle),
          CY + WHEEL2_RADII[group.ring] * Math.sin(angle),
        ]);
        cursor += 1;
      }
    }
    expect(cursor).toBe(26);
  });

  it('clamps controls to the maximum wheel radius without moving endpoints', () => {
    const p0 = { x: 229.271, y: 117.946 };
    const p1 = { x: 230, y: 142.054 };
    const control = segmentControls(p0, p1, CX, CY, CURVE_SUBTLE);
    const distance = Math.hypot(control.x - CX, control.y - CY);
    expect(distance).toBeLessThanOrEqual(WHEEL1_RADIUS + 1e-9);

    const insidePair = glyphSegments('BC', wheel1Points(CX, CY), CX, CY, CURVE_SUBTLE);
    expect(insidePair).toHaveLength(1);
    const [segment] = insidePair;
    expectPoint(segment![0], [153.9315664287558, 32.9058182573948]);
    expectPoint(segment![2], [176.47231720437685, 41.45439743467901]);
    const midpoint = quadPoint(segment![0], segment![1], segment![2], 0.5);
    expect(Number.isFinite(midpoint.x)).toBe(true);
    expect(Number.isFinite(midpoint.y)).toBe(true);
  });

  for (const phrase of PHRASES) {
    for (const mode of ['single', 'multi'] as const) {
      it(`matches Python path for ${mode} wheel · ${phrase}`, () => {
        const intention = processIntention(phrase);
        const sigil = buildWheelSigil(intention.letters, { mode, cx: CX, cy: CY });
        expect(sigil.letters).toEqual(Array.from(intention.letters));
        expect(sigil.pathD).toBe(REFERENCE_PATHS[mode][phrase]);
        const expectedLetters = Array.from(
          new Set(Array.from(phrase.toUpperCase()).filter((char) => /[A-Z]/.test(char))),
        ).filter((char) => !'AEIOU'.includes(char));
        expect(sigil.letters).toEqual(expectedLetters);
        for (const entry of sigil.sequence) {
          expect(Number.isFinite(entry.x)).toBe(true);
          expect(Number.isFinite(entry.y)).toBe(true);
        }
      });
    }
  }

  it('matches reference_unused point coordinates for every wheel position', () => {
    const single = buildWheelSigil(processIntention('BE CALM').letters, {
      mode: 'single',
      cx: CX,
      cy: CY,
    });
    const multi = buildWheelSigil(processIntention('BE CALM').letters, {
      mode: 'multi',
      cx: CX,
      cy: CY,
    });
    const expectedSingleB = [153.9315664287558, 32.9058182573948] as const;
    const expectedMultiC = [212.29838658936563, 73.19352532688441] as const;
    expectPoint(single.points.find((point) => point.letter === 'B')!, [...expectedSingleB]);
    expectPoint(multi.points.find((point) => point.letter === 'C')!, [...expectedMultiC]);
    expect(single.points).toHaveLength(26);
    expect(multi.points).toHaveLength(26);
  });
});

describe('wheel model retention', () => {
  it('keeps source indexes, wheel coordinates, endpoints and controls in memory', () => {
    const intention = processIntention('café I BUILD RESILIENT STRENGTH');
    const sigil = composeWheelSigil(intention, { mode: 'multi' });
    expect(sigil.letters).toEqual(Array.from(intention.letters));
    expect(sigil.sequence.map((entry) => entry.sourceIndex)).toEqual(
      intention.characters
        .filter((character) => character.classification === 'kept')
        .map((character) => character.index),
    );
    expect(sigil.points).toHaveLength(26);
    expect(sigil.segments).toHaveLength(sigil.letters.length - 1);
    for (const segment of sigil.segments) {
      expect(Number.isFinite(segment.p0.x)).toBe(true);
      expect(Number.isFinite(segment.control.x)).toBe(true);
      expect(Number.isFinite(segment.p1.x)).toBe(true);
      expect(segment.from).toMatch(/^[B-DF-HJ-NP-TV-Z]$/);
      expect(segment.to).toMatch(/^[B-DF-HJ-NP-TV-Z]$/);
    }
  });

  it('is deterministic and mode changes the geometry, never the letters', () => {
    const intention = processIntention('I PROTECT MY SPACE');
    const a = composeWheelSigil(intention, { mode: 'multi' });
    const b = composeWheelSigil(intention, { mode: 'multi' });
    const single = composeWheelSigil(intention, { mode: 'single' });
    expect(b).toEqual(a);
    expect(single.letters).toEqual(a.letters);
    expect(single.pathD).not.toBe(a.pathD);
  });
});

describe('wheel edge cases', () => {
  it('handles zero letters as an empty model', () => {
    const sigil = composeWheelSigil(processIntention('AEIOU 42!'), { mode: 'multi' });
    expect(sigil.isEmpty).toBe(true);
    expect(sigil.letters).toEqual([]);
    expect(sigil.sequence).toEqual([]);
    expect(sigil.segments).toEqual([]);
    expect(sigil.pathD).toBeNull();
    expect(sigil.dot).toBeNull();
    expect(sigil.points).toHaveLength(26);
  });

  it('handles one letter as a visible dot, not an empty path', () => {
    const sigil = composeWheelSigil(processIntention('B'), { mode: 'multi' });
    expect(sigil.letters).toEqual(['B']);
    expect(sigil.segments).toEqual([]);
    expect(sigil.pathD).toBeNull();
    expect(sigil.dot).not.toBeNull();
    expect(sigil.dot!.letter).toBe('B');
    expect(sigil.dot!.x).toBeCloseTo(176.47231720437685, 9);
    expect(sigil.dot!.y).toBeCloseTo(41.45439743467901, 9);
    expect(sigil.dot!.radius).toBe(3.5);
  });

  it('handles two letters as a single quadratic segment', () => {
    const sigil = composeWheelSigil(processIntention('BC'), { mode: 'single' });
    expect(sigil.segments).toHaveLength(1);
    expect(sigil.pathD).toBe(
      'M 153.932 32.906 Q 165.460 36.498 176.472 41.454',
    );
    expect(sigil.dot).toBeNull();
  });

  it('rejects unsupported characters in the low-level builder', () => {
    expect(() => buildWheelSigil('B1', { mode: 'single' })).toThrow(/unsupported character/i);
    expect(() => buildWheelSigil(['é'], { mode: 'single' })).toThrow(/unsupported character/i);
  });

  it('reduction comes from the existing processIntention', () => {
    const intention = processIntention('I MAKE TIME TO CREATE');
    const sigil = composeWheelSigil(intention, { mode: 'single' });
    expect(sigil.letters).toEqual(intention.letters);
    expect(sigil.letters).toEqual(['M', 'K', 'T', 'C', 'R']);
  });
});

describe('wheel path serialization', () => {
  it('formats endpoints and controls at the reference three-decimal precision', () => {
    const points = wheel1Points(CX, CY);
    const segments = glyphSegments('BCLM', points, CX, CY, CURVE_SUBTLE);
    expect(wheelPathD(segments)).toBe(REFERENCE_PATHS.single['BE CALM']);
  });
});

describe('wheel performance on this Pi', () => {
  it('builds the full consonant alphabet well under 50 ms', () => {
    const letters = 'BCDFGHJKLMNPQRSTVWXYZ';
    for (let index = 0; index < 5; index += 1) {
      buildWheelSigil(letters, { mode: 'multi' });
    }
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const start = performance.now();
      buildWheelSigil(letters, { mode: index % 2 === 0 ? 'multi' : 'single' });
      samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    expect(samples[samples.length - 1]!).toBeLessThan(50);
    expect(p95).toBeLessThan(50);
  });
});
