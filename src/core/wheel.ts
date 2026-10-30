import type { IntentionResult } from './intention';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CURVE_SUBTLE = 0.12;
export const WHEEL1_RADIUS = 100;
export const WHEEL2_RADII = {
  outer: 100,
  middle: 66,
  inner: 38,
} as const;
export const WHEEL2_GROUPS = [
  { ring: 'outer', letters: 'ABCDEFGHIJKLM' },
  { ring: 'middle', letters: 'NOPQRSTU' },
  { ring: 'inner', letters: 'VWXYZ' },
] as const;
export const WHEEL_CANVAS = 260;
export const WHEEL_CENTER = 130;
export const WHEEL_DOT_RADIUS = 3.5;

export type WheelMode = 'multi' | 'single';
export type WheelRing = 'single' | (typeof WHEEL2_GROUPS)[number]['ring'];

export interface WheelCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface WheelPoint extends WheelCoordinate {
  readonly letter: string;
  readonly ring: WheelRing;
  readonly radius: number;
  readonly angle: number;
}

export interface WheelSegment {
  readonly from: string;
  readonly to: string;
  readonly p0: WheelCoordinate;
  readonly control: WheelCoordinate;
  readonly p1: WheelCoordinate;
}

export interface WheelSequenceEntry extends WheelCoordinate {
  readonly letter: string;
  readonly order: number;
  readonly sourceIndex: number;
  readonly ring: WheelRing;
  readonly radius: number;
  readonly angle: number;
}

export interface WheelDot extends WheelCoordinate {
  readonly letter: string;
  readonly order: 1;
  readonly sourceIndex: number;
  readonly radius: number;
}

export interface WheelSigil {
  readonly mode: WheelMode;
  readonly letters: readonly string[];
  readonly points: readonly WheelPoint[];
  readonly sequence: readonly WheelSequenceEntry[];
  readonly segments: readonly WheelSegment[];
  readonly pathD: string | null;
  readonly dot: WheelDot | null;
  readonly isEmpty: boolean;
  readonly cx: number;
  readonly cy: number;
  readonly curvature: number;
  readonly bound: number;
}

export interface WheelSourceLetter {
  readonly letter: string;
  readonly sourceIndex?: number;
}

export interface WheelOptions {
  readonly mode?: WheelMode;
  readonly cx?: number;
  readonly cy?: number;
  readonly curvature?: number;
  readonly bound?: number;
}

type SegmentTuple = readonly [
  WheelCoordinate,
  WheelCoordinate,
  WheelCoordinate,
];

function clockwiseFromTop(
  cx: number,
  cy: number,
  radius: number,
  count: number,
): WheelCoordinate[] {
  const points: WheelCoordinate[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

export function wheel1Points(
  cx = WHEEL_CENTER,
  cy = WHEEL_CENTER,
  radius = WHEEL1_RADIUS,
): Map<string, WheelCoordinate> {
  const points = clockwiseFromTop(cx, cy, radius, ALPHABET.length);
  const map = new Map<string, WheelCoordinate>();
  for (let index = 0; index < ALPHABET.length; index += 1) {
    map.set(ALPHABET[index]!, points[index]!);
  }
  return map;
}

export function wheel2Points(
  cx = WHEEL_CENTER,
  cy = WHEEL_CENTER,
  radii: typeof WHEEL2_RADII = WHEEL2_RADII,
): Map<string, WheelCoordinate> {
  const map = new Map<string, WheelCoordinate>();
  for (const group of WHEEL2_GROUPS) {
    const points = clockwiseFromTop(
      cx,
      cy,
      radii[group.ring],
      group.letters.length,
    );
    for (let index = 0; index < group.letters.length; index += 1) {
      map.set(group.letters[index]!, points[index]!);
    }
  }
  return map;
}

export function maxWheelRadius(): number {
  return WHEEL1_RADIUS;
}

export function segmentControls(
  p0: WheelCoordinate,
  p1: WheelCoordinate,
  cx: number,
  cy: number,
  curvature: number,
  bound = maxWheelRadius(),
): WheelCoordinate {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  const nx = dy;
  const ny = -dx;
  const norm = Math.hypot(nx, ny);
  let control: WheelCoordinate;
  if (norm < 1e-12) {
    control = { x: mx, y: my };
  } else {
    control = {
      x: mx + (curvature * chord * nx) / norm,
      y: my + (curvature * chord * ny) / norm,
    };
  }
  const vx = control.x - cx;
  const vy = control.y - cy;
  const distance = Math.hypot(vx, vy);
  if (distance > bound) {
    control = {
      x: cx + (vx * bound) / distance,
      y: cy + (vy * bound) / distance,
    };
  }
  return control;
}

export function glyphSegments(
  letters: string | readonly string[],
  pointMap: ReadonlyMap<string, WheelCoordinate>,
  cx: number,
  cy: number,
  curvature = CURVE_SUBTLE,
  bound = maxWheelRadius(),
): SegmentTuple[] {
  const ordered = typeof letters === 'string' ? Array.from(letters) : letters;
  const points = ordered.map((letter) => pointMap.get(letter));
  const segments: SegmentTuple[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index]!;
    const p1 = points[index + 1]!;
    const control = segmentControls(p0, p1, cx, cy, curvature, bound);
    segments.push([p0, control, p1]);
  }
  return segments;
}

export function quadPoint(
  p0: WheelCoordinate,
  control: WheelCoordinate,
  p1: WheelCoordinate,
  t: number,
): WheelCoordinate {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * control.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * control.y + t * t * p1.y,
  };
}

