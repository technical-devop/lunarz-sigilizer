import { GLYPH_BOX_SIZE, getGlyph, type GlyphDefinition, type GlyphLetter } from './glyphs';

export const QUADRATIC_SEGMENTS_PER_CURVE = 8;

export const GEOMETRY_EPSILON = 1e-9;

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface SegmentRef {
  readonly strokeIndex: number;
  readonly segmentIndex: number;
}

export interface PolylineSegment extends SegmentRef {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly midpoint: Point2D;
  readonly length: number;
  readonly tangent: Point2D;
}

export interface GlyphStroke {
  readonly index: number;
  readonly points: readonly Point2D[];
  readonly closed: boolean;
  readonly segments: readonly PolylineSegment[];
}

export interface GlyphGeometry {
  readonly letter: GlyphLetter;
  readonly strokes: readonly GlyphStroke[];
  readonly segments: readonly PolylineSegment[];
}

export interface GlyphTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
}

export interface SegmentOverlap {
  readonly collinear: boolean;
  readonly parallel: boolean;
  readonly overlaps: boolean;
  readonly interval: readonly [number, number];
  readonly length: number;
  readonly perpendicularError: number;
  readonly angularError: number;
}

interface MutableStroke {
  readonly index: number;
  readonly points: Point2D[];
  closed: boolean;
}

type Token =
  | { readonly kind: 'command'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number };

const TOKEN_PATTERN = /([MLQHVZ])|(-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
const NUMBER_PATTERN = /^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/;

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];

  for (const match of path.matchAll(TOKEN_PATTERN)) {
    const command = match[1];
    if (command !== undefined) {
      tokens.push({ kind: 'command', value: command });
    } else {
      const number = match[2];
      if (number !== undefined && NUMBER_PATTERN.test(number)) {
        tokens.push({ kind: 'number', value: Number(number) });
      }
    }
  }

  return tokens;
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function buildStrokeSegments(
  points: readonly Point2D[],
  strokeIndex: number,
): PolylineSegment[] {
  const segments: PolylineSegment[] = [];

  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const length = distance(start, end);

    if (length <= GEOMETRY_EPSILON) {
      continue;
    }

    segments.push({
      strokeIndex,
      segmentIndex: segments.length,
      start,
      end,
      midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      length,
      tangent: { x: (end.x - start.x) / length, y: (end.y - start.y) / length },
    });
  }

  return segments;
}

function makeStroke(index: number, points: readonly Point2D[], closed: boolean): GlyphStroke {
  return {
    index,
    points,
    closed,
    segments: buildStrokeSegments(points, index),
  };
}

function addDistinctPoint(points: Point2D[], point: Point2D): void {
  const previous = points[points.length - 1];
  if (!previous || distance(previous, point) > GEOMETRY_EPSILON) {
    points.push(point);
  }
}

function parseQuadratic(
  points: Point2D[],
  from: Point2D,
  control: Point2D,
  to: Point2D,
): void {
  for (let step = 1; step <= QUADRATIC_SEGMENTS_PER_CURVE; step += 1) {
    const t = step / QUADRATIC_SEGMENTS_PER_CURVE;
    const inverse = 1 - t;
    const point = {
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
    };
    addDistinctPoint(points, point);
  }
}

function parsePath(path: string): GlyphStroke[] {
  const tokens = tokenize(path);
  const strokes: MutableStroke[] = [];
  let currentStroke: MutableStroke | null = null;
  let current: Point2D | null = null;
  let subpathStart: Point2D | null = null;
  let command: string | null = null;
  let cursor = 0;

  const nextNumber = (): number | undefined => {
    const token = tokens[cursor];
    if (token?.kind !== 'number') {
      return undefined;
    }
    cursor += 1;
    return token.value;
  };

  const resolve = (x: number, y: number): Point2D => {
    if (command !== null && command === command.toLowerCase() && current) {
      return { x: current.x + x, y: current.y + y };
    }
    return { x, y };
  };

  while (cursor < tokens.length) {
    const token = tokens[cursor];

    if (token?.kind === 'command') {
      command = token.value;
      cursor += 1;

      if (command.toUpperCase() === 'Z') {
        if (currentStroke && current && subpathStart) {
          addDistinctPoint(currentStroke.points, subpathStart);
          currentStroke.closed = true;
          current = subpathStart;
        }
        continue;
      }
    } else if (command === null) {
      cursor += 1;
      continue;
    }

    const upper = command?.toUpperCase();

    if (upper === 'M') {
      const x = nextNumber();
      const y = nextNumber();
      if (x === undefined || y === undefined) {
        break;
      }
      const point = resolve(x, y);
      currentStroke = { index: strokes.length, points: [point], closed: false };
      strokes.push(currentStroke);
      current = point;
      subpathStart = point;

      while (tokens[cursor]?.kind === 'number') {
        const lineX = nextNumber();
        const lineY = nextNumber();
        if (lineX === undefined || lineY === undefined) {
          break;
        }
        const point = resolve(lineX, lineY);
        addDistinctPoint(currentStroke!.points, point);
        current = point;
      }
      continue;
    }

    if (!currentStroke || !current) {
      cursor += 1;
      continue;
    }

    if (upper === 'L') {
      const x = nextNumber();
      const y = nextNumber();
      if (x === undefined || y === undefined) {
        break;
      }
      const point = resolve(x, y);
      addDistinctPoint(currentStroke.points, point);
      current = point;
      continue;
    }

    if (upper === 'H') {
      const x = nextNumber();
      if (x === undefined) {
        break;
      }
      const relative = command !== null && command === command.toLowerCase();
      const point = relative ? { x: current.x + x, y: current.y } : { x, y: current.y };
      addDistinctPoint(currentStroke.points, point);
      current = point;
      continue;
    }

    if (upper === 'V') {
      const y = nextNumber();
      if (y === undefined) {
        break;
      }
      const relative = command !== null && command === command.toLowerCase();
      const point = relative ? { x: current.x, y: current.y + y } : { x: current.x, y };
      addDistinctPoint(currentStroke.points, point);
      current = point;
      continue;
    }

    if (upper === 'Q') {
      const controlX = nextNumber();
      const controlY = nextNumber();
      const endX = nextNumber();
      const endY = nextNumber();
      if (
        controlX === undefined ||
        controlY === undefined ||
        endX === undefined ||
        endY === undefined
      ) {
        break;
      }
      const relative = command !== null && command === command.toLowerCase();
      const control = relative
        ? { x: current.x + controlX, y: current.y + controlY }
        : { x: controlX, y: controlY };
      const end = relative
        ? { x: current.x + endX, y: current.y + endY }
        : { x: endX, y: endY };
      parseQuadratic(currentStroke.points, current, control, end);
      current = end;
      continue;
    }

    cursor += 1;
  }

  return strokes.map((stroke) => makeStroke(stroke.index, stroke.points, stroke.closed));
}

