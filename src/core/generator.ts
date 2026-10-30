import {
  BBox,
  Segment,
  Stroke,
  Transform,
  Vec,
  allSegments,
  angleOf,
  collinearOverlap,
  pointSegmentDistance,
  pyFloat,
  roundTo,
  sampleStrokes,
  segmentIntersection,
  stableSeed,
  stableUnit,
  tolerantCollinearOverlap,
} from './geometry';
import { Anchor, Glyph, getGlyph } from './glyphs';

export const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export function reduceIntention(text: string): string {
  const normalized = text
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const char of normalized) {
    if (char >= 'A' && char <= 'Z') {
      if (VOWELS.has(char) || seen.has(char)) {
        continue;
      }
      seen.add(char);
      out.push(char);
    }
  }
  return out.join('');
}

export class Intention {
  readonly id: string;
  readonly source: string;
  readonly label: string;
  readonly lengthClass: string;
  readonly brief: string;
  readonly intention: string;

  constructor(
    id: string,
    source: string,
    label: string,
    lengthClass: string,
    brief: string,
    intention = '',
  ) {
    this.id = id;
    this.source = source;
    this.label = label;
    this.lengthClass = lengthClass;
    this.brief = brief;
    this.intention = intention;
  }
}

function makeIntention(
  id: string,
  phrase: string,
  lengthClass: string,
  brief: string,
): Intention {
  const reduced = reduceIntention(phrase);
  if (!reduced) {
    throw new Error(`intention ${id} reduces to empty`);
  }
  return new Intention(id, reduced, phrase, lengthClass, brief, phrase);
}

export const INTENTIONS: readonly Intention[] = [
  makeIntention('calm', 'BE CALM', 'short', 'stillness under pressure'),
  makeIntention('make', 'I MAKE TIME TO CREATE', 'medium', 'carving out creative time'),
  makeIntention('protect', 'I PROTECT MY SPACE', 'long', 'boundary and shelter'),
  makeIntention('build', 'I BUILD RESILIENT STRENGTH', 'dense', 'recovery under strain'),
];

export class Variant {
  readonly key: string;
  readonly name: string;
  readonly policy: string;
  readonly modes: readonly string[];
  readonly modePrior: Record<string, number>;
  readonly scaleBase: number;
  readonly scaleDecay: number;
  readonly centrality: number;
  readonly targetOrder: string;
  readonly modeSchedule: readonly string[];

  constructor(
    key: string,
    name: string,
    policy: string,
    modes: readonly string[],
    modePrior: Record<string, number>,
    scaleBase: number,
    scaleDecay: number,
    centrality: number,
    targetOrder: string,
    modeSchedule: readonly string[] = [],
  ) {
    this.key = key;
    this.name = name;
    this.policy = policy;
    this.modes = modes;
    this.modePrior = modePrior;
    this.scaleBase = scaleBase;
    this.scaleDecay = scaleDecay;
    this.centrality = centrality;
    this.targetOrder = targetOrder;
    this.modeSchedule = modeSchedule;
  }
}

export const VARIANTS: readonly Variant[] = [
  new Variant(
    'spine',
    'Shared Spine',
    'endpoint continuation, partial shared strokes, restrained crossings',
    ['continue', 'shared', 'T'],
    { continue: 3.2, shared: 3.4, T: 1.2 },
    0.95,
    0.93,
    0,
    'spine',
    ['continue', 'shared'],
  ),
  new Variant(
    'hub',
    'Centred Hub',
    'central T-joints and radial crossings',
    ['T', 'cross'],
    { T: 2.8, cross: 2.2 },
    0.8,
    0.915,
    1.3,
    'hub',
    ['T', 'cross'],
  ),
  new Variant(
    'weave',
    'Cross Weave',
    'segment crossings and shared-stroke lattice',
    ['shared', 'cross'],
    { shared: 2.4, cross: 2.6 },
    0.9,
    0.925,
    0.25,
    'weave',
    ['cross', 'cross', 'shared'],
  ),
];

export function getVariant(key: string): Variant {
  const variant = VARIANTS.find((candidate) => candidate.key === key);
  if (!variant) {
    throw new Error(`unknown variant ${key}`);
  }
  return variant;
}

export class NetworkAnchor {
  readonly anchorId: string;
  readonly owner: number;
  readonly char: string;
  readonly strokeId: string;
  readonly strokeIndex: number;
  readonly segmentIndex: number | null;
  readonly kind: string;
  readonly pos: Vec;
  readonly tangent: Vec;
  readonly normal: Vec;
  readonly segmentLength: number;

  constructor(
    anchorId: string,
    owner: number,
    char: string,
    strokeId: string,
    strokeIndex: number,
    segmentIndex: number | null,
    kind: string,
    pos: Vec,
    tangent: Vec,
    normal: Vec,
    segmentLength = 0,
  ) {
    this.anchorId = anchorId;
    this.owner = owner;
    this.char = char;
    this.strokeId = strokeId;
    this.strokeIndex = strokeIndex;
    this.segmentIndex = segmentIndex;
    this.kind = kind;
    this.pos = pos;
    this.tangent = tangent;
    this.normal = normal;
    this.segmentLength = segmentLength;
  }

  get anchor_id(): string {
    return this.anchorId;
  }

  ref(): Record<string, unknown> {
    return {
      owner: this.owner,
      char: this.char,
      stroke_id: this.strokeId,
      anchor_id: this.anchorId,
      kind: this.kind,
      pos: this.pos.asList(),
    };
  }

  asDict(): Record<string, unknown> {
    return {
      id: this.anchorId,
      owner: this.owner,
      char: this.char,
      stroke_id: this.strokeId,
      stroke_index: this.strokeIndex,
      segment_index: this.segmentIndex,
      kind: this.kind,
      pos: this.pos.asList(),
      tangent: this.tangent.asList(),
      normal: this.normal.asList(),
      segment_length: roundTo(this.segmentLength, 9),
    };
  }
}

export class CandidateSpec {
  readonly mode: string;
  readonly local: Anchor;
  readonly target: NetworkAnchor;
  readonly angleOffset: number;
  readonly slide: number;

  constructor(
    mode: string,
    local: Anchor,
    target: NetworkAnchor,
    angleOffset = 0,
    slide = 0,
  ) {
    this.mode = mode;
    this.local = local;
    this.target = target;
    this.angleOffset = angleOffset;
    this.slide = slide;
  }

  get angle_offset(): number {
    return this.angleOffset;
  }
}

