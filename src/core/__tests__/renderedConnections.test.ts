import { describe, expect, it } from 'vitest';

import { composeSigil, composeSigilVariants } from '../compose';
import { Segment, Vec, collinearOverlap, segmentIntersection } from '../geometry';
import { processIntention } from '../intention';
import { compositionToExportSvg } from '../svg';

interface ParsedStroke {
  readonly points: readonly Vec[];
  readonly closed: boolean;
}

type Matrix = readonly [number, number, number, number, number, number];

interface RenderedStroke {
  readonly localPoints: readonly Vec[];
  readonly points: readonly Vec[];
  readonly closed: boolean;
  readonly matrix: Matrix;
}

interface RenderedLetter {
  readonly strokes: readonly RenderedStroke[];
}

interface RenderedSegment {
  readonly p0: Vec;
  readonly p1: Vec;
  readonly strokeIndex: number;
  readonly segmentIndex: number;
  readonly pointTolerance: number;
}

interface ContactMeasurement {
  readonly directionCross: number;
  readonly separation: number | null;
  readonly overlap: number;
  readonly minDistance: number;
  readonly t: number;
  readonly u: number;
  readonly hasIntersection: boolean;
}

interface ContactCheck {
  readonly measurement: ContactMeasurement;
  readonly tolerance: number;
}

const SVG_DECIMAL_PLACES = 9;
const SVG_QUANTUM = 0.5 * 10 ** -SVG_DECIMAL_PLACES;
const EPSILON = 1e-12;

// Every path coordinate and matrix coefficient is rounded to 9 decimal places
// before export. For x' = a*x + c*y + e that gives a worst-case x error of
// SVG_QUANTUM * (|x| + |y| + 1 + |a| + |c|) and an analogous y error. The
// resulting per-point tolerance is derived from the parsed matrix and local
// point, not from a claim that the exported numbers are mathematically exact.
function endpointRoundingBound(matrix: Matrix, point: Vec): number {
  const [a, b, c, d] = matrix;
  const localMagnitude = Math.abs(point.x) + Math.abs(point.y);
  const xError =
    SVG_QUANTUM * (localMagnitude + 1 + Math.abs(a) + Math.abs(c));
  const yError =
    SVG_QUANTUM * (localMagnitude + 1 + Math.abs(b) + Math.abs(d));
  return Math.hypot(xError, yError);
}

function parsePathData(pathData: string): ParsedStroke[] {
  const tokens = pathData.match(/[MLZ]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const strokes: ParsedStroke[] = [];
  let points: Vec[] = [];
  let command = '';
  let closed = false;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[MLZ]$/.test(token)) {
      command = token;
      index += 1;
      if (command === 'M') {
        if (points.length > 0) {
          strokes.push({ points, closed });
        }
        points = [];
        closed = false;
      } else if (command === 'Z') {
        closed = true;
      }
      continue;
    }
    if (command === 'M' || command === 'L') {
      const x = Number(tokens[index]);
      const y = Number(tokens[index + 1]);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      points.push(new Vec(x, y));
      index += 2;
      if (command === 'M') {
        command = 'L';
      }
      continue;
    }
    index += 1;
  }
  if (points.length > 0) {
    strokes.push({ points, closed });
  }
  return strokes;
}

function parseMatrix(value: string): Matrix {
  const match = value.match(/^matrix\(([^)]+)\)$/);
  expect(match).not.toBeNull();
  const values = match![1]!.trim().split(/\s+/).map(Number);
  expect(values).toHaveLength(6);
  return values as unknown as Matrix;
}

function transformPoint(matrix: Matrix, point: Vec): Vec {
  const [a, b, c, d, e, f] = matrix;
  return new Vec(a * point.x + c * point.y + e, b * point.x + d * point.y + f);
}

function serializeLetters(svg: string): RenderedLetter[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return Array.from(doc.querySelectorAll('path')).map((path) => {
    const matrix = parseMatrix(path.getAttribute('transform')!);
    return {
      strokes: parsePathData(path.getAttribute('d')!).map((stroke) => ({
        localPoints: stroke.points,
        points: stroke.points.map((point) => transformPoint(matrix, point)),
        closed: stroke.closed,
        matrix,
      })),
    };
  });
}

