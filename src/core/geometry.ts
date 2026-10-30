export const EPS = 1e-9;
export const EXACT_EPS = 1e-8;

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface SegmentRef {
  readonly strokeIndex: number;
  readonly segmentIndex: number;
}

export class Vec {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  add(other: Vec): Vec {
    return new Vec(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec): Vec {
    return new Vec(this.x - other.x, this.y - other.y);
  }

  mul(k: number): Vec {
    return new Vec(this.x * k, this.y * k);
  }

  div(k: number): Vec {
    return new Vec(this.x / k, this.y / k);
  }

  neg(): Vec {
    return new Vec(-this.x, -this.y);
  }

  dot(other: Vec): number {
    return this.x * other.x + this.y * other.y;
  }

  cross(other: Vec): number {
    return this.x * other.y - this.y * other.x;
  }

  norm(): number {
    return Math.hypot(this.x, this.y);
  }

  unit(): Vec {
    const length = this.norm();
    if (length <= EPS) {
      return new Vec(0, 0);
    }
    return new Vec(this.x / length, this.y / length);
  }

  rotate(angle: number): Vec {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return new Vec(cosine * this.x - sine * this.y, sine * this.x + cosine * this.y);
  }

  asList(): [number, number] {
    return [roundTo(this.x, 9), roundTo(this.y, 9)];
  }
}

export function vec(x: number, y: number): Vec {
  return new Vec(x, y);
}

export class Segment {
  readonly p0: Vec;
  readonly p1: Vec;
  readonly strokeId: string;
  readonly segIndex: number;

  constructor(p0: Vec, p1: Vec, strokeId: string, segIndex: number) {
    this.p0 = p0;
    this.p1 = p1;
    this.strokeId = strokeId;
    this.segIndex = segIndex;
  }

  get direction(): Vec {
    return this.p1.sub(this.p0).unit();
  }

  get length(): number {
    return this.p1.sub(this.p0).norm();
  }

  get midpoint(): Vec {
    return this.p0.add(this.p1).mul(0.5);
  }
}

export class BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  get width(): number {
    return Math.max(0, this.maxX - this.minX);
  }

  get height(): number {
    return Math.max(0, this.maxY - this.minY);
  }

  get center(): Vec {
    return new Vec((this.minX + this.maxX) * 0.5, (this.minY + this.maxY) * 0.5);
  }

  get span(): number {
    return Math.max(this.width, this.height);
  }

  get area(): number {
    return this.width * this.height;
  }

  expanded(distance: number): BBox {
    return new BBox(
      this.minX - distance,
      this.minY - distance,
      this.maxX + distance,
      this.maxY + distance,
    );
  }

  intersects(other: BBox, tolerance = 0): boolean {
    return !(
      this.maxX + tolerance < other.minX ||
      other.maxX + tolerance < this.minX ||
      this.maxY + tolerance < other.minY ||
      other.maxY + tolerance < this.minY
    );
  }

  intersectionArea(other: BBox): number {
    const width = Math.min(this.maxX, other.maxX) - Math.max(this.minX, other.minX);
    const height = Math.min(this.maxY, other.maxY) - Math.max(this.minY, other.minY);
    if (width <= 0 || height <= 0) {
      return 0;
    }
    return width * height;
  }

  asDict(): Record<string, number> {
    return {
      min_x: roundTo(this.minX, 9),
      min_y: roundTo(this.minY, 9),
      max_x: roundTo(this.maxX, 9),
      max_y: roundTo(this.maxY, 9),
      width: roundTo(this.width, 9),
      height: roundTo(this.height, 9),
    };
  }

  static fromPoints(points: Iterable<Vec>): BBox {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let seen = false;

    for (const point of points) {
      seen = true;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    if (!seen) {
      return new BBox(0, 0, 0, 0);
    }
    return new BBox(minX, minY, maxX, maxY);
  }
}

export class Stroke {
  readonly strokeId: string;
  readonly points: readonly Vec[];
  readonly closed: boolean;
  readonly owner: number | null;
  readonly localIndex: number | null;

