import {
  GEOMETRY_EPSILON,
  geometryToPath,
  getGlyphGeometry,
  measureSegmentOverlap,
  transformGlyphGeometry,
  transformPoint,
  type GlyphGeometry,
  type PolylineSegment,
  type SegmentRef,
} from './geometry';
import { GLYPH_BOX_SIZE, getGlyph, type GlyphLetter } from './glyphs';
import type { ClassifiedCharacter, IntentionResult } from './intention';

export const SIGIL_WIDTH = 512;
export const SIGIL_HEIGHT = 512;

export const SPINE_SCALE = 1.22;
export const MIN_COMPANION_SCALE = 0.55;
export const MAX_COMPANION_SCALE = 0.7;
export const MAX_CANDIDATES_PER_LETTER = 24;

const UINT32_RANGE = 0x100000000;
const HALF_CANVAS = SIGIL_WIDTH / 2;
const GLYPH_HALF = GLYPH_BOX_SIZE / 2;
const MAX_CENTER_RADIUS = 85;
const MAX_MARK_EXTENT = 150;
const VARIANT_STRIDE = 104729;
const REGENERATION_STRIDE = 7919;
const SPINE_TARGET_CHANCE = 0.65;
const MIN_COMPANION_JITTER = 0.01;
const MIN_CENTER_SEPARATION_RATIO = 0.205;
const MAX_FALLBACK_CANDIDATES = 512;

export interface LetterTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
}

export interface ConnectionProvenance {
  readonly fromSurvivingIndex: number;
  readonly fromLetter: GlyphLetter;
  readonly fromSegment: SegmentRef;
  readonly toSurvivingIndex: number;
  readonly toLetter: GlyphLetter;
  readonly toSegment: SegmentRef;
  readonly overlapLength: number;
  readonly slide: number;
  readonly angularError: number;
  readonly perpendicularError: number;
}

export interface CompositionSearchStats {
  readonly maxCandidatesPerLetter: number;
  readonly candidatesEvaluated: number;
  readonly acceptedConnections: number;
}

export interface CompositionLetter {
  readonly letter: GlyphLetter;
  readonly glyphId: GlyphLetter;
  readonly sourceIndex: number;
  readonly survivingIndex: number;
  readonly path: string;
  readonly renderPath: string;
  readonly transform: LetterTransform;
}

export interface SigilComposition {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly letters: readonly CompositionLetter[];
  readonly isEmpty: boolean;
  readonly spineSurvivingIndex: number | null;
  readonly connections: readonly ConnectionProvenance[];
  readonly searchStats: CompositionSearchStats;
}

export interface ComposeOptions {
  readonly seed?: number;
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
}

interface PlacedLetter {
  readonly survivingIndex: number;
  readonly letter: GlyphLetter;
  readonly placement: Placement;
  readonly geometry: GlyphGeometry;
}

interface TargetSegment {
  readonly letterIndex: number;
  readonly segment: PolylineSegment;
  usage: number;
}

interface RawConnection {
  readonly fromSurvivingIndex: number;
  readonly toSurvivingIndex: number;
  readonly fromSegment: SegmentRef;
  readonly toSegment: SegmentRef;
  readonly slide: number;
}

interface CandidateScoreInput {
  readonly placement: Placement;
  readonly target: TargetSegment;
  readonly placed: readonly PlacedLetter[];
  readonly spineIndex: number;
  readonly localWorldLength: number;
  readonly overlapLength: number;
  readonly crossings: number;
  readonly currentExtent: number;
}

interface Candidate {
  readonly placement: Placement;
  readonly connection: RawConnection;
  readonly target: TargetSegment;
  readonly score: number;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new RangeError('Seed must be a finite number');
  }

  return Math.trunc(seed) >>> 0;
}

