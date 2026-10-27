import { GLYPH_BOX_SIZE, getGlyph, type GlyphLetter } from './glyphs';
import type { ClassifiedCharacter, IntentionResult } from './intention';

export const SIGIL_WIDTH = 512;
export const SIGIL_HEIGHT = 512;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UINT32_RANGE = 0x100000000;
const HALF_CANVAS = SIGIL_WIDTH / 2;
const GLYPH_HALF = GLYPH_BOX_SIZE / 2;
const MARK_MARGIN = 46;
const MAX_MARK_EXTENT = HALF_CANVAS - MARK_MARGIN;
const LAYOUT_MODE_COUNT = 3;
const LAYOUT_MODE_MULTIPLIER = 0x144cbc89;

export interface LetterTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
}

export interface CompositionLetter {
  readonly letter: GlyphLetter;
  readonly glyphId: GlyphLetter;
  readonly sourceIndex: number;
  readonly survivingIndex: number;
  readonly path: string;
  readonly transform: LetterTransform;
}

export interface SigilComposition {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly letters: readonly CompositionLetter[];
  readonly isEmpty: boolean;
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

function isKeptCharacter(
  character: ClassifiedCharacter,
): character is ClassifiedCharacter & { normalized: string } {
  return character.classification === 'kept' && character.normalized !== null;
}

function layoutMode(seed: number): 0 | 1 | 2 {
  const mode = (Math.imul(seed, LAYOUT_MODE_MULTIPLIER) >>> 0) % LAYOUT_MODE_COUNT;
  return mode === 0 ? 0 : mode === 1 ? 1 : 2;
}

function glyphScale(count: number): number {
  if (count <= 1) {
    return 1.5;
  }

  return Math.min(1.16, Math.max(0.44, 1.34 / Math.pow(count, 0.3)));
}

function ringWeight(ring: number): number {
  return ring === 0 ? 1 : ring === 1 ? 1.75 : 2.5;
}

function ringRadius(ring: number): number {
  return ring === 0 ? 0.8 : ring === 1 ? 1.55 : 2.3;
}

function allocateRingCounts(total: number, rings: number): number[] {
  const weights = Array.from({ length: rings }, (_, ring) => ringWeight(ring));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const counts = weights.map(() => 1);
  const remaining = total - rings;

  if (remaining <= 0) {
    return counts;
  }

  const raw = weights.map((weight) => (remaining * weight) / weightTotal);
  const floors = raw.map(Math.floor);
  const assigned = floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ remainder: value - (floors[index] ?? 0), index }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let extra = 0; extra < remaining - assigned; extra += 1) {
    const entry = order[extra % rings];
    if (entry) {
      floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    }
  }

  return counts.map((count, index) => count + (floors[index] ?? 0));
}

function ringPlacements(count: number, random: () => number): Placement[] {
  const rings = count <= 8 ? 1 : count <= 14 ? 2 : 3;
  const ringCounts = allocateRingCounts(count, rings);
  const baseScale = glyphScale(count);
  const unit = GLYPH_HALF * baseScale;
  const phase = random() * Math.PI * 2;
  const lean = (random() - 0.5) * 36;
  const placements: Placement[] = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const lettersInRing = ringCounts[ring] ?? 0;
    if (lettersInRing === 0) {
      continue;
    }

    const direction = ring % 2 === 0 ? 1 : -1;
    const ringPhase = phase + ring * 0.9 + (random() - 0.5) * 0.3;
    const radius = unit * ringRadius(ring);

    for (let slot = 0; slot < lettersInRing; slot += 1) {
      const angle =
        ringPhase +
        direction * slot * ((Math.PI * 2) / lettersInRing) +
        (random() - 0.5) * 0.08;
      const distance = radius * (0.96 + random() * 0.08);
      const scale = baseScale * (0.95 + random() * 0.09);

      placements.push({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        rotation: (angle * 180) / Math.PI + direction * 90 + lean + (random() - 0.5) * 16,
        scale,
        mirror: random() < 0.5,
      });
    }
  }

  return placements;
}

function spokePlacements(count: number, random: () => number): Placement[] {
  const spokes = count <= 4 ? 2 : count <= 9 ? 3 : count <= 15 ? 4 : 5;
  const baseScale = glyphScale(count);
  const unit = GLYPH_HALF * baseScale;
  const phase = random() * Math.PI * 2;
  const lean = (random() - 0.5) * 30;
  const placements: Placement[] = [];

  for (let index = 0; index < count; index += 1) {
    const spoke = index % spokes;
    const level = Math.floor(index / spokes);
    const angle = phase + spoke * ((Math.PI * 2) / spokes) + (random() - 0.5) * 0.06;
    const distance = unit * (0.62 + level * 0.62) * (0.98 + random() * 0.06);
    const lateral = (index % 2 === 0 ? 1 : -1) * unit * 0.1 * (level > 0 ? 1 : 0);
    const scale = baseScale * (0.95 + random() * 0.09);

    placements.push({
      x: Math.cos(angle) * distance - Math.sin(angle) * lateral,
      y: Math.sin(angle) * distance + Math.cos(angle) * lateral,
      rotation:
        (angle * 180) / Math.PI +
        90 +
        (level % 2 === 0 ? 0 : 45) +
        lean +
        (random() - 0.5) * 14,
      scale,
      mirror: random() < 0.5,
    });
  }

  return placements;
}