  constructor(
    strokeId: string,
    points: readonly Vec[],
    closed = false,
    owner: number | null = null,
    localIndex: number | null = null,
  ) {
    this.strokeId = strokeId;
    this.points = points;
    this.closed = closed;
    this.owner = owner;
    this.localIndex = localIndex;
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
          this.strokeId,
          index,
        ),
      );
    }
    return out;
  }

  bounds(): BBox {
    return BBox.fromPoints(this.points);
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

  transformed(transform: Transform, owner: number, suffix = ''): Stroke {
    const points = this.points.map((point) => transform.apply(point));
    const strokeId = `${owner}:${this.localIndex}${suffix}`;
    return new Stroke(strokeId, points, this.closed, owner, this.localIndex);
  }
}

export class Transform {
  readonly angle: number;
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;

  constructor(angle: number, scale: number, tx: number, ty: number) {
    this.angle = angle;
    this.scale = scale;
    this.tx = tx;
    this.ty = ty;
  }

  apply(point: Vec): Vec {
    const rotated = point.rotate(this.angle).mul(this.scale);
    return new Vec(rotated.x + this.tx, rotated.y + this.ty);
  }

  svgMatrix(): string {
    const cosine = Math.cos(this.angle) * this.scale;
    const sine = Math.sin(this.angle) * this.scale;
    const fixed = (value: number): string => {
      const text = value.toFixed(9);
      return value < 0 || Object.is(value, -0) ? `-${text.replace(/^-/, '')}` : text;
    };
    return `matrix(${fixed(cosine)} ${fixed(sine)} ${fixed(-sine)} ${fixed(cosine)} ${fixed(this.tx)} ${fixed(this.ty)})`;
  }

  asDict(): Record<string, number> {
    return {
      angle_deg: roundTo((this.angle * 180) / Math.PI, 9),
      scale: roundTo(this.scale, 9),
      tx: roundTo(this.tx, 9),
      ty: roundTo(this.ty, 9),
    };
  }
}

export function angleOf(value: Vec): number {
  return Math.atan2(value.y, value.x);
}

export function pointSegmentDistance(
  point: Vec,
  start: Vec,
  end: Vec,
): [number, number, Vec] {
  const ab = end.sub(start);
  const denominator = ab.dot(ab);
  if (denominator <= EPS) {
    return [point.sub(start).norm(), 0, start];
  }
  const t = Math.max(0, Math.min(1, point.sub(start).dot(ab) / denominator));
  const nearest = start.add(ab.mul(t));
  return [point.sub(nearest).norm(), t, nearest];
}

export function segmentIntersection(
  first: Segment,
  second: Segment,
): [Vec, number, number, number] | null {
  const p = first.p0;
  const r = first.p1.sub(first.p0);
  const q = second.p0;
  const s = second.p1.sub(second.p0);
  const denominator = r.cross(s);
  if (Math.abs(denominator) <= EPS) {
    return null;
  }
  const qp = q.sub(p);
  const t = qp.cross(s) / denominator;
  const u = qp.cross(r) / denominator;
  if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) {
    const point = p.add(r.mul(t));
    const angle = Math.abs(Math.atan2(Math.abs(r.cross(s)), r.dot(s)));
    return [point, Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u)), angle];
  }
  return null;
}

export function collinearOverlap(
  first: Segment,
  second: Segment,
  _distanceTolerance: number,
  minLength: number,
): [Vec, Vec, number] | null {
  const firstVector = first.p1.sub(first.p0);
  const secondVector = second.p1.sub(second.p0);
  const firstLength = firstVector.norm();
  const secondLength = secondVector.norm();
  if (firstLength <= EPS || secondLength <= EPS) {
    return null;
  }
  const direction = firstVector.div(firstLength);
  const secondDirection = secondVector.div(secondLength);
  if (Math.abs(direction.cross(secondDirection)) > EXACT_EPS) {
    return null;
  }
  const coordinateScale = Math.max(
    1,
    firstLength,
    secondLength,
    Math.abs(first.p0.x),
    Math.abs(first.p0.y),
    Math.abs(first.p1.x),
    Math.abs(first.p1.y),
    Math.abs(second.p0.x),
    Math.abs(second.p0.y),
    Math.abs(second.p1.x),
    Math.abs(second.p1.y),
  );
  const distanceEpsilon = EXACT_EPS * coordinateScale;
  for (const point of [second.p0, second.p1]) {
    const lineDistance = Math.abs(point.sub(first.p0).cross(direction));
    if (lineDistance > distanceEpsilon) {
      return null;
    }
  }
  const t0 = second.p0.sub(first.p0).dot(direction);
  const t1 = second.p1.sub(first.p0).dot(direction);
  const low = Math.max(0, Math.min(t0, t1));
  const high = Math.min(firstLength, Math.max(t0, t1));
  const overlap = high - low;
  if (overlap <= distanceEpsilon || overlap < minLength - distanceEpsilon) {
    return null;
  }
  return [first.p0.add(direction.mul(low)), first.p0.add(direction.mul(high)), overlap];
}