export class Contact {
  readonly kind: string;
  readonly point: Vec;
  readonly newStrokeId: string;
  readonly oldStrokeId: string;
  readonly newOwner: number;
  readonly oldOwner: number;
  readonly angle: number;
  readonly proper: boolean;
  readonly sharedLength: number;
  readonly p0: Vec | null;
  readonly p1: Vec | null;
  readonly gap: number;

  constructor(
    kind: string,
    point: Vec,
    newStrokeId: string,
    oldStrokeId: string,
    newOwner: number,
    oldOwner: number,
    angle = 0,
    proper = false,
    sharedLength = 0,
    p0: Vec | null = null,
    p1: Vec | null = null,
    gap = 0,
  ) {
    this.kind = kind;
    this.point = point;
    this.newStrokeId = newStrokeId;
    this.oldStrokeId = oldStrokeId;
    this.newOwner = newOwner;
    this.oldOwner = oldOwner;
    this.angle = angle;
    this.proper = proper;
    this.sharedLength = sharedLength;
    this.p0 = p0;
    this.p1 = p1;
    this.gap = gap;
  }

  get new_stroke_id(): string {
    return this.newStrokeId;
  }

  get old_stroke_id(): string {
    return this.oldStrokeId;
  }

  get new_owner(): number {
    return this.newOwner;
  }

  get old_owner(): number {
    return this.oldOwner;
  }

  get shared_length(): number {
    return this.sharedLength;
  }

  key(): string {
    return [
      this.kind,
      this.newStrokeId,
      this.oldStrokeId,
      roundTo(this.point.x, 7),
      roundTo(this.point.y, 7),
      roundTo(this.sharedLength, 7),
    ].join('|');
  }
}

export class PlacementCandidate {
  readonly spec: CandidateSpec;
  readonly transform: Transform;
  readonly strokes: readonly Stroke[];
  readonly contacts: readonly Contact[];
  readonly score: number;
  readonly metrics: Record<string, unknown>;
  relaxed = false;

  constructor(
    spec: CandidateSpec,
    transform: Transform,
    strokes: readonly Stroke[],
    contacts: readonly Contact[],
    score: number,
    metrics: Record<string, unknown>,
  ) {
    this.spec = spec;
    this.transform = transform;
    this.strokes = strokes;
    this.contacts = contacts;
    this.score = score;
    this.metrics = metrics;
  }
}

export class PlacedLetter {
  readonly index: number;
  readonly char: string;
  readonly glyph: Glyph;
  readonly transform: Transform;
  readonly strokes: readonly Stroke[];
  readonly anchors: readonly NetworkAnchor[];
  readonly bbox: BBox;
  attachment: Record<string, unknown> | null = null;

  constructor(
    index: number,
    char: string,
    glyph: Glyph,
    transform: Transform,
    strokes: readonly Stroke[],
    anchors: readonly NetworkAnchor[],
    bbox: BBox,
  ) {
    this.index = index;
    this.char = char;
    this.glyph = glyph;
    this.transform = transform;
    this.strokes = strokes;
    this.anchors = anchors;
    this.bbox = bbox;
  }
}

export class GenerationBudget {
  readonly seed: bigint;
  readonly candidateCap: number;
  readonly targetAnchorCap: number;
  readonly maxLetters: number;
  candidatesRaw = 0;
  candidatesEvaluated = 0;
  readonly fallbacks: Record<string, unknown>[] = [];

  constructor(
    seed: bigint,
    candidateCap = 150,
    targetAnchorCap = 30,
    maxLetters = 26,
  ) {
    this.seed = seed;
    this.candidateCap = candidateCap;
    this.targetAnchorCap = targetAnchorCap;
    this.maxLetters = maxLetters;
  }

  asDict(): Record<string, unknown> {
    return {
      seed: this.seed.toString(),
      seed_hex: `0x${this.seed.toString(16).padStart(16, '0')}`,
      candidate_cap_per_letter: this.candidateCap,
      target_anchor_cap: this.targetAnchorCap,
      max_letters: this.maxLetters,
      candidates_raw_total: this.candidatesRaw,
      candidates_evaluated_total: this.candidatesEvaluated,
      fallbacks: this.fallbacks,
    };
  }
}

export function angleDeg(angle: number): number {
  let degrees = (angle * 180) / Math.PI;
  while (degrees <= -180) {
    degrees += 360;
  }
  while (degrees > 180) {
    degrees -= 360;
  }
  return degrees;
}

export function transformFromAnchors(
  local: Anchor,
  target: NetworkAnchor,
  mode: string,
  scale: number,
  angleOffset: number,
  slide: number,
): Transform {
  let angle: number;
  if (mode === 'continue') {
    angle = angleOf(target.tangent.neg()) - angleOf(local.tangent);
  } else if (mode === 'T') {
    angle = angleOf(target.normal) + angleOffset - angleOf(local.tangent);
  } else if (mode === 'shared') {
    angle = angleOf(target.tangent) - angleOf(local.tangent);
  } else {
    angle = angleOf(target.tangent) + angleOffset - angleOf(local.tangent);
  }
  const desired =
    mode === 'shared' ? target.pos.add(target.tangent.mul(slide)) : target.pos;
  const rotated = local.pos.rotate(angle).mul(scale);
  return new Transform(angle, scale, desired.x - rotated.x, desired.y - rotated.y);
}

function owners(strokes: readonly Stroke[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const stroke of strokes) {
    if (stroke.owner !== null) {
      out.set(stroke.strokeId, stroke.owner);
    }
  }
  return out;
}

type OverlapDetector = (
  first: Segment,
  second: Segment,
  distanceTolerance: number,
  minLength: number,
) => [Vec, Vec, number] | null;