function letterSegments(letter: RenderedLetter): RenderedSegment[] {
  const segments: RenderedSegment[] = [];
  letter.strokes.forEach((stroke, strokeIndex) => {
    if (stroke.points.length < 2) {
      return;
    }
    const last = stroke.closed ? stroke.points.length : stroke.points.length - 1;
    for (let index = 0; index < last; index += 1) {
      const nextIndex = (index + 1) % stroke.points.length;
      const localStart = stroke.localPoints[index]!;
      const localEnd = stroke.localPoints[nextIndex]!;
      segments.push({
        p0: stroke.points[index]!,
        p1: stroke.points[nextIndex]!,
        strokeIndex,
        segmentIndex: index,
        pointTolerance: Math.max(
          endpointRoundingBound(stroke.matrix, localStart),
          endpointRoundingBound(stroke.matrix, localEnd),
        ),
      });
    }
  });
  return segments;
}

function strokeSegments(stroke: RenderedStroke): Array<{ p0: Vec; p1: Vec }> {
  const segments: Array<{ p0: Vec; p1: Vec }> = [];
  const last = stroke.closed ? stroke.points.length : stroke.points.length - 1;
  for (let index = 0; index < last; index += 1) {
    segments.push({
      p0: stroke.points[index]!,
      p1: stroke.points[(index + 1) % stroke.points.length]!,
    });
  }
  return segments;
}

function sub(left: Vec, right: Vec): Vec {
  return new Vec(left.x - right.x, left.y - right.y);
}

function dot(left: Vec, right: Vec): number {
  return left.x * right.x + left.y * right.y;
}

function cross(left: Vec, right: Vec): number {
  return left.x * right.y - left.y * right.x;
}

function length(value: Vec): number {
  return Math.hypot(value.x, value.y);
}

function pointSegmentDistance(point: Vec, start: Vec, end: Vec): number {
  const direction = sub(end, start);
  const denominator = dot(direction, direction);
  if (denominator <= EPSILON) {
    return length(sub(point, start));
  }
  const t = Math.max(0, Math.min(1, dot(sub(point, start), direction) / denominator));
  return length(sub(point, new Vec(start.x + direction.x * t, start.y + direction.y * t)));
}

function segmentDistance(first: RenderedSegment, second: RenderedSegment): number {
  return Math.min(
    pointSegmentDistance(first.p0, second.p0, second.p1),
    pointSegmentDistance(first.p1, second.p0, second.p1),
    pointSegmentDistance(second.p0, first.p0, first.p1),
    pointSegmentDistance(second.p1, first.p0, first.p1),
  );
}

function clippedCenterlineSeparation(
  first: RenderedSegment,
  second: RenderedSegment,
  firstUnit: Vec,
  secondUnit: Vec,
): number | null {
  const firstLength = length(sub(first.p1, first.p0));
  const secondLength = length(sub(second.p1, second.p0));
  const distances: number[] = [];

  for (const point of [first.p0, first.p1]) {
    const projected = dot(sub(point, second.p0), secondUnit);
    if (projected >= 0 && projected <= secondLength) {
      distances.push(Math.abs(cross(sub(point, second.p0), secondUnit)));
    }
  }
  for (const point of [second.p0, second.p1]) {
    const projected = dot(sub(point, first.p0), firstUnit);
    if (projected >= 0 && projected <= firstLength) {
      distances.push(Math.abs(cross(sub(point, first.p0), firstUnit)));
    }
  }

  return distances.length > 0 ? Math.max(...distances) : null;
}

function measureContact(
  first: RenderedSegment,
  second: RenderedSegment,
): ContactMeasurement | null {
  const firstVector = sub(first.p1, first.p0);
  const secondVector = sub(second.p1, second.p0);
  const firstLength = length(firstVector);
  const secondLength = length(secondVector);
  if (firstLength <= EPSILON || secondLength <= EPSILON) {
    return null;
  }

  const firstUnit = firstVector.div(firstLength);
  const secondUnit = secondVector.div(secondLength);
  const denominator = cross(firstVector, secondVector);
  let t = Number.NaN;
  let u = Number.NaN;
  let hasIntersection = false;
  if (Math.abs(denominator) > EPSILON) {
    const offset = sub(second.p0, first.p0);
    t = cross(offset, secondVector) / denominator;
    u = cross(offset, firstVector) / denominator;
    hasIntersection = true;
  }

  const t0 = dot(sub(second.p0, first.p0), firstUnit);
  const t1 = dot(sub(second.p1, first.p0), firstUnit);
  const overlap = Math.min(firstLength, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));

  return {
    directionCross: Math.abs(cross(firstUnit, secondUnit)),
    separation: clippedCenterlineSeparation(first, second, firstUnit, secondUnit),
    overlap,
    minDistance: segmentDistance(first, second),
    t,
    u,
    hasIntersection,
  };
}