function buildGeometry(glyph: GlyphDefinition): GlyphGeometry {
  const strokes = glyph.paths
    .flatMap((path) => parsePath(path))
    .map((stroke, index) => makeStroke(index, stroke.points, stroke.closed));

  return {
    letter: glyph.letter,
    strokes,
    segments: strokes.flatMap((stroke) => stroke.segments),
  };
}

export function formatCoordinate(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

export function geometryToPath(geometry: GlyphGeometry): string {
  return geometry.strokes
    .map((stroke) => {
      const [first, ...rest] = stroke.points;
      if (!first) {
        return '';
      }

      const parts = [`M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`];
      for (const point of rest) {
        parts.push(`L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`);
      }

      return parts.join(' ');
    })
    .filter((path) => path.length > 0)
    .join(' ');
}

const GEOMETRY_CACHE = new Map<GlyphLetter, GlyphGeometry>();

export function getGlyphGeometry(letter: string): GlyphGeometry | undefined {
  const glyph = getGlyph(letter);
  if (!glyph) {
    return undefined;
  }

  const cached = GEOMETRY_CACHE.get(glyph.letter);
  if (cached) {
    return cached;
  }

  const geometry = buildGeometry(glyph);
  GEOMETRY_CACHE.set(glyph.letter, geometry);
  return geometry;
}

export function transformPoint(transform: GlyphTransform, point: Point2D): Point2D {
  const half = GLYPH_BOX_SIZE / 2;
  const radians = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scaleX = transform.mirror ? -transform.scale : transform.scale;
  const scaleY = transform.scale;
  const localX = (point.x - half) * scaleX;
  const localY = (point.y - half) * scaleY;

  return {
    x: transform.x + cosine * localX - sine * localY,
    y: transform.y + sine * localX + cosine * localY,
  };
}

export function transformGlyphGeometry(
  geometry: GlyphGeometry,
  transform: GlyphTransform,
): GlyphGeometry {
  const strokes = geometry.strokes.map((stroke) => {
    const points = stroke.points.map((point) => transformPoint(transform, point));
    return makeStroke(stroke.index, points, stroke.closed);
  });

  return {
    letter: geometry.letter,
    strokes,
    segments: strokes.flatMap((stroke) => stroke.segments),
  };
}

export function measureSegmentOverlap(
  from: Pick<PolylineSegment, 'start' | 'end'>,
  to: Pick<PolylineSegment, 'start' | 'end'>,
  epsilon: number = GEOMETRY_EPSILON,
): SegmentOverlap {
  const referenceX = to.end.x - to.start.x;
  const referenceY = to.end.y - to.start.y;
  const referenceLength = Math.hypot(referenceX, referenceY);

  if (referenceLength <= epsilon) {
    return {
      collinear: false,
      parallel: false,
      overlaps: false,
      interval: [0, 0],
      length: 0,
      perpendicularError: Number.POSITIVE_INFINITY,
      angularError: Number.POSITIVE_INFINITY,
    };
  }

  const ux = referenceX / referenceLength;
  const uy = referenceY / referenceLength;
  const perpendicular = (point: Point2D): number =>
    Math.abs((point.x - to.start.x) * -uy + (point.y - to.start.y) * ux);
  const perpendicularError = Math.max(perpendicular(from.start), perpendicular(from.end));

  const fromX = from.end.x - from.start.x;
  const fromY = from.end.y - from.start.y;
  const fromLength = Math.hypot(fromX, fromY);
  const angularError =
    fromLength <= epsilon
      ? Number.POSITIVE_INFINITY
      : Math.abs((fromX / fromLength) * uy - (fromY / fromLength) * ux);

  const project = (point: Point2D): number =>
    (point.x - to.start.x) * ux + (point.y - to.start.y) * uy;
  const first = project(from.start);
  const second = project(from.end);
  const intervalStart = Math.max(0, Math.min(first, second));
  const intervalEnd = Math.min(referenceLength, Math.max(first, second));
  const length = Math.max(0, intervalEnd - intervalStart);
  const collinear = perpendicularError <= epsilon;
  const parallel = angularError <= epsilon;
  const overlaps = collinear && parallel && length > epsilon;

  return {
    collinear,
    parallel,
    overlaps,
    interval: [intervalStart, intervalEnd],
    length,
    perpendicularError,
    angularError,
  };
}