function detectContactsWith(
  newStrokes: Iterable<Stroke>,
  oldStrokes: Iterable<Stroke>,
  tolerance: number,
  sharedMinLength: number,
  overlapDetector: OverlapDetector,
): Contact[] {
  const newList = [...newStrokes];
  const oldList = [...oldStrokes];
  const newSegments = allSegments(newList);
  const oldSegments = allSegments(oldList);
  const oldOwner = owners(oldList);
  const newOwner = owners(newList);
  const oldEndpoints: { id: string; point: Vec }[] = [];
  const newEndpoints: { id: string; point: Vec }[] = [];
  for (const stroke of oldList) {
    if (!stroke.closed) {
      oldEndpoints.push({ id: stroke.strokeId, point: stroke.points[0]! });
      oldEndpoints.push({ id: stroke.strokeId, point: stroke.points[stroke.points.length - 1]! });
    }
  }
  for (const stroke of newList) {
    if (!stroke.closed) {
      newEndpoints.push({ id: stroke.strokeId, point: stroke.points[0]! });
      newEndpoints.push({ id: stroke.strokeId, point: stroke.points[stroke.points.length - 1]! });
    }
  }
  const oldBoxes = new Map<string, BBox>();
  for (const stroke of oldList) {
    oldBoxes.set(stroke.strokeId, stroke.bounds().expanded(tolerance));
  }
  const out: Contact[] = [];
  const seen = new Set<string>();

  const add = (contact: Contact): void => {
    const key = contact.key();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(contact);
  };

  for (const newSegment of newSegments) {
    const newBox = BBox.fromPoints([newSegment.p0, newSegment.p1]).expanded(tolerance);
    for (const oldSegment of oldSegments) {
      const oldBox = oldBoxes.get(oldSegment.strokeId);
      if (!oldBox || !newBox.intersects(oldBox)) {
        continue;
      }
      const hit = segmentIntersection(newSegment, oldSegment);
      if (hit) {
        const [point, t, u, angle] = hit;
        const proper = t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
        add(
          new Contact(
            proper ? 'cross' : 'touch',
            point,
            newSegment.strokeId,
            oldSegment.strokeId,
            newOwner.get(newSegment.strokeId) ?? -1,
            oldOwner.get(oldSegment.strokeId) ?? -1,
            angle,
            proper,
          ),
        );
      }
      const overlap = overlapDetector(
        newSegment,
        oldSegment,
        tolerance,
        sharedMinLength,
      );
      if (overlap) {
        const [p0, p1, length] = overlap;
        add(
          new Contact(
            'shared',
            p0.add(p1).mul(0.5),
            newSegment.strokeId,
            oldSegment.strokeId,
            newOwner.get(newSegment.strokeId) ?? -1,
            oldOwner.get(oldSegment.strokeId) ?? -1,
            0,
            false,
            length,
            p0,
            p1,
          ),
        );
      }
    }
  }

  for (const endpoint of newEndpoints) {
    for (const oldSegment of oldSegments) {
      const oldBox = oldBoxes.get(oldSegment.strokeId);
      if (
        !oldBox ||
        !oldBox.intersects(
          new BBox(endpoint.point.x, endpoint.point.y, endpoint.point.x, endpoint.point.y),
        )
      ) {
        continue;
      }
      const [distance, , nearest] = pointSegmentDistance(
        endpoint.point,
        oldSegment.p0,
        oldSegment.p1,
      );
      if (distance <= tolerance) {
        add(
          new Contact(
            'near',
            nearest,
            endpoint.id,
            oldSegment.strokeId,
            newOwner.get(endpoint.id) ?? -1,
            oldOwner.get(oldSegment.strokeId) ?? -1,
            0,
            false,
            0,
            null,
            null,
            distance,
          ),
        );
      }
    }
  }
  for (const endpoint of oldEndpoints) {
    for (const newSegment of newSegments) {
      const [distance, , nearest] = pointSegmentDistance(
        endpoint.point,
        newSegment.p0,
        newSegment.p1,
      );
      if (distance <= tolerance) {
        add(
          new Contact(
            'near',
            nearest,
            newSegment.strokeId,
            endpoint.id,
            newOwner.get(newSegment.strokeId) ?? -1,
            oldOwner.get(endpoint.id) ?? -1,
            0,
            false,
            0,
            null,
            null,
            distance,
          ),
        );
      }
    }
  }
  return out;
}

export function detectContacts(
  newStrokes: Iterable<Stroke>,
  oldStrokes: Iterable<Stroke>,
  tolerance: number,
  sharedMinLength: number,
): Contact[] {
  return detectContactsWith(
    newStrokes,
    oldStrokes,
    tolerance,
    sharedMinLength,
    collinearOverlap as OverlapDetector,
  );
}

export function detectPrototypeContacts(
  newStrokes: Iterable<Stroke>,
  oldStrokes: Iterable<Stroke>,
  tolerance: number,
  sharedMinLength: number,
): Contact[] {
  return detectContactsWith(
    newStrokes,
    oldStrokes,
    tolerance,
    sharedMinLength,
    tolerantCollinearOverlap as OverlapDetector,
  );
}

export function sharedByPair(contacts: Iterable<Contact>): Map<string, number> {
  const out = new Map<string, number>();
  for (const contact of contacts) {
    if (contact.kind !== 'shared') {
      continue;
    }
    const key = `${contact.newStrokeId}|${contact.oldStrokeId}`;
    out.set(key, Math.max(out.get(key) ?? 0, contact.sharedLength));
  }
  return out;
}

export function properCrossings(contacts: Iterable<Contact>): Contact[] {
  return [...contacts].filter((contact) => contact.kind === 'cross' && contact.proper);
}

export function centrality(anchor: NetworkAnchor, centroid: Vec, span: number): number {
  if (span <= 0) {
    return 0;
  }
  const distance = anchor.pos.sub(centroid).norm() / (0.75 * span);
  return Math.max(0, 1 - Math.min(1, distance));
}

export function targetAnchors(
  placed: readonly PlacedLetter[],
  variant: Variant,
  cap: number,
): { selected: NetworkAnchor[]; centroid: Vec; span: number } {
  const anchors = placed.flatMap((letter) => letter.anchors);
  const strokes = placed.flatMap((letter) => letter.strokes);
  const samples = sampleStrokes(strokes, 1);
  const bbox = BBox.fromPoints(samples);
  const centroid = new Vec(
    samples.reduce((sum, point) => sum + point.x, 0) / Math.max(1, samples.length),
    samples.reduce((sum, point) => sum + point.y, 0) / Math.max(1, samples.length),
  );
  const span = Math.max(bbox.span, 1e-9);
  const quotas: Record<string, Record<string, number>> = {
    spine: { endpoint: 12, corner: 8, segment: 10 },
    hub: { endpoint: 9, corner: 9, segment: 12 },
    weave: { segment: 14, corner: 8, endpoint: 8 },
  };
  const selected: NetworkAnchor[] = [];
  for (const [kind, quota] of Object.entries(quotas[variant.targetOrder] ?? {})) {
    const group = anchors.filter((anchor) => anchor.kind === kind);
    if (variant.targetOrder === 'hub') {
      group.sort(
        (left, right) =>
          -centrality(left, centroid, span) - -centrality(right, centroid, span) ||
          (left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0),
      );
    } else if (variant.targetOrder === 'spine') {
      group.sort(
        (left, right) =>
          left.owner - right.owner ||
          left.strokeIndex - right.strokeIndex ||
          (left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0),
      );
    } else {
      group.sort(
        (left, right) =>
          Number(left.kind !== 'segment') - Number(right.kind !== 'segment') ||
          left.owner - right.owner ||
          left.strokeIndex - right.strokeIndex ||
          (left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0),
      );
    }
    selected.push(...group.slice(0, quota));
  }
  if (selected.length < cap) {
    const used = new Set(selected.map((anchor) => anchor.anchorId));
    const remainder = anchors.filter((anchor) => !used.has(anchor.anchorId));
    remainder.sort(
      (left, right) =>
        stableUnit(variant.key, left.anchorId) - stableUnit(variant.key, right.anchorId),
    );
    selected.push(...remainder.slice(0, cap - selected.length));
  }
  if (variant.targetOrder === 'hub') {
    selected.sort(
      (left, right) =>
        -centrality(left, centroid, span) - -centrality(right, centroid, span) ||
        (left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0),
    );
  }
  return { selected: selected.slice(0, cap), centroid, span };
}