function spiralPlacements(count: number, random: () => number): Placement[] {
  const baseScale = glyphScale(count);
  const unit = GLYPH_HALF * baseScale;
  const phase = random() * Math.PI * 2;
  const lean = (random() - 0.5) * 60;
  const maxRadius =
    unit * (count <= 3 ? 1.15 : Math.min(2.35, 0.85 + 0.09 * count));
  const placements: Placement[] = [];

  for (let index = 0; index < count; index += 1) {
    const progress = (index + 0.5) / count;
    const distance = maxRadius * Math.sqrt(progress);
    const angle = phase + index * GOLDEN_ANGLE + (random() - 0.5) * 0.1;
    const scale = baseScale * (0.95 + random() * 0.09);

    placements.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      rotation:
        (angle * 180) / Math.PI +
        lean +
        (index % 2 === 0 ? 0 : 90) +
        (random() - 0.5) * 18,
      scale,
      mirror: random() < 0.5,
    });
  }

  return placements;
}

function pairPlacements(random: () => number, mode: 0 | 1 | 2): Placement[] {
  const baseScale = glyphScale(2);
  const unit = GLYPH_HALF * baseScale;
  const axis = mode === 0 ? -Math.PI / 2 : mode === 1 ? 0 : Math.PI / 4;
  const angle = axis + (random() - 0.5) * 0.12;
  const distance = unit * (mode === 1 ? 0.56 : 0.52);
  const leans = mode === 0 ? [-12, 12] : mode === 1 ? [90, -90] : [45, -45];
  const tilt = (random() - 0.5) * 8;

  return [0, 1].map((index) => {
    const side = index === 0 ? -1 : 1;
    const scale = baseScale * (0.96 + random() * 0.08);

    return {
      x: Math.cos(angle) * distance * side,
      y: Math.sin(angle) * distance * side,
      rotation: (leans[index] ?? 0) + tilt * side + (random() - 0.5) * 6,
      scale,
      mirror: random() < 0.5,
    };
  });
}

function balancePlacements(placements: readonly Placement[]): Placement[] {
  if (placements.length === 0) {
    return [];
  }

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

  const centered = placements.map((placement) => ({
    ...placement,
    x: placement.x - centerX,
    y: placement.y - centerY,
  }));

  let extent = 0;

  for (const placement of centered) {
    const radians = (placement.rotation * Math.PI) / 180;
    const rotatedHalf =
      GLYPH_HALF *
      placement.scale *
      (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
    extent = Math.max(extent, Math.hypot(placement.x, placement.y) + rotatedHalf);
  }

  const fit = extent > MAX_MARK_EXTENT ? MAX_MARK_EXTENT / extent : 1;

  return centered.map((placement) => ({
    ...placement,
    x: HALF_CANVAS + placement.x * fit,
    y: HALF_CANVAS + placement.y * fit,
    scale: placement.scale * fit,
  }));
}

function placeLetters(count: number, seed: number): Placement[] {
  const random = createSeededRandom(seed);

  const mode = layoutMode(seed);

  if (count <= 1) {
    const scale = mode === 0 ? 1.2 : mode === 1 ? 1.5 : 1.8;
    const tilt = mode === 0 ? -18 : mode === 1 ? 0 : 18;

    return balancePlacements([
      {
        x: 0,
        y: 0,
        rotation: tilt + (random() - 0.5) * 6,
        scale: scale * (0.98 + random() * 0.04),
        mirror: random() < 0.5,
      },
    ]);
  }

  if (count === 2) {
    return balancePlacements(pairPlacements(random, mode));
  }

  const placements =
    mode === 0
      ? ringPlacements(count, random)
      : mode === 1
        ? spokePlacements(count, random)
        : spiralPlacements(count, random);

  return balancePlacements(placements);
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
    };
  }

  const placements = placeLetters(count, seed);

  const letters = keptCharacters.map((character, survivingIndex): CompositionLetter => {
    const glyph = getGlyph(character.normalized);

    if (!glyph) {
      throw new Error(`No glyph is defined for surviving letter "${character.normalized}"`);
    }

    const placement = placements[survivingIndex];

    if (!placement) {
      throw new Error(`No placement was produced for surviving letter "${character.normalized}"`);
    }

    return {
      letter: glyph.letter,
      glyphId: glyph.letter,
      sourceIndex: character.index,
      survivingIndex,
      path: glyph.paths.join(' '),
      transform: {
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        scale: placement.scale,
        mirror: placement.mirror,
      },
    };
  });

  return {
    seed,
    width: SIGIL_WIDTH,
    height: SIGIL_HEIGHT,
    letters,
    isEmpty: false,
  };
}
