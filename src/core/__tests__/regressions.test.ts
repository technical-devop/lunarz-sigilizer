import { describe, expect, it } from 'vitest';

import { composeSigil, type CompositionLetter, type SigilComposition } from '../compose';
import {
  GEOMETRY_EPSILON,
  getGlyphGeometry,
  measureSegmentOverlap,
  transformPoint,
  type Point2D,
  type PolylineSegment,
  type SegmentRef,
} from '../geometry';
import { GLYPHS } from '../glyphs';
import { processIntention } from '../intention';
import { compositionToExportSvg } from '../svg';

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const CK_SEED = 2111446587;
const SEEDS = [0, 1, 2, 12345, 0xdeadbeef, CK_SEED] as const;
const COMMAND_PATTERN = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

interface ParsedStroke {
  readonly points: Point2D[];
  readonly closed: boolean;
}

interface RenderedLetterGeometry {
  readonly letter: CompositionLetter;
  readonly strokes: readonly ParsedStroke[];
  readonly segments: readonly PolylineSegment[];
}

function parseNumberList(value: string): number[] {
  return value
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
}

function parseRenderedPath(d: string): ParsedStroke[] {
  const tokens: ({ kind: 'command'; value: string } | { kind: 'number'; value: number })[] = [];

  for (const match of d.matchAll(COMMAND_PATTERN)) {
    const command = match[1];
    if (command !== undefined) {
      tokens.push({ kind: 'command', value: command });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: 'number', value: Number(match[2]) });
    }
  }

  const strokes: ParsedStroke[] = [];
  let current: { points: Point2D[]; closed: boolean } | null = null;
  let cursor = 0;
  const nextNumber = (): number => {
    const token = tokens[cursor];
    if (token?.kind !== 'number') {
      throw new Error(`Expected a number in path "${d}" at token ${cursor}`);
    }
    cursor += 1;
    return token.value;
  };

  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token?.kind !== 'command') {
      throw new Error(`Expected an explicit M/L command in path "${d}"`);
    }

    const command = token.value;
    cursor += 1;

    if (command === 'M') {
      const x = nextNumber();
      const y = nextNumber();
      current = { points: [{ x, y }], closed: false };
      strokes.push(current);
      continue;
    }

    if (command === 'L') {
      if (!current) {
        throw new Error(`Path "${d}" starts a line before a move`);
      }
      const x = nextNumber();
      const y = nextNumber();
      current.points.push({ x, y });
      continue;
    }

    throw new Error(`Rendered geometry used unsupported path command "${command}"`);
  }

  expect(strokes.length).toBeGreaterThan(0);
  return strokes;
}

function buildSegments(strokes: readonly ParsedStroke[]): PolylineSegment[] {
  const segments: PolylineSegment[] = [];

  strokes.forEach((stroke, strokeIndex) => {
    let segmentIndex = 0;

    for (let index = 0; index + 1 < stroke.points.length; index += 1) {
      const start = stroke.points[index]!;
      const end = stroke.points[index + 1]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      if (length <= GEOMETRY_EPSILON) {
        continue;
      }

      segments.push({
        strokeIndex,
        segmentIndex,
        start,
        end,
        midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        length,
        tangent: { x: dx / length, y: dy / length },
      });
      segmentIndex += 1;
    }
  });

  return segments;
}

function parseSerializedTransform(value: string, fallback: CompositionLetter['transform']): {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  mirror: boolean;
} {
  const match = value.match(
    /^translate\(([^)]+)\) rotate\(([^)]+)\) scale\(([^)]+)\) translate\(([^)]+)\)$/,
  );

  if (!match) {
    throw new Error(`Unexpected serialized transform "${value}"`);
  }

  const [x, y] = parseNumberList(match[1]!);
  const [rotation] = parseNumberList(match[2]!);
  const [scaleX, scaleY] = parseNumberList(match[3]!);

  expect(x).toBeDefined();
  expect(y).toBeDefined();
  expect(rotation).toBeDefined();
  expect(scaleX).toBeDefined();
  expect(scaleY).toBeDefined();
  expect(scaleY).toBeCloseTo(fallback.scale, 12);
  expect(Math.abs(scaleX!)).toBeCloseTo(Math.abs(scaleY!), 12);

  return {
    x: x!,
    y: y!,
    rotation: rotation!,
    scale: Math.abs(scaleY!),
    mirror: (scaleX ?? 1) < 0,
  };
}