export function localAnchors(glyph: Glyph, mode: string, _variant: Variant): Anchor[] {
  let group: Anchor[];
  if (mode === 'continue') {
    group = glyph.anchors.filter((anchor) => anchor.kind === 'endpoint');
  } else if (mode === 'shared') {
    group = glyph.anchors.filter((anchor) => anchor.kind === 'segment');
  } else if (mode === 'T') {
    group = glyph.anchors.filter(
      (anchor) => anchor.kind === 'endpoint' || anchor.kind === 'corner',
    );
  } else {
    group = glyph.anchors.filter(
      (anchor) => anchor.kind === 'segment' || anchor.kind === 'corner',
    );
  }
  group.sort(
    (left, right) =>
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
      (left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0),
  );
  return group.slice(0, 14);
}

export function candidateSpecs(
  glyph: Glyph,
  targets: readonly NetworkAnchor[],
  variant: Variant,
  seed: bigint,
  letterIndex: number,
  cap: number,
): { specs: CandidateSpec[]; rawTotal: number } {
  const groups = new Map<string, CandidateSpec[]>();
  for (const mode of variant.modes) {
    const localGroup = localAnchors(glyph, mode, variant);
    let targetGroup: readonly NetworkAnchor[];
    let angles: readonly number[];
    let slides: readonly number[];
    if (mode === 'continue') {
      targetGroup = targets.filter((anchor) => anchor.kind === 'endpoint');
      angles = [0];
      slides = [0];
    } else if (mode === 'shared') {
      targetGroup = targets.filter((anchor) => anchor.kind === 'segment');
      angles = [0];
      slides = [0, 0.35, -0.35, 0.65, -0.65];
    } else if (mode === 'T') {
      targetGroup = targets;
      angles = [0, Math.PI];
      slides = [0];
    } else {
      targetGroup = targets;
      angles = [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, (2 * Math.PI) / 3];
      slides = [0];
    }
    const specs: CandidateSpec[] = [];
    for (const local of localGroup) {
      for (const target of targetGroup) {
        for (const angle of angles) {
          for (const slideFraction of slides) {
            let slide = 0;
            if (mode === 'shared') {
              slide =
                slideFraction *
                Math.min(localSegmentLength(glyph, local), targetSegmentLength(target));
            }
            specs.push(new CandidateSpec(mode, local, target, angle, slide));
          }
        }
      }
    }
    groups.set(mode, specs);
  }
  const rawTotal = [...groups.values()].reduce((sum, specs) => sum + specs.length, 0);
  const modeCount = Math.max(1, groups.size);
  const quotas = new Map<string, number>();
  let modeIndex = 0;
  for (const mode of groups.keys()) {
    quotas.set(mode, Math.floor(cap / modeCount) + (modeIndex < cap % modeCount ? 1 : 0));
    modeIndex += 1;
  }
  const picked: CandidateSpec[] = [];
  const leftover: CandidateSpec[] = [];
  for (const [mode, specs] of groups) {
    const ordered = [...specs].sort(
      (left, right) =>
        stableUnit(
          seed,
          letterIndex,
          mode,
          left.local.anchorId,
          left.target.anchorId,
          pyFloat(left.angleOffset),
          pyFloat(left.slide),
        ) -
        stableUnit(
          seed,
          letterIndex,
          mode,
          right.local.anchorId,
          right.target.anchorId,
          pyFloat(right.angleOffset),
          pyFloat(right.slide),
        ),
    );
    const quota = quotas.get(mode) ?? 0;
    picked.push(...ordered.slice(0, quota));
    leftover.push(...ordered.slice(quota));
  }
  if (picked.length < cap && leftover.length > 0) {
    leftover.sort(
      (left, right) =>
        stableUnit(
          seed,
          letterIndex,
          'fill',
          left.local.anchorId,
          left.target.anchorId,
          pyFloat(left.angleOffset),
          pyFloat(left.slide),
        ) -
        stableUnit(
          seed,
          letterIndex,
          'fill',
          right.local.anchorId,
          right.target.anchorId,
          pyFloat(right.angleOffset),
          pyFloat(right.slide),
        ),
    );
    picked.push(...leftover.slice(0, cap - picked.length));
  }
  picked.sort((left, right) => {
    return (
      stableUnit(
        seed,
        letterIndex,
        'eval',
        left.mode,
        left.local.anchorId,
        left.target.anchorId,
        pyFloat(left.angleOffset),
        pyFloat(left.slide),
      ) -
      stableUnit(
        seed,
        letterIndex,
        'eval',
        right.mode,
        right.local.anchorId,
        right.target.anchorId,
        pyFloat(right.angleOffset),
        pyFloat(right.slide),
      )
    );
  });
  return { specs: picked, rawTotal };
}

export function localSegmentLength(glyph: Glyph, anchor: Anchor): number {
  if (anchor.segmentIndex === null) {
    return 0.2;
  }
  const segments = glyph.strokes[anchor.strokeIndex]?.segments() ?? [];
  if (segments.length === 0) {
    return 0.2;
  }
  return segments[anchor.segmentIndex]?.length ?? 0.2;
}

export function targetSegmentLength(anchor: NetworkAnchor): number {
  return Math.max(0.05, anchor.segmentLength);
}