function contactTolerance(first: RenderedSegment, second: RenderedSegment): number {
  return first.pointTolerance + second.pointTolerance;
}

function independentShared(
  first: RenderedSegment,
  second: RenderedSegment,
): ContactCheck | null {
  const measurement = measureContact(first, second);
  if (!measurement) {
    return null;
  }
  const tolerance = contactTolerance(first, second);
  const angularTolerance =
    2 *
      (first.pointTolerance / length(sub(first.p1, first.p0)) +
        second.pointTolerance / length(sub(second.p1, second.p0))) +
    EPSILON;

  if (measurement.directionCross > angularTolerance) {
    return null;
  }
  if (measurement.overlap <= 0) {
    return null;
  }
  if (measurement.separation === null || measurement.separation > tolerance) {
    return null;
  }
  return { measurement, tolerance };
}

function independentCrossing(
  first: RenderedSegment,
  second: RenderedSegment,
): ContactCheck | null {
  const measurement = measureContact(first, second);
  if (!measurement || !measurement.hasIntersection) {
    return null;
  }
  const tolerance = contactTolerance(first, second);
  const firstMargin = tolerance / length(sub(first.p1, first.p0));
  const secondMargin = tolerance / length(sub(second.p1, second.p0));
  if (
    measurement.t < -firstMargin ||
    measurement.t > 1 + firstMargin ||
    measurement.u < -secondMargin ||
    measurement.u > 1 + secondMargin
  ) {
    return null;
  }
  return { measurement, tolerance };
}

function independentTouch(
  first: RenderedSegment,
  second: RenderedSegment,
): ContactCheck | null {
  const crossing = independentCrossing(first, second);
  if (crossing) {
    return crossing;
  }
  const measurement = measureContact(first, second);
  if (!measurement) {
    return null;
  }
  const tolerance = contactTolerance(first, second);
  if (measurement.minDistance > tolerance) {
    return null;
  }
  return { measurement, tolerance };
}

function independentContact(first: RenderedSegment, second: RenderedSegment): boolean {
  if (independentShared(first, second) || independentCrossing(first, second)) {
    return true;
  }
  const measurement = measureContact(first, second);
  return Boolean(measurement && measurement.minDistance <= contactTolerance(first, second));
}

function segmentOf(
  letter: RenderedLetter,
  strokeIndex: number,
  segmentIndex: number,
): RenderedSegment | undefined {
  return letterSegments(letter).find(
    (segment) =>
      segment.strokeIndex === strokeIndex && segment.segmentIndex === segmentIndex,
  );
}

function productionSegment(segment: Segment): RenderedSegment {
  return {
    p0: segment.p0,
    p1: segment.p1,
    strokeIndex: Number(segment.strokeId) || 0,
    segmentIndex: segment.segIndex,
    pointTolerance: 0,
  };
}

