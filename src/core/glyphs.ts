import {
  BBox,
  Segment,
  Stroke,
  Transform,
  Vec,
  angleOf,
  roundTo,
} from './geometry';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' as const;

export type GlyphLetter = (typeof ALPHABET)[number];

export const GLYPH_BOX_SIZE = 1;

export class GlyphStroke {
  readonly points: readonly Vec[];
  readonly closed: boolean;

  constructor(points: readonly Vec[], closed = false) {
    this.points = points;
    this.closed = closed;
  }

  segments(): Segment[] {
    if (this.points.length < 2) {
      return [];
    }
    const out: Segment[] = [];
    const count = this.points.length;
    const last = this.closed ? count : count - 1;
    for (let index = 0; index < last; index += 1) {
      out.push(
        new Segment(
          this.points[index]!,
          this.points[(index + 1) % count]!,
          'local',
          index,
        ),
      );
    }
    return out;
  }

  pathD(): string {
    if (this.points.length === 0) {
      return '';
    }
    const parts = [
      `M ${this.points[0]!.x.toFixed(6)} ${this.points[0]!.y.toFixed(6)}`,
    ];
    for (const point of this.points.slice(1)) {
      parts.push(`L ${point.x.toFixed(6)} ${point.y.toFixed(6)}`);
    }
    if (this.closed) {
      parts.push('Z');
    }
    return parts.join(' ');
  }
}

export class Anchor {
  readonly anchorId: string;
  readonly strokeIndex: number;
  readonly kind: string;
  readonly pos: Vec;
  readonly tangent: Vec;
  readonly normal: Vec;
  readonly pointIndex: number | null;
  readonly segmentIndex: number | null;
  readonly t: number;

  constructor(
    anchorId: string,
    strokeIndex: number,
    kind: string,
    pos: Vec,
    tangent: Vec,
    normal: Vec,
    pointIndex: number | null = null,
    segmentIndex: number | null = null,
    t = 0,
  ) {
    this.anchorId = anchorId;
    this.strokeIndex = strokeIndex;
    this.kind = kind;
    this.pos = pos;
    this.tangent = tangent;
    this.normal = normal;
    this.pointIndex = pointIndex;
    this.segmentIndex = segmentIndex;
    this.t = t;
  }

  get anchor_id(): string {
    return this.anchorId;
  }

  asDict(): Record<string, unknown> {
    return {
      id: this.anchorId,
      stroke_index: this.strokeIndex,
      kind: this.kind,
      pos: this.pos.asList(),
      tangent: this.tangent.asList(),
      normal: this.normal.asList(),
      point_index: this.pointIndex,
      segment_index: this.segmentIndex,
      t: roundTo(this.t, 6),
    };
  }
}

export class Glyph {
  readonly char: string;
  readonly strokes: readonly GlyphStroke[];
  readonly anchors: readonly Anchor[];

  constructor(char: string, strokes: readonly GlyphStroke[], anchors: readonly Anchor[]) {
    this.char = char;
    this.strokes = strokes;
    this.anchors = anchors;
  }

  get letter(): GlyphLetter {
    return this.char as GlyphLetter;
  }

  get width(): number {
    return GLYPH_BOX_SIZE;
  }

  get height(): number {
    return GLYPH_BOX_SIZE;
  }

  get paths(): string[] {
    return this.strokes.map((stroke) => stroke.pathD());
  }

  get bounds(): BBox {
    const points: Vec[] = [];
    for (const stroke of this.strokes) {
      points.push(...stroke.points);
    }
    return BBox.fromPoints(points);
  }

  worldStrokes(owner: number, transform: Transform): Stroke[] {
    const out: Stroke[] = [];
    for (let index = 0; index < this.strokes.length; index += 1) {
      const glyphStroke = this.strokes[index]!;
      const base = new Stroke(
        `${owner}:${index}`,
        glyphStroke.points,
        glyphStroke.closed,
        owner,
        index,
      );
      out.push(base.transformed(transform, owner));
    }
    return out;
  }
}

function point(x: number, y: number): Vec {
  return new Vec(Number(x), Number(y));
}

function ellipse(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  count: number,
): Vec[] {
  const points: Vec[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2;
    points.push(point(centerX + radiusX * Math.cos(angle), centerY + radiusY * Math.sin(angle)));
  }
  return points;
}

type RawStroke = readonly [readonly (readonly [number, number])[], boolean];

