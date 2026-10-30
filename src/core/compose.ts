import {
  formatCoordinate,
  type SegmentRef,
} from './geometry';
import { getGlyph, type GlyphLetter } from './glyphs';
import type { ClassifiedCharacter, IntentionResult } from './intention';
import {
  DEFAULT_CANDIDATE_CAP,
  VARIANT_KEYS,
  generateSizeSigil,
} from './sizeHierarchy';

export const SIGIL_WIDTH = 512;
export const SIGIL_HEIGHT = 512;
export const SPINE_SCALE = 1.22;
export const MIN_COMPANION_SCALE = 0.55;
export const MAX_COMPANION_SCALE = 0.7;
export const MAX_CANDIDATES_PER_LETTER = DEFAULT_CANDIDATE_CAP;

const UINT32_RANGE = 0x100000000;
const VARIANT_STRIDE = 104729;
const REGENERATION_STRIDE = 7919;
const RETRY_STRIDE = 224737;
const MAX_RETRIES = 8;
const LARGE_CANDIDATE_CAP = 80;
const CANVAS_PADDING = 22;

export interface LetterTransform {
  readonly x: number;
  readonly y: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
  readonly angle: number;
  readonly tx: number;
  readonly ty: number;
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
  readonly mode: string;
  readonly kind: string;
  readonly score: number;
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
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly letters: readonly CompositionLetter[];
  readonly isEmpty: boolean;
  readonly spineSurvivingIndex: number | null;
  readonly connections: readonly ConnectionProvenance[];
  readonly searchStats: CompositionSearchStats;
  readonly variant: string;
  readonly variantName: string;
  readonly scaleRecipe: string;
  readonly canvasScale: number;
}

export interface ComposeOptions {
  readonly seed?: number | string | bigint;
  readonly variantKey?: string;
  readonly requireAllStrokesExact?: boolean;
  readonly candidateCap?: number;
  readonly spineIndex?: number;
}