describe('serialized SVG connections hold within export rounding tolerance', () => {
  it('reconstructs each recorded connection from exported path coordinates', () => {
    const composition = composeSigil(processIntention('I MAKE TIME TO CREATE'), {
      seed: 424242,
    });
    const svg = compositionToExportSvg(composition);
    const rendered = serializeLetters(svg);
    expect(rendered).toHaveLength(composition.letters.length);
    expect(composition.connections.length).toBeGreaterThan(0);

    for (const connection of composition.connections) {
      expect(connection.kind).not.toBe('near');
      const from = segmentOf(
        rendered[connection.fromSurvivingIndex]!,
        connection.fromSegment.strokeIndex,
        connection.fromSegment.segmentIndex,
      );
      const to = segmentOf(
        rendered[connection.toSurvivingIndex]!,
        connection.toSegment.strokeIndex,
        connection.toSegment.segmentIndex,
      );
      expect(from).toBeDefined();
      expect(to).toBeDefined();

      if (connection.kind === 'shared') {
        const check = independentShared(from!, to!);
        expect(check).not.toBeNull();
        expect(check!.measurement.separation).toBeLessThanOrEqual(check!.tolerance);
        expect(check!.measurement.overlap).toBeGreaterThan(0);
      } else if (connection.kind === 'cross') {
        expect(independentCrossing(from!, to!)).not.toBeNull();
      } else {
        expect(independentTouch(from!, to!)).not.toBeNull();
      }
    }
  }, 30000);

  it('keeps every letter in one rendered network within export rounding tolerance', () => {
    const variants = composeSigilVariants(processIntention('I BUILD RESILIENT STRENGTH'), 0);
    expect(variants).toHaveLength(3);

    for (const composition of variants) {
      const svg = compositionToExportSvg(composition);
      const rendered = serializeLetters(svg);
      const parent = new Map<string, string>();
      const find = (id: string): string => {
        let root = id;
        while (parent.get(root) !== undefined && parent.get(root) !== root) {
          root = parent.get(root)!;
        }
        return root;
      };
      const union = (left: string, right: string): void => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) {
          parent.set(rightRoot, leftRoot);
        }
      };

      const owned = rendered.map((letter, letterIndex) => {
        const segments = letterSegments(letter);
        segments.forEach((segment) => {
          const id = `${letterIndex}:${segment.strokeIndex}:${segment.segmentIndex}`;
          parent.set(id, id);
        });
        return { letterIndex, segments };
      });
      const allSegments = owned.flatMap(({ letterIndex, segments }) =>
        segments.map((segment) => ({ letterIndex, segment })),
      );
      for (let first = 0; first < allSegments.length; first += 1) {
        for (let second = first + 1; second < allSegments.length; second += 1) {
          const left = allSegments[first]!;
          const right = allSegments[second]!;
          if (independentContact(left.segment, right.segment)) {
            union(
              `${left.letterIndex}:${left.segment.strokeIndex}:${left.segment.segmentIndex}`,
              `${right.letterIndex}:${right.segment.strokeIndex}:${right.segment.segmentIndex}`,
            );
          }
        }
      }
      const roots = new Set(
        allSegments.map(({ letterIndex, segment }) =>
          find(`${letterIndex}:${segment.strokeIndex}:${segment.segmentIndex}`),
        ),
      );
      expect(roots.size).toBe(1);
    }
  }, 60000);

  it('reports measured worst-case deviations across corpus and prototype variants', () => {
    const corpus = [
      'BE CALM',
      'I MAKE TIME TO CREATE',
      'I PROTECT MY SPACE',
      'I BUILD RESILIENT STRENGTH',
      'QUIET',
    ];
    const variants = ['size-spine', 'size-steps', 'size-anchor'];
    let contacts = 0;
    let sharedContacts = 0;
    let crossingContacts = 0;
    let touchContacts = 0;
    let maxSharedSeparation = 0;
    let maxSharedTolerance = 0;
    let maxSharedRatio = 0;
    let maxCrossingExcess = 0;
    let maxTouchDistance = 0;
    const perVariant = new Map<
      string,
      { contacts: number; maxSharedSeparation: number; maxSharedTolerance: number }
    >();

    for (const phrase of corpus) {
      const intention = processIntention(phrase);
      for (const variantKey of variants) {
        const composition = composeSigil(intention, { seed: 424242, variantKey });
        const rendered = serializeLetters(compositionToExportSvg(composition));
        const stats = perVariant.get(variantKey) ?? {
          contacts: 0,
          maxSharedSeparation: 0,
          maxSharedTolerance: 0,
        };

        for (const connection of composition.connections) {
          const from = segmentOf(
            rendered[connection.fromSurvivingIndex]!,
            connection.fromSegment.strokeIndex,
            connection.fromSegment.segmentIndex,
          );
          const to = segmentOf(
            rendered[connection.toSurvivingIndex]!,
            connection.toSegment.strokeIndex,
            connection.toSegment.segmentIndex,
          );
          expect(from).toBeDefined();
          expect(to).toBeDefined();
          contacts += 1;
          stats.contacts += 1;

          if (connection.kind === 'shared') {
            const check = independentShared(from!, to!);
            expect(check).not.toBeNull();
            sharedContacts += 1;
            maxSharedSeparation = Math.max(
              maxSharedSeparation,
              check!.measurement.separation ?? 0,
            );
            maxSharedTolerance = Math.max(maxSharedTolerance, check!.tolerance);
            maxSharedRatio = Math.max(
              maxSharedRatio,
              (check!.measurement.separation ?? 0) / check!.tolerance,
            );
            stats.maxSharedSeparation = Math.max(
              stats.maxSharedSeparation,
              check!.measurement.separation ?? 0,
            );
            stats.maxSharedTolerance = Math.max(
              stats.maxSharedTolerance,
              check!.tolerance,
            );
          } else if (connection.kind === 'cross') {
            const check = independentCrossing(from!, to!);
            expect(check).not.toBeNull();
            crossingContacts += 1;
            const excess = Math.max(
              0,
              -check!.measurement.t,
              check!.measurement.t - 1,
              -check!.measurement.u,
              check!.measurement.u - 1,
            );
            maxCrossingExcess = Math.max(maxCrossingExcess, excess);
          } else {
            const check = independentTouch(from!, to!);
            expect(check).not.toBeNull();
            touchContacts += 1;
            maxTouchDistance = Math.max(
              maxTouchDistance,
              check!.measurement.minDistance,
            );
          }
        }
        perVariant.set(variantKey, stats);
      }
    }

    expect(contacts).toBeGreaterThan(0);
    expect(maxSharedSeparation).toBeGreaterThan(0);
    expect(maxSharedRatio).toBeLessThanOrEqual(1);
    expect(maxSharedSeparation).toBeLessThanOrEqual(maxSharedTolerance);
  }, 120000);

  it('keeps the Q glyph tail in contact with its ring within export rounding tolerance', () => {
    const composition = composeSigil(processIntention('QUIET'), { seed: 99 });
    const qIndex = composition.letters.findIndex((letter) => letter.letter === 'Q');
    expect(qIndex).toBeGreaterThanOrEqual(0);
    const rendered = serializeLetters(compositionToExportSvg(composition))[qIndex]!;
    expect(rendered.strokes).toHaveLength(2);

    const ring = rendered.strokes[0]!;
    const tail = rendered.strokes[1]!;
    const tailStart = tail.points[0]!;
    const tailStartTolerance = endpointRoundingBound(
      tail.matrix,
      tail.localPoints[0]!,
    );
    const candidates = strokeSegments(ring).map((segment, index) => {
      const ringStart = ring.localPoints[index]!;
      const ringEnd = ring.localPoints[(index + 1) % ring.localPoints.length]!;
      const ringTolerance = Math.max(
        endpointRoundingBound(ring.matrix, ringStart),
        endpointRoundingBound(ring.matrix, ringEnd),
      );
      return {
        distance: pointSegmentDistance(tailStart, segment.p0, segment.p1),
        tolerance: tailStartTolerance + ringTolerance,
      };
    });
    candidates.sort((left, right) => left.distance - right.distance);
    const nearest = candidates[0]!;
    expect(nearest.distance).toBeLessThanOrEqual(nearest.tolerance);
  }, 30000);
});