export function networkAnchorFromLocal(
  anchor: Anchor,
  owner: number,
  char: string,
  transform: Transform,
  strokeId: string,
  segmentLength = 0,
): NetworkAnchor {
  const pos = transform.apply(anchor.pos);
  const tangent = anchor.tangent.rotate(transform.angle);
  const normal = anchor.normal.rotate(transform.angle);
  return new NetworkAnchor(
    `${owner}:${anchor.anchorId}`,
    owner,
    char,
    strokeId,
    anchor.strokeIndex,
    anchor.segmentIndex,
    anchor.kind,
    pos,
    tangent,
    normal,
    segmentLength * transform.scale,
  );
}

export interface CandidateScore {
  readonly score: number;
  readonly metrics: Record<string, unknown>;
  readonly contacts: readonly Contact[];
  readonly maxCrossPerStroke: number;
  readonly shallow: number;
  readonly sharedTotal: number;
}

export function scoreCandidate(
  spec: CandidateSpec,
  transform: Transform,
  newStrokes: readonly Stroke[],
  oldStrokes: readonly Stroke[],
  oldBBox: BBox,
  centroid: Vec,
  contacts: readonly Contact[],
  variant: Variant,
  seed: bigint,
  letterIndex: number,
  candidateIndex: number,
): CandidateScore {
  const newBBox = BBox.fromPoints(
    newStrokes.flatMap((stroke) => stroke.points),
  );
  const mergedBBox = new BBox(
    Math.min(oldBBox.minX, newBBox.minX),
    Math.min(oldBBox.minY, newBBox.minY),
    Math.max(oldBBox.maxX, newBBox.maxX),
    Math.max(oldBBox.maxY, newBBox.maxY),
  );
  const span = Math.max(oldBBox.span, 1e-9);
  const mergedSpan = Math.max(mergedBBox.span, 1e-9);
  const growth = mergedSpan / span;
  const minDimension = Math.max(1e-9, Math.min(mergedBBox.width, mergedBBox.height));
  const aspect = Math.max(mergedBBox.width, mergedBBox.height) / minDimension;
  const uniqueContacts = new Set(contacts.map((contact) => contact.key())).size;
  const contactedStrokes = new Set(contacts.map((contact) => contact.oldStrokeId)).size;
  const proper = properCrossings(contacts);
  const properUnique = new Set(
    proper.map(
      (contact) =>
        `${contact.newStrokeId}|${contact.oldStrokeId}|${roundTo(contact.point.x, 7)}|${roundTo(contact.point.y, 7)}`,
    ),
  );
  const perStroke = new Map<string, number>();
  for (const contact of proper) {
    perStroke.set(contact.newStrokeId, (perStroke.get(contact.newStrokeId) ?? 0) + 1);
  }
  const maxCrossPerStroke = Math.max(0, ...perStroke.values());
  const shallow = proper.filter((contact) => contact.angle < 0.35).length;
  const sharedPairs = sharedByPair(contacts);
  const sharedTotal = [...sharedPairs.values()].reduce((sum, value) => sum + value, 0);
  const newTotalLength = newStrokes.reduce(
    (total, stroke) =>
      total + stroke.segments().reduce((sum, segment) => sum + segment.length, 0),
    0,
  );
  const sharedRatio = sharedTotal / Math.max(newTotalLength, 1e-9);
  const mergedSamples = sampleStrokes([...oldStrokes, ...newStrokes], 1);
  const sx =
    mergedSamples.reduce((sum, point) => sum + point.x, 0) /
    Math.max(1, mergedSamples.length);
  const sy =
    mergedSamples.reduce((sum, point) => sum + point.y, 0) /
    Math.max(1, mergedSamples.length);
  const centroidOffset =
    new Vec(sx - mergedBBox.center.x, sy - mergedBBox.center.y).norm() / mergedSpan;
  const targetCentrality = centrality(spec.target, centroid, span);
  const down = Math.max(0, -Math.cos(transform.angle));
  const overlapArea = oldBBox.intersectionArea(newBBox);
  const bboxOverlapRatio = overlapArea / Math.max(oldBBox.area, 1e-9);

  let score = variant.modePrior[spec.mode] ?? 0;
  score += 1.25 * Math.min(contactedStrokes, 4);
  score += 2.3 * Math.min(sharedTotal / mergedSpan, 0.8);
  score += 0.35 * Math.min(properUnique.size, 6);
  score += variant.centrality * targetCentrality;
  score += 0.45 * (1 - Math.min(1, centroidOffset));
  score -= 2.4 * Math.max(0, aspect - 1.9) ** 2;
  score -= 1.35 * Math.max(0, growth - 1.75) ** 2;
  score -= 1.0 * Math.max(0, centroidOffset - 0.08);
  score -= 2.2 * Math.max(0, sharedRatio - 0.66);
  score -= 0.75 * Math.max(0, maxCrossPerStroke - 2);
  score -= 0.35 * Math.max(0, properUnique.size - 4);
  score -= 1.1 * shallow;
  score -= 0.3 * down;
  const jitter = (stableUnit(seed, letterIndex, candidateIndex, 'tie') - 0.5) * 1e-5;
  score += jitter;
  const metrics: Record<string, unknown> = {
    requested_mode: spec.mode,
    score: roundTo(score, 9),
    actual_contact_count: uniqueContacts,
    contacted_strokes: contactedStrokes,
    proper_crossings: properUnique.size,
    max_crossings_per_new_stroke: maxCrossPerStroke,
    shallow_crossings: shallow,
    shared_overlap_total: roundTo(sharedTotal, 9),
    shared_ratio: roundTo(sharedRatio, 9),
    growth: roundTo(growth, 9),
    aspect: roundTo(aspect, 9),
    centroid_offset: roundTo(centroidOffset, 9),
    centrality: roundTo(targetCentrality, 9),
    bbox_overlap_ratio_not_a_join: roundTo(bboxOverlapRatio, 9),
    rotation_deg: roundTo(angleDeg(transform.angle), 6),
    bbox: mergedBBox.asDict(),
  };
  return { score, metrics, contacts, maxCrossPerStroke, shallow, sharedTotal };
}

export function buildLetter(
  index: number,
  char: string,
  transform: Transform,
  glyph: Glyph,
): PlacedLetter {
  const strokes = glyph.worldStrokes(index, transform);
  const anchors: NetworkAnchor[] = [];
  for (const anchor of glyph.anchors) {
    const length = anchor.kind === 'segment' ? localSegmentLength(glyph, anchor) : 0;
    anchors.push(
      networkAnchorFromLocal(
        anchor,
        index,
        char,
        transform,
        strokes[anchor.strokeIndex]?.strokeId ?? `${index}:${anchor.strokeIndex}`,
        length,
      ),
    );
  }
  const bbox = BBox.fromPoints(strokes.flatMap((stroke) => stroke.points));
  return new PlacedLetter(index, char, glyph, transform, strokes, anchors, bbox);
}