export function tolerantCollinearOverlap(
  first: Segment,
  second: Segment,
  distanceTolerance: number,
  minLength: number,
): [Vec, Vec, number] | null {
  const firstDirection = first.direction;
  const secondDirection = second.direction;
  if (Math.abs(firstDirection.cross(secondDirection)) > 0.08715574274765817) {
    return null;
  }
  const firstLength = first.length;
  const secondLength = second.length;
  if (firstLength <= EPS || secondLength <= EPS) {
    return null;
  }
  const direction = first.p1.sub(first.p0).div(firstLength);
  for (const point of [second.p0, second.p1]) {
    const lineDistance = Math.abs(point.sub(first.p0).cross(direction));
    if (lineDistance > distanceTolerance) {
      return null;
    }
  }
  const t0 = second.p0.sub(first.p0).dot(direction);
  const t1 = second.p1.sub(first.p0).dot(direction);
  const low = Math.max(0, Math.min(t0, t1));
  const high = Math.min(firstLength, Math.max(t0, t1));
  const overlap = high - low;
  if (overlap < minLength) {
    return null;
  }
  return [first.p0.add(direction.mul(low)), first.p0.add(direction.mul(high)), overlap];
}

export function strokeBounds(strokes: Iterable<Stroke>): BBox {
  const points: Vec[] = [];
  for (const stroke of strokes) {
    points.push(...stroke.points);
  }
  return BBox.fromPoints(points);
}

export function allSegments(strokes: Iterable<Stroke>): Segment[] {
  const out: Segment[] = [];
  for (const stroke of strokes) {
    out.push(...stroke.segments());
  }
  return out;
}

export function sampleStrokes(strokes: Iterable<Stroke>, perSegment = 2): Vec[] {
  const points: Vec[] = [];
  for (const stroke of strokes) {
    for (const segment of stroke.segments()) {
      for (let step = 0; step <= perSegment; step += 1) {
        const t = step / perSegment;
        points.push(segment.p0.add(segment.p1.sub(segment.p0).mul(t)));
      }
    }
  }
  if (points.length === 0) {
    for (const stroke of strokes) {
      points.push(...stroke.points);
    }
  }
  return points;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15]!;
      const second = words[index - 2]!;
      const s0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const s1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, hash[index]!);
  }
  return digest;
}

const TEXT_ENCODER = new TextEncoder();

function stableRaw(parts: readonly (string | number | bigint)[]): Uint8Array {
  return sha256Bytes(TEXT_ENCODER.encode(parts.map((part) => String(part)).join('|')));
}

export function stableUnit(...parts: (string | number | bigint)[]): number {
  const digest = stableRaw(parts);
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(digest[index]!);
  }
  return Number(value) / 18446744073709551615;
}

export function stableSeed(...parts: (string | number | bigint)[]): bigint {
  const digest = stableRaw(parts);
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(digest[index]!);
  }
  return value;
}

export function pyFloat(value: number): string {
  if (Number.isNaN(value)) {
    return 'nan';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 'inf';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-inf';
  }
  if (Object.is(value, -0)) {
    return '-0.0';
  }
  let text = String(value);
  if (/^-?\d+$/.test(text)) {
    text += '.0';
  }
  return text.replace(/e([+-]?)(\d+)$/, (_match, sign: string, digits: string) => {
    return `e${sign}${digits.padStart(2, '0')}`;
  });
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Object.is(value, -0)) {
    return '0';
  }
  const rounded = roundTo(value, 9);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