export function formatWheelNumber(value: number): string {
  if (Object.is(value, -0)) {
    return '-0.000';
  }
  return value.toFixed(3);
}

export function wheelPathD(
  segments: readonly SegmentTuple[],
  letters: readonly string[] = [],
  pointMap?: ReadonlyMap<string, WheelCoordinate>,
): string | null {
  if (segments.length === 0) {
    if (letters.length === 1 && pointMap) {
      const point = pointMap.get(letters[0]!);
      if (!point) {
        return null;
      }
      return `M ${formatWheelNumber(point.x)} ${formatWheelNumber(point.y)} L ${formatWheelNumber(point.x)} ${formatWheelNumber(point.y)}`;
    }
    return null;
  }
  const parts = [
    `M ${formatWheelNumber(segments[0]![0].x)} ${formatWheelNumber(segments[0]![0].y)}`,
  ];
  for (const [, control, p1] of segments) {
    parts.push(
      `Q ${formatWheelNumber(control.x)} ${formatWheelNumber(control.y)} ${formatWheelNumber(p1.x)} ${formatWheelNumber(p1.y)}`,
    );
  }
  return parts.join(' ');
}

function normalizeSource(
  input: WheelSourceLetter | string | readonly (WheelSourceLetter | string)[],
): WheelSourceLetter[] {
  const entries = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? Array.from(input)
      : [input as WheelSourceLetter];
  return entries.map((entry, index) => {
    const raw = typeof entry === 'string' ? entry : entry.letter;
    const letter = raw.toUpperCase();
    if (!/^[A-Z]$/.test(letter)) {
      throw new Error(`unsupported character ${raw}`);
    }
    return {
      letter,
      sourceIndex:
        typeof entry === 'string' || entry.sourceIndex === undefined
          ? index
          : entry.sourceIndex,
    };
  });
}

function ringForLetter(letter: string): { ring: WheelRing; radius: number; angle: number } {
  const singleIndex = ALPHABET.indexOf(letter);
  const singleAngle = -Math.PI / 2 + (singleIndex * 2 * Math.PI) / ALPHABET.length;
  return { ring: 'single', radius: WHEEL1_RADIUS, angle: singleAngle };
}

function multiPointForLetter(letter: string): {
  ring: WheelRing;
  radius: number;
  angle: number;
} {
  for (const group of WHEEL2_GROUPS) {
    const index = group.letters.indexOf(letter);
    if (index >= 0) {
      return {
        ring: group.ring,
        radius: WHEEL2_RADII[group.ring],
        angle: -Math.PI / 2 + (index * 2 * Math.PI) / group.letters.length,
      };
    }
  }
  throw new Error(`unsupported character ${letter}`);
}

export function buildWheelSigil(
  input: WheelSourceLetter | string | readonly (WheelSourceLetter | string)[],
  options: WheelOptions = {},
): WheelSigil {
  const mode = options.mode ?? 'multi';
  const cx = options.cx ?? WHEEL_CENTER;
  const cy = options.cy ?? WHEEL_CENTER;
  const curvature = options.curvature ?? CURVE_SUBTLE;
  const bound = options.bound ?? maxWheelRadius();
  const letters = normalizeSource(input);
  const pointMap = mode === 'single' ? wheel1Points(cx, cy) : wheel2Points(cx, cy);
  const sequenceLetters = letters.map((entry) => entry.letter);

  const points: WheelPoint[] = Array.from(ALPHABET).map((letter) => {
    const point = pointMap.get(letter)!;
    const meta = mode === 'single' ? ringForLetter(letter) : multiPointForLetter(letter);
    return { ...point, letter, ...meta };
  });

  const sequence: WheelSequenceEntry[] = letters.map((entry, index) => {
    const point = pointMap.get(entry.letter)!;
    const meta = mode === 'single' ? ringForLetter(entry.letter) : multiPointForLetter(entry.letter);
    return {
      ...point,
      letter: entry.letter,
      order: index + 1,
      sourceIndex: entry.sourceIndex!,
      ...meta,
    };
  });

  const tuples = glyphSegments(sequenceLetters, pointMap, cx, cy, curvature, bound);
  const segments: WheelSegment[] = tuples.map(([p0, control, p1], index) => ({
    from: sequenceLetters[index]!,
    to: sequenceLetters[index + 1]!,
    p0,
    control,
    p1,
  }));

  const dot =
    letters.length === 1
      ? {
          ...pointMap.get(letters[0]!.letter)!,
          letter: letters[0]!.letter,
          order: 1 as const,
          sourceIndex: letters[0]!.sourceIndex!,
          radius: WHEEL_DOT_RADIUS,
        }
      : null;

  return {
    mode,
    letters: sequenceLetters,
    points,
    sequence,
    segments,
    pathD: segments.length > 0 ? wheelPathD(tuples) : null,
    dot,
    isEmpty: sequenceLetters.length === 0,
    cx,
    cy,
    curvature,
    bound,
  };
}

export function composeWheelSigil(
  intention: IntentionResult,
  options: WheelOptions = {},
): WheelSigil {
  const letters = intention.characters
    .filter(
      (character) =>
        character.classification === 'kept' && character.normalized !== null,
    )
    .map((character) => ({
      letter: character.normalized!,
      sourceIndex: character.index,
    }));
  return buildWheelSigil(letters, options);
}