export function chooseAttachment(
  spec: CandidateSpec,
  contacts: readonly Contact[],
  newOwner: number,
): Record<string, unknown> {
  const candidates = contacts.filter(
    (contact) => contact.oldOwner !== newOwner && contact.kind !== 'near',
  );
  if (candidates.length === 0) {
    throw new Error('candidate has no actual cross-letter contact');
  }
  const preferred = candidates.filter((contact) => contact.oldOwner === spec.target.owner);
  const pool = preferred.length > 0 ? preferred : candidates;
  const priority: Record<string, number> = { shared: 0, cross: 1, touch: 2 };
  const contact = [...pool].sort((left, right) => {
    return (
      left.point.sub(spec.target.pos).norm() - right.point.sub(spec.target.pos).norm() ||
      (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9) ||
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
    );
  })[0]!;
  return {
    from_letter: newOwner,
    from_char: spec.local.anchorId.split(':')[0],
    to_letter: contact.oldOwner,
    to_char: '',
    mode: spec.mode,
    local_anchor: spec.local.asDict(),
    target_anchor: spec.target.ref(),
    actual_contact: {
      kind: contact.kind,
      point: contact.point.asList(),
      new_stroke_id: contact.newStrokeId,
      old_stroke_id: contact.oldStrokeId,
      angle_deg: roundTo((contact.angle * 180) / Math.PI, 6),
      shared_length: roundTo(contact.sharedLength, 9),
    },
    readability_rotation_deg: roundTo(angleDeg(contact.angle * 0), 6),
  };
}

export function sharedProvenance(
  contacts: Iterable<Contact>,
  placed: readonly PlacedLetter[],
): Record<string, unknown>[] {
  const charByOwner = new Map(placed.map((letter) => [letter.index, letter.char]));
  const out: Record<string, unknown>[] = [];
  for (const contact of contacts) {
    if (contact.kind !== 'shared' || contact.oldOwner === contact.newOwner) {
      continue;
    }
    out.push({
      letter_a: contact.newOwner,
      char_a: charByOwner.get(contact.newOwner) ?? '?',
      letter_b: contact.oldOwner,
      char_b: charByOwner.get(contact.oldOwner) ?? '?',
      new_stroke_id: contact.newStrokeId,
      old_stroke_id: contact.oldStrokeId,
      overlap_length: roundTo(contact.sharedLength, 9),
      p0: contact.p0 ? contact.p0.asList() : null,
      p1: contact.p1 ? contact.p1.asList() : null,
    });
  }
  out.sort((left, right) => {
    return (
      Number(left.letter_a) - Number(right.letter_a) ||
      Number(left.letter_b) - Number(right.letter_b) ||
      (String(left.new_stroke_id) < String(right.new_stroke_id) ? -1 : String(left.new_stroke_id) > String(right.new_stroke_id) ? 1 : 0) ||
      (String(left.old_stroke_id) < String(right.old_stroke_id) ? -1 : String(left.old_stroke_id) > String(right.old_stroke_id) ? 1 : 0)
    );
  });
  return out;
}

export function componentCount(
  strokes: readonly Stroke[],
  contacts: readonly Contact[],
): number {
  const ids = new Set(strokes.map((stroke) => stroke.strokeId));
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) {
    adjacency.set(id, new Set());
  }
  for (const contact of contacts) {
    if (adjacency.has(contact.newStrokeId) && adjacency.has(contact.oldStrokeId)) {
      adjacency.get(contact.newStrokeId)!.add(contact.oldStrokeId);
      adjacency.get(contact.oldStrokeId)!.add(contact.newStrokeId);
    }
  }
  const seen = new Set<string>();
  let count = 0;
  for (const node of [...ids].sort()) {
    if (seen.has(node)) {
      continue;
    }
    count += 1;
    const stack = [node];
    seen.add(node);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return count;
}