export function variantSpineIndices(letterCount: number): number[] {
  const total = Math.max(0, Math.trunc(letterCount));
  if (total === 0) {
    return [0, 0, 0];
  }
  return [0, 1, 2].map((slot) => slot % total);
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
  let state = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;

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

function normalizeSeed(seed: number | string | bigint): bigint {
  if (typeof seed === 'bigint') {
    return seed < 0n ? seed + (1n << 64n) : seed;
  }
  if (typeof seed === 'string') {
    if (!/^-?\d+$/.test(seed.trim())) {
      throw new RangeError('Seed must be an integer');
    }
    const value = BigInt(seed.trim());
    return value < 0n ? value + (1n << 64n) : value;
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError('Seed must be a finite number');
  }
  return BigInt(Math.trunc(seed) >>> 0);
}

function isKeptCharacter(
  character: ClassifiedCharacter,
): character is ClassifiedCharacter & { normalized: string } {
  return character.classification === 'kept' && character.normalized !== null;
}

function localPath(glyph: ReturnType<typeof getGlyph> & object): string {
  return glyph.strokes
    .map((stroke) => {
      const [first, ...rest] = stroke.points;
      if (!first) {
        return '';
      }
      const parts = [
        `M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`,
      ];
      for (const point of rest) {
        parts.push(`L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`);
      }
      if (stroke.closed) {
        parts.push('Z');
      }
      return parts.join(' ');
    })
    .filter((path) => path.length > 0)
    .join(' ');
}

function strokeIndexFromId(id: unknown): number {
  const text = String(id ?? '');
  const index = Number(text.split(':')[1]);
  return Number.isFinite(index) ? index : 0;
}

function segmentRefFromAnchor(anchor: any, strokeId: unknown): SegmentRef {
  const strokeIndex =
    anchor && Number.isFinite(Number(anchor.stroke_index))
      ? Number(anchor.stroke_index)
      : strokeIndexFromId(strokeId);
  const segmentIndex =
    anchor && Number.isFinite(Number(anchor.segment_index))
      ? Number(anchor.segment_index)
      : 0;
  return { strokeIndex, segmentIndex };
}

export function composeSigil(
  intention: IntentionResult,
  options: ComposeOptions = {},
): SigilComposition {
  const keptCharacters = intention.characters.filter(isKeptCharacter);
  const count = keptCharacters.length;
  const variantKey = options.variantKey ?? VARIANT_KEYS[0]!;
  const seedValue = normalizeSeed(
    options.seed ?? seedFromLetters(intention.letters),
  );

  if (count === 0) {
    return {
      seed: seedValue.toString(),
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
      variant: variantKey,
      variantName: '',
      scaleRecipe: '',
      canvasScale: 1,
    };
  }

  const result = generateSizeSigil(intention.letters.join(''), variantKey, {
    seed: seedValue,
    intention: intention.input,
    candidateCap: options.candidateCap ?? MAX_CANDIDATES_PER_LETTER,
    requireAllStrokesExact: options.requireAllStrokesExact ?? false,
    spineIndex: options.spineIndex ?? 0,
  });

  const bounds = result.bounds;
  const rawWidth = Math.max(Number(bounds.width), 1e-6);
  const rawHeight = Math.max(Number(bounds.height), 1e-6);
  const canvasScale = Math.min(
    (SIGIL_WIDTH - CANVAS_PADDING * 2) / rawWidth,
    (SIGIL_HEIGHT - CANVAS_PADDING * 2) / rawHeight,
  );
  const rawCenterX = (Number(bounds.min_x) + Number(bounds.max_x)) / 2;
  const rawCenterY = (Number(bounds.min_y) + Number(bounds.max_y)) / 2;
  const halfCanvas = SIGIL_WIDTH / 2;

  const letters = [...(result.letters as any[])]
    .sort((left, right) => Number(left.index) - Number(right.index))
    .map((record: any) => {
      const survivingIndex = Number(record.index);
      const character = keptCharacters[survivingIndex]!;
      const glyph = getGlyph(character.normalized);
      if (!glyph) {
        throw new Error(`No glyph is defined for surviving letter "${character.normalized}"`);
      }
      const angle = (Number(record.transform.angle_deg) * Math.PI) / 180;
      const scale = Number(record.scale) * canvasScale;
      const tx = (Number(record.transform.tx) - rawCenterX) * canvasScale + halfCanvas;
      const ty = (Number(record.transform.ty) - rawCenterY) * canvasScale + halfCanvas;
      const letterCenterX =
        (Number(record.bbox.min_x) + Number(record.bbox.max_x)) / 2;
      const letterCenterY =
        (Number(record.bbox.min_y) + Number(record.bbox.max_y)) / 2;
      const labelX = (letterCenterX - rawCenterX) * canvasScale + halfCanvas;
      const labelY = (letterCenterY - rawCenterY) * canvasScale + halfCanvas;
      return {
        letter: glyph.letter,
        glyphId: glyph.letter,
        sourceIndex: character.index,
        survivingIndex,
        path: glyph.paths.join(' '),
        renderPath: localPath(glyph),
        transform: {
          x: tx,
          y: ty,
          labelX,
          labelY,
          rotation: (angle * 180) / Math.PI,
          scale,
          mirror: false,
          angle,
          tx,
          ty,
        },
      };
    });

  const connections = result.attachments.map((attachment: any) => {
    const fromIndex = Number(attachment.from_letter);
    const toIndex = Number(attachment.to_letter);
    return {
      fromSurvivingIndex: fromIndex,
      fromLetter: letters[fromIndex]!.letter,
      fromSegment: segmentRefFromAnchor(
        attachment.local_anchor,
        attachment.actual_contact.new_stroke_id,
      ),
      toSurvivingIndex: toIndex,
      toLetter: letters[toIndex]!.letter,
      toSegment: segmentRefFromAnchor(
        attachment.target_anchor,
        attachment.actual_contact.old_stroke_id,
      ),
      overlapLength: Number(attachment.actual_contact.shared_length),
      slide: 0,
      angularError: 0,
      perpendicularError: 0,
      mode: String(attachment.mode),
      kind: String(attachment.actual_contact.kind),
      score: Number(attachment.candidate_score),
    };
  });

  return {
    seed: String(result.seed),
    width: SIGIL_WIDTH,
    height: SIGIL_HEIGHT,
    letters,
    isEmpty: false,
    spineSurvivingIndex: Number(result.metrics?.spine_letter ?? 0),
    connections,
    searchStats: {
      maxCandidatesPerLetter: MAX_CANDIDATES_PER_LETTER,
      candidatesEvaluated: Number(result.budget.candidates_evaluated_total),
      acceptedConnections: connections.length,
    },
    variant: String(result.variant),
    variantName: String(result.variant_name),
    scaleRecipe: String(result.scale_recipe),
    canvasScale,
  };
}

function composeSigilWithCoverage(
  intention: IntentionResult,
  seed: number,
  variantKey: string,
  candidateCap: number,
  spineIndex: number,
): SigilComposition {
  return composeSigil(intention, {
    seed,
    variantKey,
    candidateCap,
    requireAllStrokesExact: true,
    spineIndex,
  });
}

function composeSpineAttempt(
  intention: IntentionResult,
  seed: number,
  spineIndex: number,
): SigilComposition {
  const variantKey = 'size-spine';
  const large = intention.letters.length > 12;
  let lastError: unknown = null;

  if (large) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const attemptSeed = (seed + attempt * RETRY_STRIDE) >>> 0;
      try {
        return composeSigilWithCoverage(
          intention,
          attemptSeed,
          variantKey,
          LARGE_CANDIDATE_CAP,
          spineIndex,
        );
      } catch (error) {
        lastError = error;
      }
    }
  }
  try {
    return composeSigil(intention, { seed, variantKey, spineIndex });
  } catch (error) {
    lastError = error;
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const attemptSeed = (seed + attempt * RETRY_STRIDE) >>> 0;
    try {
      return composeSigilWithCoverage(
        intention,
        attemptSeed,
        variantKey,
        MAX_CANDIDATES_PER_LETTER,
        spineIndex,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to compose size-spine');
}

export interface VariantCompositionFailure {
  readonly slot: number;
  readonly spineIndex: number;
  readonly error: string;
}

export interface VariantCompositionResult {
  readonly compositions: SigilComposition[];
  readonly failures: readonly VariantCompositionFailure[];
  readonly partial: boolean;
  readonly requestedCount: number;
}

export function composeSigilVariantsWithDiagnostics(
  intention: IntentionResult,
  regeneration = 0,
): VariantCompositionResult {
  const count = intention.letters.length;
  if (count === 0) {
    return {
      compositions: [],
      failures: [],
      partial: false,
      requestedCount: 0,
    };
  }
  const seeds = variantSeeds(intention.letters, regeneration);
  const spines = variantSpineIndices(count);
  const requireDistinct = count >= 3;
  const used = new Set<number>();
  const compositions: SigilComposition[] = [];
  const failures: VariantCompositionFailure[] = [];

  for (let slot = 0; slot < seeds.length; slot += 1) {
    const requested = spines[slot] ?? 0;
    const order: number[] = [];
    if (requireDistinct) {
      if (!used.has(requested)) {
        order.push(requested);
      }
      for (let spine = 0; spine < count; spine += 1) {
        if (!used.has(spine) && !order.includes(spine)) {
          order.push(spine);
        }
      }
    } else {
      order.push(requested);
      for (let spine = 0; spine < count; spine += 1) {
        if (!order.includes(spine)) {
          order.push(spine);
        }
      }
    }

    if (order.length === 0) {
      failures.push({
        slot,
        spineIndex: requested,
        error: `no unused spine remains for arrangement ${slot + 1}`,
      });
      continue;
    }

    let composed: SigilComposition | null = null;
    for (const spineIndex of order) {
      try {
        composed = composeSpineAttempt(intention, seeds[slot]!, spineIndex);
        break;
      } catch (error) {
        failures.push({
          slot,
          spineIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (composed) {
      compositions.push(composed);
      used.add(composed.spineSurvivingIndex ?? requested);
    }
  }

  const partial = compositions.length < seeds.length;
  return {
    compositions,
    failures,
    partial,
    requestedCount: seeds.length,
  };
}

export function composeSigilVariants(
  intention: IntentionResult,
  regeneration = 0,
): SigilComposition[] {
  const result = composeSigilVariantsWithDiagnostics(intention, regeneration);
  if (result.requestedCount === 0) {
    return [];
  }
  if (result.compositions.length > 0) {
    return result.compositions;
  }
  const details = result.failures
    .map((failure) => `spine ${failure.spineIndex}: ${failure.error}`)
    .join('; ');
  throw new AggregateError(
    result.failures.map((failure) => new Error(failure.error)),
    details.length > 0
      ? `Unable to compose any arrangement after every spine failed (${details})`
      : 'Unable to compose any arrangement',
  );
}
