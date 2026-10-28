import { describe, expect, it } from 'vitest';

import {
  composeSigil,
  MAX_CANDIDATES_PER_LETTER,
  MAX_COMPANION_SCALE,
  MIN_COMPANION_SCALE,
  SPINE_SCALE,
  variantSeeds,
  type CompositionLetter,
  type SigilComposition,
} from '../compose';
import {
  GEOMETRY_EPSILON,
  QUADRATIC_SEGMENTS_PER_CURVE,
  getGlyphGeometry,
  measureSegmentOverlap,
  transformGlyphGeometry,
  type PolylineSegment,
  type SegmentRef,
} from '../geometry';
import { ALPHABET, GLYPHS } from '../glyphs';
import { processIntention } from '../intention';
import { compositionToExportSvg } from '../svg';

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const CENTER = 256;
const EPS = 1e-9;
const SEEDS = [0, 1, 2, 12345, 0xdeadbeef] as const;

function transformedGeometry(composition: SigilComposition, survivingIndex: number) {
  const letter = composition.letters[survivingIndex]!;
  const geometry = getGlyphGeometry(letter.glyphId);
  expect(geometry).toBeDefined();
  return transformGlyphGeometry(geometry!, letter.transform);
}

function findSegment(geometry: ReturnType<typeof transformedGeometry>, ref: SegmentRef): PolylineSegment {
  const segment = geometry.segments.find(
    (candidate) =>
      candidate.strokeIndex === ref.strokeIndex && candidate.segmentIndex === ref.segmentIndex,
  );
  expect(segment).toBeDefined();
  return segment!;
}

function projectedOverlap(from: PolylineSegment, to: PolylineSegment): { start: number; end: number; length: number } {
  const dx = to.end.x - to.start.x;
  const dy = to.end.y - to.start.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const project = (point: { x: number; y: number }) =>
    (point.x - to.start.x) * ux + (point.y - to.start.y) * uy;
  const values = [project(from.start), project(from.end)].sort((left, right) => left - right);
  const start = Math.max(0, values[0]!);
  const end = Math.min(length, values[1]!);
  return { start, end, length: Math.max(0, end - start) };
}

function assertConnectedGraph(composition: SigilComposition): void {
  const count = composition.letters.length;
  if (count <= 1) {
    return;
  }

  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) {
      parent[rootRight] = rootLeft;
    }
  };

  for (const connection of composition.connections) {
    union(connection.fromSurvivingIndex, connection.toSurvivingIndex);
  }

  const roots = new Set(Array.from({ length: count }, (_, index) => find(index)));
  expect(roots.size).toBe(1);
}

function assertConnectionIsExact(composition: SigilComposition): void {
  for (const connection of composition.connections) {
    const fromGeometry = transformedGeometry(composition, connection.fromSurvivingIndex);
    const toGeometry = transformedGeometry(composition, connection.toSurvivingIndex);
    const fromSegment = findSegment(fromGeometry, connection.fromSegment);
    const toSegment = findSegment(toGeometry, connection.toSegment);
    const measured = measureSegmentOverlap(fromSegment, toSegment, GEOMETRY_EPSILON);
    const expected = projectedOverlap(fromSegment, toSegment);

    expect(measured.collinear).toBe(true);
    expect(measured.parallel).toBe(true);
    expect(measured.length).toBeGreaterThan(GEOMETRY_EPSILON);
    expect(measured.length).toBeCloseTo(connection.overlapLength, 9);
    expect(measured.interval[0]).toBeCloseTo(expected.start, 9);
    expect(measured.interval[1]).toBeCloseTo(expected.end, 9);
    expect(measured.length).toBeCloseTo(expected.length, 9);
    expect(connection.toLetter).toBe(composition.letters[connection.toSurvivingIndex]!.letter);
    expect(connection.fromLetter).toBe(composition.letters[connection.fromSurvivingIndex]!.letter);
  }
}

function weightedCenter(letters: readonly CompositionLetter[]): { x: number; y: number } {
  let weightTotal = 0;
  let x = 0;
  let y = 0;

  for (const letter of letters) {
    const weight = letter.transform.scale * letter.transform.scale;
    weightTotal += weight;
    x += letter.transform.x * weight;
    y += letter.transform.y * weight;
  }

  return { x: x / weightTotal, y: y / weightTotal };
}