export function letterComponentCount(
  letterCount: number,
  contacts: Iterable<Contact>,
): number {
  const adjacency = new Map<number, Set<number>>();
  for (let index = 0; index < letterCount; index += 1) {
    adjacency.set(index, new Set());
  }
  for (const contact of contacts) {
    if (contact.newOwner !== contact.oldOwner) {
      adjacency.get(contact.newOwner)?.add(contact.oldOwner);
      adjacency.get(contact.oldOwner)?.add(contact.newOwner);
    }
  }
  const seen = new Set<number>();
  let count = 0;
  for (let node = 0; node < letterCount; node += 1) {
    if (seen.has(node)) {
      continue;
    }
    count += 1;
    const stack = [node];
    seen.add(node);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return count;
}

export function contactVisualAudit(
  contacts: Iterable<Contact>,
  span = 1,
): Record<string, unknown> {
  const list = [...contacts];
  const exact = list.filter((contact) => contact.kind !== 'near');
  const near = list.filter((contact) => contact.kind === 'near');
  const crossLetterNear = near.filter(
    (contact) => contact.newOwner !== contact.oldOwner,
  );
  const maxNearGap = crossLetterNear.reduce(
    (maximum, contact) => Math.max(maximum, contact.gap),
    0,
  );
  const safeSpan = Math.max(span, 1e-9);
  return {
    exact_contacts: exact.length,
    near_contacts: near.length,
    cross_letter_near_contacts: crossLetterNear.length,
    max_exact_join_gap: 0,
    max_near_gap: roundTo(maxNearGap, 9),
    max_near_gap_normalized: roundTo(maxNearGap / safeSpan, 9),
    near_is_diagnostic_only: true,
    unit: 'prototype world units',
  };
}

export function verifyResult(result: Record<string, any>): Record<string, unknown> {
  const source = String(result.source);
  const letters = result.letters as any[];
  if (letters.length !== source.length) {
    throw new Error('not all source letters survived');
  }
  const allStrokes: Stroke[] = [];
  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index]!;
    if (String(letter.char) !== source[index]) {
      throw new Error(`letter ${index} char mismatch`);
    }
    const glyph = getGlyph(String(letter.char));
    if (!glyph) {
      throw new Error(`missing glyph ${letter.char}`);
    }
    const transformData = letter.transform;
    const transform = new Transform(
      (Number(transformData.angle_deg) * Math.PI) / 180,
      Number(transformData.scale),
      Number(transformData.tx),
      Number(transformData.ty),
    );
    allStrokes.push(...glyph.worldStrokes(index, transform));
  }
  const tolerance = Number(result.parameters.contact_tolerance);
  const sharedMin = Number(result.parameters.shared_min_length);
  const contacts: Contact[] = [];
  for (let first = 0; first < allStrokes.length; first += 1) {
    for (let second = first + 1; second < allStrokes.length; second += 1) {
      contacts.push(
        ...detectContacts([allStrokes[first]!], [allStrokes[second]!], tolerance, sharedMin),
      );
    }
  }
  const unique = new Map<string, Contact>();
  for (const contact of contacts) {
    unique.set(contact.key(), contact);
  }
  const uniqueContacts = [...unique.values()];
  const exactContacts = uniqueContacts.filter((contact) => contact.kind !== 'near');
  const strokeComponents = componentCount(allStrokes, exactContacts);
  const letterComponents = letterComponentCount(letters.length, exactContacts);
  if (strokeComponents !== 1) {
    throw new Error(`stroke network has ${strokeComponents} components`);
  }
  if (letterComponents !== 1) {
    throw new Error(`letter network has ${letterComponents} components`);
  }
  for (let index = 1; index < letters.length; index += 1) {
    if (
      !exactContacts.some(
        (contact) =>
          (contact.newOwner === index || contact.oldOwner === index) &&
          contact.newOwner !== contact.oldOwner,
      )
    ) {
      throw new Error(`letter ${index} has no exact rendered contact`);
    }
  }
  const bounds = result.bounds as Record<string, unknown>;
  const span = Math.max(Number(bounds.width ?? 0), Number(bounds.height ?? 0), 1e-9);
  for (const value of Object.values(bounds)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('bounds are not finite');
    }
  }
  for (const record of (result.shared_strokes ?? []) as any[]) {
    if (Number(record.overlap_length) <= sharedMin) {
      throw new Error('shared provenance length below threshold');
    }
    const p0 = new Vec(Number(record.p0[0]), Number(record.p0[1]));
    const p1 = new Vec(Number(record.p1[0]), Number(record.p1[1]));
    if (p1.sub(p0).norm() + 1e-6 < Number(record.overlap_length)) {
      throw new Error('shared provenance endpoints too short');
    }
  }
  return {
    stroke_components: strokeComponents,
    letter_components: letterComponents,
    actual_contacts: uniqueContacts.length,
    exact_contacts: exactContacts.length,
    near_contacts: uniqueContacts.length - exactContacts.length,
    shared_records: (result.shared_strokes ?? []).length,
    visual_divergence: contactVisualAudit(uniqueContacts, span),
  };
}

function contactAsDict(contact: Contact): Record<string, unknown> {
  return {
    kind: contact.kind,
    new_stroke_id: contact.newStrokeId,
    old_stroke_id: contact.oldStrokeId,
    new_owner: contact.newOwner,
    old_owner: contact.oldOwner,
    point: contact.point.asList(),
    angle_deg: roundTo((contact.angle * 180) / Math.PI, 6),
    shared_length: roundTo(contact.sharedLength, 9),
    p0: contact.p0 ? contact.p0.asList() : null,
    p1: contact.p1 ? contact.p1.asList() : null,
    proper: contact.proper,
  };
}