const RAW: Record<string, readonly RawStroke[]> = {
  A: [
    [[[0.5, 0.0], [0.1, 1.0]], false],
    [[[0.5, 0.0], [0.9, 1.0]], false],
    [[[0.252, 0.62], [0.748, 0.62]], false],
  ],
  B: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [
      [
        [0.18, 0.0],
        [0.64, 0.0],
        [0.8, 0.14],
        [0.8, 0.31],
        [0.64, 0.45],
        [0.18, 0.45],
      ],
      false,
    ],
    [
      [
        [0.18, 0.45],
        [0.66, 0.45],
        [0.84, 0.6],
        [0.84, 0.84],
        [0.66, 1.0],
        [0.18, 1.0],
      ],
      false,
    ],
  ],
  C: [
    [
      [
        [0.84, 0.14],
        [0.68, 0.0],
        [0.36, 0.0],
        [0.16, 0.2],
        [0.16, 0.8],
        [0.36, 1.0],
        [0.68, 1.0],
        [0.84, 0.86],
      ],
      false,
    ],
  ],
  D: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [
      [
        [0.18, 0.0],
        [0.55, 0.0],
        [0.84, 0.24],
        [0.84, 0.76],
        [0.55, 1.0],
        [0.18, 1.0],
      ],
      false,
    ],
  ],
  E: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [[[0.18, 0.0], [0.82, 0.0]], false],
    [[[0.18, 0.5], [0.68, 0.5]], false],
    [[[0.18, 1.0], [0.82, 1.0]], false],
  ],
  F: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [[[0.18, 0.0], [0.82, 0.0]], false],
    [[[0.18, 0.5], [0.68, 0.5]], false],
  ],
  G: [
    [
      [
        [0.84, 0.14],
        [0.68, 0.0],
        [0.36, 0.0],
        [0.16, 0.2],
        [0.16, 0.8],
        [0.36, 1.0],
        [0.68, 1.0],
        [0.84, 0.84],
        [0.84, 0.55],
        [0.58, 0.55],
      ],
      false,
    ],
  ],
  H: [
    [[[0.16, 0.0], [0.16, 1.0]], false],
    [[[0.84, 0.0], [0.84, 1.0]], false],
    [[[0.16, 0.5], [0.84, 0.5]], false],
  ],
  I: [
    [[[0.5, 0.0], [0.5, 1.0]], false],
    [[[0.3, 0.0], [0.7, 0.0]], false],
    [[[0.3, 1.0], [0.7, 1.0]], false],
  ],
  J: [
    [[[0.32, 0.0], [0.76, 0.0]], false],
    [[[0.64, 0.0], [0.64, 0.74], [0.52, 0.96], [0.3, 1.0], [0.16, 0.88]], false],
  ],
  K: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [[[0.18, 0.48], [0.82, 0.0]], false],
    [[[0.18, 0.48], [0.84, 1.0]], false],
  ],
  L: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [[[0.18, 1.0], [0.82, 1.0]], false],
  ],
  M: [
    [[[0.12, 1.0], [0.12, 0.0], [0.5, 0.62], [0.88, 0.0], [0.88, 1.0]], false],
  ],
  N: [
    [[[0.16, 1.0], [0.16, 0.0], [0.84, 1.0], [0.84, 0.0]], false],
  ],
  O: [
    [ellipse(0.5, 0.5, 0.34, 0.5, 20).map((value) => [value.x, value.y] as const), true],
  ],
  P: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [
      [
        [0.18, 0.0],
        [0.62, 0.0],
        [0.82, 0.16],
        [0.82, 0.38],
        [0.62, 0.52],
        [0.18, 0.52],
      ],
      false,
    ],
  ],
  Q: [
    [ellipse(0.5, 0.5, 0.34, 0.5, 20).map((value) => [value.x, value.y] as const), true],
    [[[0.7753, 0.7939], [0.95, 1.04]], false],
  ],
  R: [
    [[[0.18, 0.0], [0.18, 1.0]], false],
    [
      [
        [0.18, 0.0],
        [0.62, 0.0],
        [0.82, 0.16],
        [0.82, 0.38],
        [0.62, 0.52],
        [0.18, 0.52],
      ],
      false,
    ],
    [[[0.55, 0.52], [0.88, 1.0]], false],
  ],
  S: [
    [
      [
        [0.84, 0.14],
        [0.66, 0.0],
        [0.36, 0.0],
        [0.16, 0.16],
        [0.16, 0.34],
        [0.34, 0.47],
        [0.64, 0.5],
        [0.84, 0.64],
        [0.84, 0.84],
        [0.66, 1.0],
        [0.36, 1.0],
        [0.16, 0.86],
      ],
      false,
    ],
  ],
  T: [
    [[[0.12, 0.0], [0.88, 0.0]], false],
    [[[0.5, 0.0], [0.5, 1.0]], false],
  ],
  U: [
    [
      [
        [0.16, 0.0],
        [0.16, 0.7],
        [0.3, 0.94],
        [0.5, 1.0],
        [0.7, 0.94],
        [0.84, 0.7],
        [0.84, 0.0],
      ],
      false,
    ],
  ],
  V: [
    [[[0.12, 0.0], [0.5, 1.0], [0.88, 0.0]], false],
  ],
  W: [
    [[[0.06, 0.0], [0.28, 1.0], [0.5, 0.38], [0.72, 1.0], [0.94, 0.0]], false],
  ],
  X: [
    [[[0.14, 0.0], [0.86, 1.0]], false],
    [[[0.86, 0.0], [0.14, 1.0]], false],
  ],
  Y: [
    [[[0.14, 0.0], [0.5, 0.52]], false],
    [[[0.86, 0.0], [0.5, 0.52]], false],
    [[[0.5, 0.52], [0.5, 1.0]], false],
  ],
  Z: [
    [[[0.14, 0.0], [0.86, 0.0], [0.14, 1.0], [0.86, 1.0]], false],
  ],
};