function transformStrokes(
  strokes: readonly ParsedStroke[],
  transform: ReturnType<typeof parseSerializedTransform>,
): ParsedStroke[] {
  return strokes.map((stroke) => ({
    points: stroke.points.map((point) => transformPoint(transform, point)),
    closed: stroke.closed,
  }));
}

function renderedCompositionGeometry(composition: SigilComposition): {
  readonly svg: string;
  readonly letters: readonly RenderedLetterGeometry[];
} {
  const svg = compositionToExportSvg(composition);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();

  const paths = Array.from(doc.querySelectorAll('path'));
  expect(paths).toHaveLength(composition.letters.length);

  const letters = paths.map((path, index): RenderedLetterGeometry => {
    const letter = composition.letters[index]!;
    const d = path.getAttribute('d') ?? '';
    const transformAttribute = path.getAttribute('transform') ?? '';

    expect(d).not.toMatch(/[QqCcSsAaTtZz]/);
    expect(d).toContain('M ');

    const localGeometry = getGlyphGeometry(letter.glyphId);
    expect(localGeometry).toBeDefined();

    const strokes = parseRenderedPath(d);
    const expectedStrokes = localGeometry!.strokes;
    expect(strokes).toHaveLength(expectedStrokes.length);

    strokes.forEach((stroke, strokeIndex) => {
      const expected = expectedStrokes[strokeIndex]!;
      expect(stroke.points).toHaveLength(expected.points.length);

      stroke.points.forEach((point, pointIndex) => {
        expect(point.x).toBeCloseTo(expected.points[pointIndex]!.x, 12);
        expect(point.y).toBeCloseTo(expected.points[pointIndex]!.y, 12);
      });
    });

    const transform = parseSerializedTransform(transformAttribute, letter.transform);
    const worldStrokes = transformStrokes(strokes, transform);

    return {
      letter,
      strokes: worldStrokes,
      segments: buildSegments(worldStrokes),
    };
  });

  return { svg, letters };
}

function findSegment(
  geometry: { readonly segments: readonly PolylineSegment[] },
  reference: SegmentRef,
): PolylineSegment {
  const segment = geometry.segments.find(
    (candidate) =>
      candidate.strokeIndex === reference.strokeIndex &&
      candidate.segmentIndex === reference.segmentIndex,
  );

  if (!segment) {
    throw new Error(
      `Missing segment ${reference.strokeIndex}:${reference.segmentIndex}`,
    );
  }

  return segment;
}

function cross(left: Point2D, middle: Point2D, right: Point2D): number {
  return (middle.x - left.x) * (right.y - left.y) - (middle.y - left.y) * (right.x - left.x);
}

function pointSegmentDistance(point: Point2D, segment: PolylineSegment): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
    return Math.hypot(point.x - segment.start.x, point.y - segment.start.y);
  }

  const projection = Math.min(
    1,
    Math.max(
      0,
      ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared,
    ),
  );
  const nearestX = segment.start.x + projection * dx;
  const nearestY = segment.start.y + projection * dy;

  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function segmentsTouch(left: PolylineSegment, right: PolylineSegment): boolean {
  if (measureSegmentOverlap(left, right, GEOMETRY_EPSILON).overlaps) {
    return true;
  }

  if (
    pointSegmentDistance(left.start, right) <= GEOMETRY_EPSILON ||
    pointSegmentDistance(left.end, right) <= GEOMETRY_EPSILON ||
    pointSegmentDistance(right.start, left) <= GEOMETRY_EPSILON ||
    pointSegmentDistance(right.end, left) <= GEOMETRY_EPSILON
  ) {
    return true;
  }

  const first = cross(left.start, left.end, right.start);
  const second = cross(left.start, left.end, right.end);
  const third = cross(right.start, right.end, left.start);
  const fourth = cross(right.start, right.end, left.end);

  return first * second < 0 && third * fourth < 0;
}

function connectedComponentCount(segments: readonly PolylineSegment[]): number {
  if (segments.length === 0) {
    return 0;
  }

  const parent = Array.from({ length: segments.length }, (_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      if (segmentsTouch(segments[left]!, segments[right]!)) {
        union(left, right);
      }
    }
  }

  return new Set(segments.map((_, index) => find(index))).size;
}

function collectConnectivityFailures(
  segments: readonly PolylineSegment[],
  label: string,
  failures: string[],
): void {
  const components = connectedComponentCount(segments);

  if (components !== 1) {
    failures.push(`${label}: ${components} disconnected segment components`);
  }
}