describe('glyph polyline geometry', () => {
  it('represents every glyph as ordered polylines with explicit anchors, lengths and tangents', () => {
    for (const letter of ALPHABET) {
      const geometry = getGlyphGeometry(letter);
      expect(geometry, letter).toBeDefined();
      expect(geometry!.letter).toBe(letter);
      expect(geometry!.strokes).toHaveLength(GLYPHS[letter]!.paths.length);
      expect(geometry!.segments.length).toBeGreaterThan(0);
      expect(geometry!.segments).toEqual(geometry!.strokes.flatMap((stroke) => stroke.segments));

      for (const stroke of geometry!.strokes) {
        expect(stroke.points).toHaveLength(stroke.segments.length + 1);

        stroke.segments.forEach((segment, index) => {
          expect(segment.strokeIndex).toBe(stroke.index);
          expect(segment.segmentIndex).toBe(index);
          const dx = segment.end.x - segment.start.x;
          const dy = segment.end.y - segment.start.y;
          expect(segment.length).toBeCloseTo(Math.hypot(dx, dy), 12);
          expect(segment.midpoint.x).toBeCloseTo((segment.start.x + segment.end.x) / 2, 12);
          expect(segment.midpoint.y).toBeCloseTo((segment.start.y + segment.end.y) / 2, 12);
          expect(Math.hypot(segment.tangent.x, segment.tangent.y)).toBeCloseTo(1, 12);
          expect(segment.length).toBeGreaterThan(0);
        });
      }
    }
  });

  it('linearizes quadratic curves consistently and retains every constituent segment', () => {
    const first = getGlyphGeometry('C')!;
    const second = getGlyphGeometry('C')!;

    expect(second).toEqual(first);
    expect(first.strokes).toHaveLength(GLYPHS.C!.paths.length);
    expect(first.segments).toHaveLength(4 * QUADRATIC_SEGMENTS_PER_CURVE);
    expect(first.segments.every((segment) => segment.length > 0)).toBe(true);
  });
});