describe('production tolerances are not proof of identical centerlines', () => {
  it('production segmentIntersection accepts a crossing just beyond an endpoint', () => {
    const first = new Segment(new Vec(0, 0), new Vec(1, 0), 'a', 0);
    const second = new Segment(
      new Vec(1 + 5e-9, -1),
      new Vec(1 + 5e-9, 1),
      'b',
      0,
    );

    const hit = segmentIntersection(first, second);
    expect(hit).not.toBeNull();
    expect(hit![0].x).toBeGreaterThan(1);
    expect(hit![0].x - 1).toBeCloseTo(5e-9, 12);
    expect(independentCrossing(productionSegment(first), productionSegment(second))).toBeNull();
  });

  it('production collinearOverlap accepts a 5e-9 centerline offset', () => {
    const base = new Segment(new Vec(0, 0), new Vec(1, 0), 'a', 0);
    const offset = new Segment(new Vec(0, 5e-9), new Vec(1, 5e-9), 'b', 0);

    const shared = collinearOverlap(base, offset, 0.032, 0.075);
    expect(shared).not.toBeNull();

    const measurement = measureContact(
      productionSegment(base),
      productionSegment(offset),
    );
    expect(measurement).not.toBeNull();
    expect(measurement!.separation).toBeGreaterThan(0);
    expect(measurement!.separation).toBeCloseTo(5e-9, 12);
    expect(
      independentShared(productionSegment(base), productionSegment(offset)),
    ).toBeNull();
  });
});