export function seedFromLetters(letters: readonly string[]): number {
  let hash = 0x811c9dc5;

  for (const letter of letters) {
    for (let index = 0; index < letter.length; index += 1) {
      hash ^= letter.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
  let state = normalizeSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function variantSeeds(letters: readonly string[], regeneration = 0): number[] {
  const base = seedFromLetters(letters);
  const regenerate = Number.isFinite(regeneration)
    ? Math.max(0, Math.trunc(regeneration))
    : 0;
  const regenerationOffset = Math.imul(regenerate >>> 0, REGENERATION_STRIDE) >>> 0;
  const safeRange = UINT32_RANGE - 2 * VARIANT_STRIDE;
  const offset = (base + regenerationOffset) % safeRange;

  return [0, 1, 2].map((slot) => (offset + slot * VARIANT_STRIDE) >>> 0);
}

function isKeptCharacter(
  character: ClassifiedCharacter,
): character is ClassifiedCharacter & { normalized: string } {
  return character.classification === 'kept' && character.normalized !== null;
}

function segmentRef(segment: SegmentRef): SegmentRef {
  return { strokeIndex: segment.strokeIndex, segmentIndex: segment.segmentIndex };
}

function findSegment(geometry: GlyphGeometry, reference: SegmentRef): PolylineSegment {
  const segment = geometry.segments.find(
    (candidate) =>
      candidate.strokeIndex === reference.strokeIndex &&
      candidate.segmentIndex === reference.segmentIndex,
  );

  if (!segment) {
    throw new Error(
      `Missing segment ${reference.strokeIndex}:${reference.segmentIndex} in glyph ${geometry.letter}`,
    );
  }

  return segment;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pickWeightedIndex(random: () => number, weights: readonly number[]): number {
  if (weights.length === 0) {
    return -1;
  }

  let total = 0;
  for (const weight of weights) {
    total += Math.max(0, weight);
  }

  if (total <= 0) {
    return Math.min(weights.length - 1, Math.floor(random() * weights.length));
  }

  let target = random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    target -= Math.max(0, weights[index] ?? 0);
    if (target <= 0) {
      return index;
    }
  }

  return weights.length - 1;
}

function pickTarget(
  random: () => number,
  spineSegments: readonly TargetSegment[],
  allSegments: readonly TargetSegment[],
): TargetSegment | null {
  if (allSegments.length === 0) {
    return null;
  }

  const pool =
    spineSegments.length > 0 && random() < SPINE_TARGET_CHANCE
      ? spineSegments
      : allSegments;
  const index = pickWeightedIndex(
    random,
    pool.map((target) => target.segment.length),
  );

  return index >= 0 ? (pool[index] ?? null) : null;
}

function companionScale(
  random: () => number,
  ordinal: number,
  companionCount: number,
): number {
  const progress = companionCount <= 1 ? 0 : ordinal / (companionCount - 1);
  const base =
    MAX_COMPANION_SCALE - (MAX_COMPANION_SCALE - MIN_COMPANION_SCALE) * progress;
  const jitter = (random() - 0.5) * MIN_COMPANION_JITTER * 2;

  return clamp(base + jitter, MIN_COMPANION_SCALE, MAX_COMPANION_SCALE);
}

function computeCandidateTransform(
  local: PolylineSegment,
  target: PolylineSegment,
  scale: number,
  mirror: boolean,
  flip: boolean,
  slideFraction: number,
): Placement {
  const mirrorSign = mirror ? -1 : 1;
  const localVectorX = (local.end.x - local.start.x) * mirrorSign;
  const localVectorY = local.end.y - local.start.y;
  const targetAngle = Math.atan2(target.tangent.y, target.tangent.x);
  const localAngle = Math.atan2(localVectorY, localVectorX);
  const rawRotation = targetAngle - localAngle + (flip ? Math.PI : 0);
  const rotation = Math.atan2(Math.sin(rawRotation), Math.cos(rawRotation));
  const midpointX = (local.midpoint.x - GLYPH_HALF) * mirrorSign * scale;
  const midpointY = (local.midpoint.y - GLYPH_HALF) * scale;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const rotatedX = cosine * midpointX - sine * midpointY;
  const rotatedY = sine * midpointX + cosine * midpointY;
  const slide = clamp(slideFraction, 0, 1);

  return {
    x: target.start.x + target.tangent.x * slide * target.length - rotatedX,
    y: target.start.y + target.tangent.y * slide * target.length - rotatedY,
    rotation: (rotation * 180) / Math.PI,
    scale,
    mirror,
  };
}

function glyphReach(placement: Placement): number {
  const radians = (placement.rotation * Math.PI) / 180;
  return (
    GLYPH_HALF *
    placement.scale *
    (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))
  );
}

function markExtent(placed: readonly PlacedLetter[]): number {
  let extent = 0;

  for (const letter of placed) {
    extent = Math.max(
      extent,
      Math.hypot(letter.placement.x, letter.placement.y) + glyphReach(letter.placement),
    );
  }

  return extent;
}

function nearestCenterDistance(placement: Placement, placed: readonly PlacedLetter[]): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (const letter of placed) {
    nearest = Math.min(
      nearest,
      Math.hypot(
        placement.x - letter.placement.x,
        placement.y - letter.placement.y,
      ),
    );
  }

  return nearest;
}

function minimumCenterSeparation(
  placement: Placement,
  placed: readonly PlacedLetter[],
): number {
  let scaleTotal = placement.scale;

  for (const letter of placed) {
    scaleTotal += letter.placement.scale;
  }

  return (
    MIN_CENTER_SEPARATION_RATIO *
    GLYPH_BOX_SIZE *
    (scaleTotal / (placed.length + 1))
  );
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function boxesOverlap(left: PolylineSegment, right: PolylineSegment): boolean {
  const leftMinX = Math.min(left.start.x, left.end.x);
  const leftMaxX = Math.max(left.start.x, left.end.x);
  const leftMinY = Math.min(left.start.y, left.end.y);
  const leftMaxY = Math.max(left.start.y, left.end.y);
  const rightMinX = Math.min(right.start.x, right.end.x);
  const rightMaxX = Math.max(right.start.x, right.end.x);
  const rightMinY = Math.min(right.start.y, right.end.y);
  const rightMaxY = Math.max(right.start.y, right.end.y);

  return (
    leftMinX <= rightMaxX &&
    leftMaxX >= rightMinX &&
    leftMinY <= rightMaxY &&
    leftMaxY >= rightMinY
  );
}

function segmentsCross(left: PolylineSegment, right: PolylineSegment): boolean {
  if (!boxesOverlap(left, right)) {
    return false;
  }

  const first = orientation(left.start, left.end, right.start);
  const second = orientation(left.start, left.end, right.end);
  const third = orientation(right.start, right.end, left.start);
  const fourth = orientation(right.start, right.end, left.end);

  if (first === 0 || second === 0 || third === 0 || fourth === 0) {
    return false;
  }

  return first > 0 !== second > 0 && third > 0 !== fourth > 0;
}

function countCrossings(
  candidate: GlyphGeometry,
  local: PolylineSegment,
  target: TargetSegment,
  placed: readonly PlacedLetter[],
): number {
  let crossings = 0;

  for (const candidateSegment of candidate.segments) {
    for (const placedLetter of placed) {
      for (const existingSegment of placedLetter.geometry.segments) {
        const isConnection =
          candidateSegment.strokeIndex === local.strokeIndex &&
          candidateSegment.segmentIndex === local.segmentIndex &&
          placedLetter.survivingIndex === target.letterIndex &&
          existingSegment.strokeIndex === target.segment.strokeIndex &&
          existingSegment.segmentIndex === target.segment.segmentIndex;

        if (isConnection) {
          continue;
        }

        if (segmentsCross(candidateSegment, existingSegment)) {
          crossings += 1;
        }
      }
    }
  }

  return crossings;
}

function scoreCandidate(input: CandidateScoreInput): number {
  const {
    placement,
    target,
    placed,
    spineIndex,
    localWorldLength,
    overlapLength,
    crossings,
    currentExtent,
  } = input;
  const overlapRatio =
    overlapLength /
    Math.max(GEOMETRY_EPSILON, Math.min(localWorldLength, target.segment.length));
  let score = target.letterIndex === spineIndex ? 3 : 0;
  score += overlapRatio * 2;
  score -= crossings * 0.4;

  let nearest = Number.POSITIVE_INFINITY;
  let scaleTotal = placement.scale;

  for (const letter of placed) {
    nearest = Math.min(
      nearest,
      Math.hypot(
        placement.x - letter.placement.x,
        placement.y - letter.placement.y,
      ),
    );
    scaleTotal += letter.placement.scale;
  }

  const averageScale = scaleTotal / (placed.length + 1);
  const minimumSeparation = 0.2 * GLYPH_BOX_SIZE * averageScale;

  if (nearest < minimumSeparation) {
    score -= ((minimumSeparation - nearest) / minimumSeparation) * 1.5;
  }

  const reach = glyphReach(placement);
  const newExtent = Math.max(
    currentExtent,
    Math.hypot(placement.x, placement.y) + reach,
  );
  const growth =
    currentExtent > 0 ? Math.max(0, (newExtent - currentExtent) / currentExtent) : 0;
  score -= growth * 1.2;
  score -= target.usage * 0.25;
  score -= (Math.hypot(placement.x, placement.y) / 150) * 0.35;

  return score;
}

function findFallbackCandidate(
  geometry: GlyphGeometry,
  targets: readonly TargetSegment[],
  placed: readonly PlacedLetter[],
  scale: number,
  spineIndex: number,
  currentExtent: number,
  survivingIndex: number,
): Candidate | null {
  const slides = [0.5, 0.2, 0.8, 0.35, 0.65];
  let tested = 0;
  let best: Candidate | null = null;

  search: for (const target of targets) {
    for (const local of geometry.segments) {
      for (const mirror of [false, true]) {
        for (const flip of [false, true]) {
          for (const slide of slides) {
            if (tested >= MAX_FALLBACK_CANDIDATES) {
              break search;
            }
            tested += 1;
            const placement = computeCandidateTransform(
              local,
              target.segment,
              scale,
              mirror,
              flip,
              slide,
            );

            if (
              nearestCenterDistance(placement, placed) <
              minimumCenterSeparation(placement, placed)
            ) {
              continue;
            }

            const overlap = verifiedOverlap(placement, local, target.segment);

            if (!overlap.overlaps) {
              continue;
            }

            const candidateGeometry = transformGlyphGeometry(geometry, placement);
            const crossings = countCrossings(candidateGeometry, local, target, placed);
            const score = scoreCandidate({
              placement,
              target,
              placed,
              spineIndex,
              localWorldLength: local.length * scale,
              overlapLength: overlap.length,
              crossings,
              currentExtent,
            });

            if (best === null || score > best.score) {
              best = {
                placement,
                target,
                score,
                connection: {
                  fromSurvivingIndex: survivingIndex,
                  toSurvivingIndex: target.letterIndex,
                  fromSegment: segmentRef(local),
                  toSegment: segmentRef(target.segment),
                  slide,
                },
              };
            }
          }
        }
      }
    }
  }

  return best;
}

function verifiedOverlap(
  placement: Placement,
  local: PolylineSegment,
  target: PolylineSegment,
): ReturnType<typeof measureSegmentOverlap> {
  return measureSegmentOverlap(
    {
      start: transformPoint(placement, local.start),
      end: transformPoint(placement, local.end),
    },
    target,
    GEOMETRY_EPSILON,
  );
}

function layoutLetters(
  letters: readonly GlyphLetter[],
  seed: number,
): {
  readonly placements: readonly Placement[];
  readonly spineIndex: number;
  readonly connections: readonly RawConnection[];
  readonly candidatesEvaluated: number;
} {
  const count = letters.length;
  const random = createSeededRandom(seed);
  const spineIndex = seed % count;
  const placements: Placement[] = new Array<Placement>(count);
  const placed: PlacedLetter[] = [];
  const targets: TargetSegment[] = [];
  const connections: RawConnection[] = [];

  const addPlaced = (
    survivingIndex: number,
    placement: Placement,
    geometry: GlyphGeometry,
  ): void => {
    placements[survivingIndex] = placement;
    placed.push({
      survivingIndex,
      letter: letters[survivingIndex]!,
      placement,
      geometry,
    });

    for (const segment of geometry.segments) {
      targets.push({ letterIndex: survivingIndex, segment, usage: 0 });
    }
  };

  const spineGeometry = getGlyphGeometry(letters[spineIndex]!);
  if (!spineGeometry) {
    throw new Error(`No geometry is defined for spine letter "${letters[spineIndex]}"`);
  }

  const spinePlacement: Placement = {
    x: 0,
    y: 0,
    rotation: random() * 360 - 180,
    scale: SPINE_SCALE,
    mirror: random() < 0.5,
  };
  addPlaced(
    spineIndex,
    spinePlacement,
    transformGlyphGeometry(spineGeometry, spinePlacement),
  );

  const companions = Array.from({ length: count }, (_, index) => index).filter(
    (index) => index !== spineIndex,
  );
  let candidatesEvaluated = 0;

  for (let ordinal = 0; ordinal < companions.length; ordinal += 1) {
    const survivingIndex = companions[ordinal]!;
    const letter = letters[survivingIndex]!;
    const geometry = getGlyphGeometry(letter);

    if (!geometry) {
      throw new Error(`No geometry is defined for letter "${letter}"`);
    }

    const scale = companionScale(random, ordinal, companions.length);
    const spineTargets = targets.filter((target) => target.letterIndex === spineIndex);
    const currentExtent = markExtent(placed);
    let best: Candidate | null = null;

    for (let candidateIndex = 0; candidateIndex < MAX_CANDIDATES_PER_LETTER; candidateIndex += 1) {
      candidatesEvaluated += 1;
      const localIndex = pickWeightedIndex(
        random,
        geometry.segments.map((segment) => segment.length),
      );
      const local = geometry.segments[localIndex];

      if (!local) {
        continue;
      }

      const target = pickTarget(random, spineTargets, targets);

      if (!target) {
        continue;
      }

      const mirror = random() < 0.5;
      const flip = random() < 0.5;
      const slide = 0.1 + random() * 0.8;
      const placement = computeCandidateTransform(
        local,
        target.segment,
        scale,
        mirror,
        flip,
        slide,
      );

      if (
        nearestCenterDistance(placement, placed) <
        minimumCenterSeparation(placement, placed)
      ) {
        continue;
      }

      const overlap = verifiedOverlap(placement, local, target.segment);

      if (!overlap.overlaps) {
        continue;
      }

      const candidateGeometry = transformGlyphGeometry(geometry, placement);
      const crossings = countCrossings(candidateGeometry, local, target, placed);
      const score = scoreCandidate({
        placement,
        target,
        placed,
        spineIndex,
        localWorldLength: local.length * scale,
        overlapLength: overlap.length,
        crossings,
        currentExtent,
      });

      if (best === null || score > best.score) {
        best = {
          placement,
          target,
          score,
          connection: {
            fromSurvivingIndex: survivingIndex,
            toSurvivingIndex: target.letterIndex,
            fromSegment: segmentRef(local),
            toSegment: segmentRef(target.segment),
            slide,
          },
        };
      }
    }

    if (best === null) {
      best = findFallbackCandidate(
        geometry,
        targets,
        placed,
        scale,
        spineIndex,
        currentExtent,
        survivingIndex,
      );
    }

    if (best === null) {
      throw new Error(`No exact parallel overlap was found for letter "${letter}"`);
    }

    best.target.usage += 1;
    addPlaced(
      survivingIndex,
      best.placement,
      transformGlyphGeometry(geometry, best.placement),
    );
    connections.push(best.connection);
  }

  return {
    placements,
    spineIndex,
    connections,
    candidatesEvaluated,
  };
}

function fitPlacements(placements: readonly Placement[]): LetterTransform[] {
  let weightTotal = 0;
  let centerX = 0;
  let centerY = 0;

  for (const placement of placements) {
    const weight = placement.scale * placement.scale;
    weightTotal += weight;
    centerX += placement.x * weight;
    centerY += placement.y * weight;
  }

  centerX /= weightTotal;
  centerY /= weightTotal;

  let maxCenterDistance = 0;
  let maxExtent = 0;

  for (const placement of placements) {
    const distance = Math.hypot(placement.x - centerX, placement.y - centerY);
    const extent = distance + glyphReach(placement);
    maxCenterDistance = Math.max(maxCenterDistance, distance);
    maxExtent = Math.max(maxExtent, extent);
  }

  const centerFit = maxCenterDistance > 0 ? MAX_CENTER_RADIUS / maxCenterDistance : Infinity;
  const extentFit = maxExtent > 0 ? MAX_MARK_EXTENT / maxExtent : Infinity;
  const fit = Math.min(1, centerFit, extentFit);

  return placements.map((placement) => ({
    x: HALF_CANVAS + (placement.x - centerX) * fit,
    y: HALF_CANVAS + (placement.y - centerY) * fit,
    rotation: placement.rotation,
    scale: placement.scale * fit,
    mirror: placement.mirror,
  }));
}

export function composeSigil(intention: IntentionResult, options: ComposeOptions = {}): SigilComposition {
  const seed = normalizeSeed(options.seed ?? seedFromLetters(intention.letters));
  const keptCharacters = intention.characters.filter(isKeptCharacter);
  const count = keptCharacters.length;

  if (count === 0) {
    return {
      seed,
      width: SIGIL_WIDTH,
      height: SIGIL_HEIGHT,
      letters: [],
      isEmpty: true,
      spineSurvivingIndex: null,
      connections: [],
      searchStats: {
        maxCandidatesPerLetter: MAX_CANDIDATES_PER_LETTER,
        candidatesEvaluated: 0,
        acceptedConnections: 0,
      },
    };
  }

  const glyphs = keptCharacters.map((character): GlyphLetter => {
    const glyph = getGlyph(character.normalized);

    if (!glyph) {
      throw new Error(`No glyph is defined for surviving letter "${character.normalized}"`);
    }

    return glyph.letter;
  });

  const layout = layoutLetters(glyphs, seed);
  const transforms = fitPlacements(layout.placements);
  const finalGeometries = glyphs.map((letter, index) => {
    const geometry = getGlyphGeometry(letter);

    if (!geometry) {
      throw new Error(`No geometry is defined for letter "${letter}"`);
    }

    return transformGlyphGeometry(geometry, transforms[index]!);
  });
  const connections = layout.connections.map((connection): ConnectionProvenance => {
    const fromSegment = findSegment(
      finalGeometries[connection.fromSurvivingIndex]!,
      connection.fromSegment,
    );
    const toSegment = findSegment(
      finalGeometries[connection.toSurvivingIndex]!,
      connection.toSegment,
    );
    const measured = measureSegmentOverlap(fromSegment, toSegment, GEOMETRY_EPSILON);

    return {
      fromSurvivingIndex: connection.fromSurvivingIndex,
      fromLetter: glyphs[connection.fromSurvivingIndex]!,
      fromSegment: connection.fromSegment,
      toSurvivingIndex: connection.toSurvivingIndex,
      toLetter: glyphs[connection.toSurvivingIndex]!,
      toSegment: connection.toSegment,
      overlapLength: measured.length,
      slide: connection.slide,
      angularError: measured.angularError,
      perpendicularError: measured.perpendicularError,
    };
  });

  const letters = keptCharacters.map((character, survivingIndex): CompositionLetter => {
    const glyph = getGlyph(character.normalized);

    if (!glyph) {
      throw new Error(`No glyph is defined for surviving letter "${character.normalized}"`);
    }

    const transform = transforms[survivingIndex];

    if (!transform) {
      throw new Error(`No placement was produced for surviving letter "${character.normalized}"`);
    }

    const geometry = getGlyphGeometry(glyph.letter);

    if (!geometry) {
      throw new Error(`No geometry is defined for letter "${glyph.letter}"`);
    }

    return {
      letter: glyph.letter,
      glyphId: glyph.letter,
      sourceIndex: character.index,
      survivingIndex,
      path: glyph.paths.join(' '),
      renderPath: geometryToPath(geometry),
      transform,
    };
  });

  return {
    seed,
    width: SIGIL_WIDTH,
    height: SIGIL_HEIGHT,
    letters,
    isEmpty: false,
    spineSurvivingIndex: layout.spineIndex,
    connections,
    searchStats: {
      maxCandidatesPerLetter: MAX_CANDIDATES_PER_LETTER,
      candidatesEvaluated: layout.candidatesEvaluated,
      acceptedConnections: connections.length,
    },
  };
}