describe('spine-dominant parallel-overlap generator', () => {
  it('makes a single surviving letter a centered 1.22 spine with intact strokes', () => {
    for (const seed of SEEDS) {
      const composition = composeSigil(processIntention('K'), { seed });
      const letter = composition.letters[0]!;

      expect(composition.spineSurvivingIndex).toBe(0);
      expect(composition.connections).toEqual([]);
      expect(composition.searchStats.acceptedConnections).toBe(0);
      expect(letter.transform.scale).toBeCloseTo(SPINE_SCALE, 12);
      expect(letter.transform.x).toBeCloseTo(CENTER, 12);
      expect(letter.transform.y).toBeCloseTo(CENTER, 12);
      expect(letter.path).toBe(GLYPHS.K!.paths.join(' '));
    }
  });

  it('attaches the second letter to the spine with mathematically verified collinearity and interval', () => {
    for (const seed of SEEDS) {
      const composition = composeSigil(processIntention('BK'), { seed });
      const spineIndex = composition.spineSurvivingIndex!;
      const connection = composition.connections[0]!;
      const spine = composition.letters[spineIndex]!;
      const companion = composition.letters[connection.fromSurvivingIndex]!;

      expect(composition.letters.map((letter) => letter.letter)).toEqual(['B', 'K']);
      expect(connection.toSurvivingIndex).toBe(spineIndex);
      expect(connection.fromSurvivingIndex).not.toBe(spineIndex);
      expect(companion.transform.scale).toBeLessThanOrEqual(
        spine.transform.scale * (MAX_COMPANION_SCALE / SPINE_SCALE) + EPS,
      );
      expect(companion.transform.scale).toBeGreaterThanOrEqual(
        spine.transform.scale * (MIN_COMPANION_SCALE / SPINE_SCALE) - EPS,
      );
      assertConnectionIsExact(composition);
      assertConnectedGraph(composition);
    }
  });

  it('preserves every letter, stroke, order, sourceIndex and exact overlap for all 21 consonants', () => {
    const intention = processIntention(CONSONANTS);
    expect(intention.letters).toEqual(CONSONANTS.split(''));

    for (const seed of SEEDS) {
      const composition = composeSigil(intention, { seed });
      const spineIndex = composition.spineSurvivingIndex!;

      expect(composition.letters.map((letter) => letter.letter)).toEqual(intention.letters);
      expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual(
        Array.from({ length: CONSONANTS.length }, (_, index) => index),
      );
      expect(composition.connections).toHaveLength(CONSONANTS.length - 1);
      expect(composition.searchStats.acceptedConnections).toBe(CONSONANTS.length - 1);

      const sources = new Set(composition.connections.map((connection) => connection.fromSurvivingIndex));
      expect(sources.size).toBe(CONSONANTS.length - 1);
      expect(sources.has(spineIndex)).toBe(false);

      for (const letter of composition.letters) {
        expect(letter.glyphId).toBe(letter.letter);
        expect(letter.path).toBe(GLYPHS[letter.letter]!.paths.join(' '));
      }

      assertConnectionIsExact(composition);
      assertConnectedGraph(composition);
    }
  });

  it('chooses a different spine letter for each of the three choice seeds when at least three letters survive', () => {
    for (let count = 3; count <= CONSONANTS.length; count += 1) {
      const phrase = CONSONANTS.slice(0, count);
      const intention = processIntention(phrase);
      const seeds = variantSeeds(intention.letters, 0);
      const compositions = seeds.map((seed) => composeSigil(intention, { seed }));
      const spines = compositions.map((composition) => composition.spineSurvivingIndex);

      expect(new Set(seeds).size).toBe(3);
      expect(new Set(spines).size).toBe(3);
      expect(spines.every((index) => index !== null && index >= 0 && index < count)).toBe(true);

      for (const composition of compositions) {
        expect(composition.letters.map((letter) => letter.letter)).toEqual(intention.letters);
      }
    }
  });

  it('regeneration keeps letter identity but changes the arrangement', () => {
    const intention = processIntention(CONSONANTS);
    const firstRound = variantSeeds(intention.letters, 0).map((seed) =>
      composeSigil(intention, { seed }),
    );
    const secondRound = variantSeeds(intention.letters, 1).map((seed) =>
      composeSigil(intention, { seed }),
    );

    expect(secondRound.map((composition) => composition.seed)).not.toEqual(
      firstRound.map((composition) => composition.seed),
    );

    for (let slot = 0; slot < 3; slot += 1) {
      expect(secondRound[slot]!.letters.map((letter) => letter.letter)).toEqual(intention.letters);
      expect(JSON.stringify(secondRound[slot]!.letters.map((letter) => letter.transform))).not.toBe(
        JSON.stringify(firstRound[slot]!.letters.map((letter) => letter.transform)),
      );
    }
  });

  it('is deterministic for a given seed and varies with a different seed', () => {
    const intention = processIntention('SIGIL');
    const first = composeSigil(intention, { seed: 777 });
    const second = composeSigil(intention, { seed: 777 });
    const other = composeSigil(intention, { seed: 778 });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(other.letters.map((letter) => letter.transform))).not.toBe(
      JSON.stringify(first.letters.map((letter) => letter.transform)),
    );
  });

  it('bounds candidate search per placed letter', () => {
    const composition = composeSigil(processIntention(CONSONANTS), { seed: 2026 });

    expect(composition.searchStats.maxCandidatesPerLetter).toBe(MAX_CANDIDATES_PER_LETTER);
    expect(composition.searchStats.candidatesEvaluated).toBe(
      MAX_CANDIDATES_PER_LETTER * (composition.letters.length - 1),
    );
    expect(composition.searchStats.acceptedConnections).toBe(composition.connections.length);
  });

  it('fits every transformed stroke on the canvas with a balanced center', () => {
    for (const count of [1, 2, 3, 10, 21]) {
      const phrase = CONSONANTS.slice(0, count);

      for (const seed of [0, 1, 2]) {
        const composition = composeSigil(processIntention(phrase), { seed });
        const center = weightedCenter(composition.letters);

        expect(Math.hypot(center.x - CENTER, center.y - CENTER)).toBeLessThanOrEqual(EPS);

        for (const letter of composition.letters) {
          const geometry = transformedGeometry(composition, letter.survivingIndex);

          for (const segment of geometry.segments) {
            for (const point of [segment.start, segment.end]) {
              expect(point.x).toBeGreaterThanOrEqual(0);
              expect(point.x).toBeLessThanOrEqual(composition.width);
              expect(point.y).toBeGreaterThanOrEqual(0);
              expect(point.y).toBeLessThanOrEqual(composition.height);
            }
          }
        }
      }
    }
  });

  it('keeps provenance in memory but never exports source-derived metadata', () => {
    const composition = composeSigil(processIntention('LUNARZ'), { seed: 99 });

    expect(composition.connections.length).toBeGreaterThan(0);
    expect(composition.searchStats.candidatesEvaluated).toBeGreaterThan(0);
    expect(composition.spineSurvivingIndex).not.toBeNull();

    const svg = compositionToExportSvg(composition);
    const lower = svg.toLowerCase();

    for (const token of [
      'data-letter',
      'data-source-index',
      'data-surviving-index',
      'data-seed',
      'provenance',
      'connection',
      'overlap',
      'slide',
      'segmentindex',
      'spine',
      'sourceindex',
      'survivingindex',
    ]) {
      expect(lower).not.toContain(token);
    }

    expect(svg.match(/<path /g)).toHaveLength(composition.letters.length);
    composition.letters.forEach((letter) => {
      expect(letter.path).toBe(GLYPHS[letter.letter]!.paths.join(' '));
      expect(svg).toContain(`d="${letter.renderPath}"`);
    });
  });

  it('generates three 21-letter candidates within a bounded measured runtime', () => {
    const intention = processIntention(CONSONANTS);
    const seeds = variantSeeds(intention.letters, 0);
    const started = performance.now();
    const compositions = seeds.map((seed) => composeSigil(intention, { seed }));
    const elapsed = performance.now() - started;

    console.info(
      `[spine benchmark] 3 candidates x ${intention.letters.length} letters: ${elapsed.toFixed(
        1,
      )} ms (${(elapsed / 3).toFixed(1)} ms/candidate)`,
    );

    expect(compositions).toHaveLength(3);
    expect(compositions.every((composition) => composition.letters.length === 21)).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});