function rawToStrokes(char: string): GlyphStroke[] {
  const raw = RAW[char];
  if (!raw) {
    throw new Error(`no stroke skeleton for ${char}`);
  }
  const strokes = raw.map(([points, closed]) => {
    return new GlyphStroke(points.map(([x, y]) => point(x, y)), closed);
  });
  if (char === 'Q' && strokes.length >= 2) {
    const ring = strokes[0]!;
    const tail = strokes[1]!;
    const start = tail.points[0]!;
    let nearest = ring.points[0]!;
    let nearestDistance = start.sub(nearest).norm();
    for (const candidate of ring.points) {
      const distance = start.sub(candidate).norm();
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return [
      ring,
      new GlyphStroke([nearest, ...tail.points.slice(1)], tail.closed),
    ];
  }
  return strokes;
}

function makeAnchors(char: string, strokes: readonly GlyphStroke[]): Anchor[] {
  const anchors: Anchor[] = [];
  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
    const stroke = strokes[strokeIndex]!;
    const points = stroke.points;
    const count = points.length;
    if (count < 2) {
      continue;
    }
    const segments = stroke.segments();
    if (!stroke.closed) {
      const tangent0 = points[1]!.sub(points[0]!).unit();
      anchors.push(
        new Anchor(
          `${char}:${strokeIndex}:e0`,
          strokeIndex,
          'endpoint',
          points[0]!,
          tangent0,
          new Vec(-tangent0.y, tangent0.x),
          0,
          0,
          0,
        ),
      );
      const tangent1 = points[count - 2]!.sub(points[count - 1]!).unit();
      anchors.push(
        new Anchor(
          `${char}:${strokeIndex}:e1`,
          strokeIndex,
          'endpoint',
          points[count - 1]!,
          tangent1,
          new Vec(-tangent1.y, tangent1.x),
          count - 1,
          segments.length - 1,
          1,
        ),
      );
    }

    const corners: { turn: number; index: number; outgoing: Vec }[] = [];
    for (let index = 1; index < count - 1; index += 1) {
      const incoming = points[index]!.sub(points[index - 1]!).unit();
      const outgoing = points[index + 1]!.sub(points[index]!).unit();
      const turn = Math.abs(
        Math.atan2(incoming.cross(outgoing), incoming.dot(outgoing)),
      );
      if (turn >= 0.4363323129985824) {
        corners.push({ turn, index, outgoing });
      }
    }
    corners.sort((left, right) => right.turn - left.turn || left.index - right.index);
    for (const corner of corners.slice(0, 7)) {
      anchors.push(
        new Anchor(
          `${char}:${strokeIndex}:c${corner.index}`,
          strokeIndex,
          'corner',
          points[corner.index]!,
          corner.outgoing,
          new Vec(-corner.outgoing.y, corner.outgoing.x),
          corner.index,
          null,
          0,
        ),
      );
    }

    if (segments.length > 0) {
      const chosen =
        segments.length <= 5
          ? Array.from({ length: segments.length }, (_, index) => index)
          : [...new Set([
              0,
              Math.floor(segments.length / 3),
              Math.floor((2 * segments.length) / 3),
              segments.length - 1,
            ])].sort((left, right) => left - right);
      for (const segmentIndex of chosen) {
        const segment = segments[segmentIndex]!;
        const tangent = segment.direction;
        anchors.push(
          new Anchor(
            `${char}:${strokeIndex}:s${segmentIndex}`,
            strokeIndex,
            'segment',
            segment.midpoint,
            tangent,
            new Vec(-tangent.y, tangent.x),
            null,
            segmentIndex,
            0.5,
          ),
        );
      }
    }
  }
  anchors.sort((left, right) =>
    left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0,
  );
  return anchors;
}

const GLYPH_CACHE = new Map<string, Glyph>();

for (const char of ALPHABET) {
  const strokes = rawToStrokes(char);
  GLYPH_CACHE.set(char, new Glyph(char, strokes, makeAnchors(char, strokes)));
}

export const GLYPHS: Readonly<Record<GlyphLetter, Glyph>> = Object.freeze(
  Object.fromEntries([...ALPHABET].map((letter) => [letter, GLYPH_CACHE.get(letter)!])) as Record<
    GlyphLetter,
    Glyph
  >,
);

const UPPERCASE_LETTER = /^[A-Z]$/;

export function getGlyph(letter: string): Glyph | undefined {
  const normalized = letter.toUpperCase();
  if (!UPPERCASE_LETTER.test(normalized)) {
    return undefined;
  }
  return GLYPH_CACHE.get(normalized);
}

export function glyphPath(letter: string): string | undefined {
  return getGlyph(letter)?.paths.join(' ');
}

export function supportedChars(): string {
  return [...GLYPH_CACHE.keys()].sort().join('');
}

export type GlyphDefinition = Glyph;

export function angleOfVec(value: Vec): number {
  return angleOf(value);
}