describe('regression: intrinsic glyph stroke graphs', () => {
  it('connects every segment of every reduced consonant centerline glyph, including K', () => {
    const failures: string[] = [];

    for (const letter of CONSONANTS) {
      const geometry = getGlyphGeometry(letter)!;
      if (geometry.strokes.length !== GLYPHS[letter]!.paths.length) {
        failures.push(
          `${letter}: ${geometry.strokes.length} of ${GLYPHS[letter]!.paths.length} intrinsic strokes retained`,
        );
      }
      collectConnectivityFailures(geometry.segments, letter, failures);
    }

    expect(failures).toEqual([]);
  });
});

describe('regression: rendered geometry matches composed geometry', () => {
  it('renders the exact CK seed 2111446587 polylines and keeps verified joins after SVG serialization', () => {
    const composition = composeSigil(processIntention('CK'), { seed: CK_SEED });

    expect(composition.connections).toHaveLength(1);
    const rendered = renderedCompositionGeometry(composition);

    for (const connection of composition.connections) {
      const from = findSegment(rendered.letters[connection.fromSurvivingIndex]!, connection.fromSegment);
      const to = findSegment(rendered.letters[connection.toSurvivingIndex]!, connection.toSegment);
      const measured = measureSegmentOverlap(from, to, GEOMETRY_EPSILON);

      expect(measured.collinear).toBe(true);
      expect(measured.parallel).toBe(true);
      expect(measured.overlaps).toBe(true);
      expect(measured.length).toBeCloseTo(connection.overlapLength, 9);
    }

    for (const letter of composition.letters) {
      expect(letter.path).toBe(GLYPHS[letter.letter]!.paths.join(' '));
    }

    expect(rendered.svg).not.toMatch(/data-(letter|source-index|surviving-index|seed)/);
  });

  it('keeps every rendered stroke on the canvas and visibly connected for every reduced consonant', () => {
    const failures: string[] = [];

    for (const letter of CONSONANTS) {
      for (const seed of [0, CK_SEED]) {
        const composition = composeSigil(processIntention(letter), { seed });
        const rendered = renderedCompositionGeometry(composition);
        const expected = getGlyphGeometry(letter)!;
        const actual = rendered.letters[0]!;

        if (actual.segments.length !== expected.segments.length) {
          failures.push(
            `${letter}/${seed}: rendered ${actual.segments.length} of ${expected.segments.length} segments`,
          );
          continue;
        }

        collectConnectivityFailures(actual.segments, `${letter}/${seed}`, failures);

        for (const segment of actual.segments) {
          for (const point of [segment.start, segment.end]) {
            if (
              point.x < 0 ||
              point.x > composition.width ||
              point.y < 0 ||
              point.y > composition.height
            ) {
              failures.push(`${letter}/${seed}: stroke left the 512 canvas`);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('forms one connected segment-level graph for all 21 consonants across arbitrary seeds', () => {
    const intention = processIntention(CONSONANTS);
    expect(intention.letters).toEqual(CONSONANTS.split(''));
    const failures: string[] = [];

    for (const seed of SEEDS) {
      const composition = composeSigil(intention, { seed });

      expect(composition.letters.map((letter) => letter.letter)).toEqual(intention.letters);
      expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual(
        Array.from({ length: CONSONANTS.length }, (_, index) => index),
      );
      expect(composition.connections).toHaveLength(CONSONANTS.length - 1);
      composition.letters.forEach((letter) => {
        expect(letter.path).toBe(GLYPHS[letter.letter]!.paths.join(' '));
      });

      const rendered = renderedCompositionGeometry(composition);
      const allSegments = rendered.letters.flatMap((letter) => letter.segments);
      collectConnectivityFailures(allSegments, `${CONSONANTS}/${seed}`, failures);

      for (const { letter, segments } of rendered.letters) {
        const expected = getGlyphGeometry(letter.glyphId)!;
        if (segments.length !== expected.segments.length) {
          failures.push(
            `${letter.letter}/${seed}: rendered ${segments.length} of ${expected.segments.length} segments`,
          );
        }

        for (const segment of segments) {
          for (const point of [segment.start, segment.end]) {
            if (
              point.x < 0 ||
              point.x > composition.width ||
              point.y < 0 ||
              point.y > composition.height
            ) {
              failures.push(`${letter.letter}/${seed}: stroke left the 512 canvas`);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