export function generateSigil(
  source: string,
  variantKey: string,
  options: { seed?: bigint; sigilId?: string; candidateCap?: number } = {},
): Record<string, any> {
  const original = source;
  source = reduceIntention(source);
  if (!source) {
    throw new Error(`intention reduces to empty (no consonants): ${original}`);
  }
  if (source.length > 26) {
    throw new Error('source is limited to 26 letters');
  }
  const variant = getVariant(variantKey);
  for (const char of source) {
    if (!getGlyph(char)) {
      throw new Error(`unsupported character ${char}`);
    }
  }
  const seedValue = options.seed ?? stableSeed(source, variantKey, 'sigil-poc-v1');
  const candidateCap = options.candidateCap ?? 150;
  const budget = new GenerationBudget(
    seedValue,
    candidateCap,
    30,
    Math.min(26, source.length),
  );
  const placed: PlacedLetter[] = [];
  const firstGlyph = getGlyph(source[0]!)!;
  const firstScale = variant.scaleBase;
  const firstCenter = firstGlyph.bounds.center;
  const firstTransform = new Transform(
    0,
    firstScale,
    -firstScale * firstCenter.x,
    -firstScale * firstCenter.y,
  );
  placed.push(buildLetter(0, source[0]!, firstTransform, firstGlyph));

  const parameters = {
    contact_tolerance: 0.032,
    shared_min_length: 0.075,
    candidate_cap_per_letter: candidateCap,
    scale_min: 0.38,
    scale_sequence: `${variant.scaleBase} * ${variant.scaleDecay}^i, floor 0.38`,
  };

  for (let index = 1; index < source.length; index += 1) {
    const char = source[index]!;
    const glyph = getGlyph(char)!;
    const scale = Math.max(0.38, variant.scaleBase * variant.scaleDecay ** index);
    const targetResult = targetAnchors(placed, variant, budget.targetAnchorCap);
    const oldStrokes = placed.flatMap((letter) => letter.strokes);
    const oldBBox = BBox.fromPoints(oldStrokes.flatMap((stroke) => stroke.points));
    const specResult = candidateSpecs(
      glyph,
      targetResult.selected,
      variant,
      seedValue,
      index,
      candidateCap,
    );
    budget.candidatesRaw += specResult.rawTotal;
    const requiredMode = variant.modeSchedule.length > 0
      ? variant.modeSchedule[(index - 1) % variant.modeSchedule.length]!
      : null;
    let best: PlacementCandidate | null = null;
    let bestRequired: PlacementCandidate | null = null;
    let bestRelaxed: PlacementCandidate | null = null;
    let bestRequiredRelaxed: PlacementCandidate | null = null;
    for (let candidateIndex = 0; candidateIndex < specResult.specs.length; candidateIndex += 1) {
      const spec = specResult.specs[candidateIndex]!;
      const transform = transformFromAnchors(
        spec.local,
        spec.target,
        spec.mode,
        scale,
        spec.angleOffset,
        spec.slide,
      );
      const newStrokes = glyph.worldStrokes(index, transform);
      const contacts = detectContacts(
        newStrokes,
        oldStrokes,
        parameters.contact_tolerance,
        parameters.shared_min_length,
      );
      if (
        !contacts.some(
          (contact) => contact.oldOwner !== index && contact.kind !== 'near',
        )
      ) {
        continue;
      }
      const scoringContacts = detectPrototypeContacts(
        newStrokes,
        oldStrokes,
        parameters.contact_tolerance,
        parameters.shared_min_length,
      );
      const scored = scoreCandidate(
        spec,
        transform,
        newStrokes,
        oldStrokes,
        oldBBox,
        targetResult.centroid,
        scoringContacts,
        variant,
        seedValue,
        index,
        candidateIndex,
      );
      budget.candidatesEvaluated += 1;
      const candidate = new PlacementCandidate(
        spec,
        transform,
        newStrokes,
        contacts,
        scored.score,
        { ...scored.metrics },
      );
      candidate.metrics.required_mode = requiredMode;
      const tangled = scored.maxCrossPerStroke > 4 || scored.shallow > 3;
      if (!tangled) {
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        if (
          spec.mode === requiredMode &&
          (!bestRequired || candidate.score > bestRequired.score)
        ) {
          bestRequired = candidate;
        }
      } else {
        candidate.relaxed = true;
        if (!bestRelaxed || candidate.score > bestRelaxed.score) {
          bestRelaxed = candidate;
        }
        if (
          spec.mode === requiredMode &&
          (!bestRequiredRelaxed || candidate.score > bestRequiredRelaxed.score)
        ) {
          bestRequiredRelaxed = candidate;
        }
      }
    }
    let chosen = bestRequired ?? best;
    if (!chosen) {
      chosen = bestRequiredRelaxed ?? bestRelaxed;
      if (chosen) {
        budget.fallbacks.push({
          letter_index: index,
          char,
          reason: 'all candidates exceeded tangle limits; chose least-bad connected placement',
          metrics: chosen.metrics,
        });
      }
    }
    if (!chosen) {
      throw new Error(`no connected placement found for letter ${index} (${char})`);
    }
    if (chosen.spec.mode !== requiredMode) {
      budget.fallbacks.push({
        letter_index: index,
        char,
        reason: `required mode ${requiredMode} unavailable or unconnected; used ${chosen.spec.mode}`,
        metrics: chosen.metrics,
      });
    }
    const letter = buildLetter(index, char, chosen.transform, glyph);
    const attachment = chooseAttachment(chosen.spec, chosen.contacts, index);
    attachment.to_char = placed[Number(attachment.to_letter)]!.char;
    attachment.readability_rotation_deg = roundTo(angleDeg(chosen.transform.angle), 6);
    attachment.candidate_score = roundTo(chosen.score, 9);
    letter.attachment = attachment;
    placed.push(letter);
  }

  const allStrokes = placed.flatMap((letter) => letter.strokes);
  const allContacts: Contact[] = [];
  for (let first = 0; first < allStrokes.length; first += 1) {
    for (let second = first + 1; second < allStrokes.length; second += 1) {
      allContacts.push(
        ...detectContacts(
          [allStrokes[first]!],
          [allStrokes[second]!],
          parameters.contact_tolerance,
          parameters.shared_min_length,
        ),
      );
    }
  }
  const uniqueContacts = [...new Map(allContacts.map((c) => [c.key(), c])).values()];
  const strokeComponents = componentCount(allStrokes, uniqueContacts);
  const letterComponents = letterComponentCount(placed.length, uniqueContacts);
  if (strokeComponents !== 1 || letterComponents !== 1) {
    throw new Error(
      `generated network disconnected: strokes=${strokeComponents}, letters=${letterComponents}`,
    );
  }
  const worldBBox = BBox.fromPoints(allStrokes.flatMap((stroke) => stroke.points));
  const sharedRecords = sharedProvenance(uniqueContacts, placed);
  const attachments = placed.slice(1).map((letter) => letter.attachment!);
  const proper = properCrossings(uniqueContacts);
  const uniqueProper = new Set(
    proper.map(
      (contact) =>
        `${contact.newStrokeId}|${contact.oldStrokeId}|${roundTo(contact.point.x, 7)}|${roundTo(contact.point.y, 7)}`,
    ),
  );
  const result: Record<string, any> = {
    schema: 'lunarz-sigil-prototype/1',
    sigil_id: options.sigilId ?? `${source.toLowerCase()}-${variant.key}`,
    intention: original,
    source,
    reduced_source: source,
    reduced_letters: [...source],
    variant: variant.key,
    variant_name: variant.name,
    policy: variant.policy,
    seed: seedValue.toString(),
    parameters,
    bounds: {
      ...worldBBox.asDict(),
      panel_width: 320,
      panel_height: 300,
    },
    letters: [],
    attachments,
    attachment_graph: {
      nodes: [...source].map((char, index) => ({ index, char })),
      edges: attachments,
    },
    shared_strokes: sharedRecords,
    contacts: [...uniqueContacts]
      .sort((left, right) => {
        return (
          left.newOwner - right.newOwner ||
          left.oldOwner - right.oldOwner ||
          (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
          roundTo(left.point.x, 6) - roundTo(right.point.x, 6) ||
          roundTo(left.point.y, 6) - roundTo(right.point.y, 6)
        );
      })
      .map(contactAsDict),
    metrics: {
      letters_expected: source.length,
      letters_present: placed.length,
      stroke_components: strokeComponents,
      letter_components: letterComponents,
      actual_contacts: uniqueContacts.length,
      proper_crossings: uniqueProper.size,
      shared_strokes: sharedRecords.length,
      shared_overlap_total: roundTo(
        sharedRecords.reduce((sum, record) => sum + Number(record.overlap_length), 0),
        9,
      ),
      attachment_mode_counts: attachments.reduce<Record<string, number>>((counts, record) => {
        const mode = String(record.mode);
        counts[mode] = (counts[mode] ?? 0) + 1;
        return counts;
      }, {}),
      fallback_count: budget.fallbacks.length,
      bbox_overlap_is_not_used_for_connectivity: true,
    },
    budget: budget.asDict(),
  };
  result.letters = placed.map((letter) => ({
    index: letter.index,
    char: letter.char,
    transform: letter.transform.asDict(),
    svg_matrix: letter.transform.svgMatrix(),
    bbox: letter.bbox.asDict(),
    local_strokes: letter.glyph.strokes.map((stroke, index) => ({
      index,
      closed: stroke.closed,
      points: stroke.points.map((point) => point.asList()),
    })),
    anchors: letter.anchors.map((anchor) => anchor.asDict()),
    attachment: letter.attachment,
  }));
  verifyResult(result);
  return result;
}
