import { describe, expect, it } from 'vitest';

import {
  composeSigil,
  createSeededRandom,
  seedFromLetters,
  SIGIL_HEIGHT,
  SIGIL_WIDTH,
  type CompositionLetter,
} from '../compose';
import { GLYPH_BOX_SIZE, GLYPHS } from '../glyphs';
import { processIntention } from '../intention';

const CENTER_X = SIGIL_WIDTH / 2;
const CENTER_Y = SIGIL_HEIGHT / 2;
const CONSONANT_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ';
const VARIANT_STRIDE = 0x9e3779b9;

function glyphReach(letter: CompositionLetter): number {
  return (GLYPH_BOX_SIZE / 2) * letter.transform.scale;
}

function centerDistance(left: CompositionLetter, right: CompositionLetter): number {
  return Math.hypot(
    left.transform.x - right.transform.x,
    left.transform.y - right.transform.y,
  );
}

function centerOffset(letter: CompositionLetter): number {
  return Math.hypot(letter.transform.x - CENTER_X, letter.transform.y - CENTER_Y);
}

function weightedCenter(letters: readonly CompositionLetter[]): { x: number; y: number } {
  let weightTotal = 0;
  let x = 0;
  let y = 0;

  for (const letter of letters) {
    const weight = letter.transform.scale * letter.transform.scale;
    weightTotal += weight;
    x += letter.transform.x * weight;
    y += letter.transform.y * weight;
  }

  return { x: x / weightTotal, y: y / weightTotal };
}

function averageScale(letters: readonly CompositionLetter[]): number {
  return (
    letters.reduce((sum, letter) => sum + letter.transform.scale, 0) / letters.length
  );
}

function isSingleOverlapCluster(letters: readonly CompositionLetter[], ratio = 0.9): boolean {
  const count = letters.length;
  if (count <= 1) {
    return true;
  }

  const visited = new Set<number>([0]);
  const stack = [0];

  while (stack.length > 0) {
    const current = stack.pop()!;

    for (let other = 0; other < count; other += 1) {
      if (visited.has(other)) {
        continue;
      }

      const left = letters[current]!;
      const right = letters[other]!;
      const limit = (glyphReach(left) + glyphReach(right)) * ratio;

      if (centerDistance(left, right) <= limit) {
        visited.add(other);
        stack.push(other);
      }
    }
  }

  return visited.size === count;
}

function markExtent(letters: readonly CompositionLetter[]): number {
  let extent = 0;

  for (const letter of letters) {
    const radians = (letter.transform.rotation * Math.PI) / 180;
    const rotatedHalf =
      glyphReach(letter) * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
    extent = Math.max(
      extent,
      Math.hypot(letter.transform.x - CENTER_X, letter.transform.y - CENTER_Y) + rotatedHalf,
    );
  }

  return extent;
}

function nearestCenterDistance(letters: readonly CompositionLetter[]): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (let left = 0; left < letters.length; left += 1) {
    for (let right = left + 1; right < letters.length; right += 1) {
      nearest = Math.min(nearest, centerDistance(letters[left]!, letters[right]!));
    }
  }

  return nearest;
}

function normalizedSignature(
  letters: readonly CompositionLetter[],
  referenceScale: number,
): readonly { x: number; y: number; rotation: number; scale: number }[] {
  const center = weightedCenter(letters);
  const unit = GLYPH_BOX_SIZE * referenceScale;

  return letters.map((letter) => ({
    x: (letter.transform.x - center.x) / unit,
    y: (letter.transform.y - center.y) / unit,
    rotation: (letter.transform.rotation * Math.PI) / 180,
    scale: letter.transform.scale / referenceScale,
  }));
}

function layoutDistance(
  left: readonly CompositionLetter[],
  right: readonly CompositionLetter[],
): number {
  const referenceScale = (averageScale(left) + averageScale(right)) / 2;
  const leftSignature = normalizedSignature(left, referenceScale);
  const rightSignature = normalizedSignature(right, referenceScale);
  let total = 0;

  for (let index = 0; index < leftSignature.length; index += 1) {
    const a = leftSignature[index]!;
    const b = rightSignature[index]!;
    const turn = Math.atan2(Math.sin(a.rotation - b.rotation), Math.cos(a.rotation - b.rotation));
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const ds = a.scale - b.scale;
    total += dx * dx + dy * dy + turn * turn + ds * ds;
  }

  return Math.sqrt(total / leftSignature.length);
}

function variantSeeds(letters: readonly string[], regeneration = 0): number[] {
  const base = seedFromLetters(letters);
  return [0, 1, 2].map(
    (slot) => (base + regeneration * 7919 + slot * VARIANT_STRIDE) >>> 0,
  );
}

describe('composeSigil', () => {
  it('composes every surviving letter once, in order, with source and glyph metadata', () => {
    const intention = processIntention('LUNARZ SIGILIZER 42!');
    const composition = composeSigil(intention, { seed: 12345 });

    expect(composition.letters.map((letter) => letter.letter)).toEqual(['L', 'N', 'R', 'Z', 'S', 'G']);
    expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual([0, 2, 4, 5, 7, 9]);
    expect(composition.letters.map((letter) => letter.survivingIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(composition.isEmpty).toBe(false);

    composition.letters.forEach((letter, index) => {
      expect(letter.glyphId).toBe(letter.letter);
      expect(letter.path).toBe(GLYPHS[letter.letter]!.paths.join(' '));
      expect(letter.survivingIndex).toBe(index);
      expect(Number.isFinite(letter.transform.x)).toBe(true);
      expect(Number.isFinite(letter.transform.y)).toBe(true);
      expect(Number.isFinite(letter.transform.rotation)).toBe(true);
      expect(letter.transform.scale).toBeGreaterThanOrEqual(0.5);
      expect(letter.transform.scale).toBeLessThanOrEqual(0.82);
    });
  });

  it('regenerates identical metadata for the same seed', () => {
    const intention = processIntention('SIGIL');
    const first = composeSigil(intention, { seed: 777 });
    const second = composeSigil(intention, { seed: 777 });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('produces visually distinct transform sets for different seeds and the same letters', () => {
    const intention = processIntention('SIGIL');
    const compositions = [1, 2, 3, 4, 5].map((seed) => composeSigil(intention, { seed }));

    for (const composition of compositions) {
      expect(composition.letters.map((letter) => letter.letter)).toEqual(['S', 'G', 'L']);
    }

    const signatures = new Set(
      compositions.map((composition) => JSON.stringify(composition.letters.map((letter) => letter.transform))),
    );
    expect(signatures.size).toBe(compositions.length);
  });

  it('assigns a distinct transform to each letter within a composition', () => {
    const composition = composeSigil(processIntention('BCDFGHJK'), { seed: 2026 });
    const transforms = composition.letters.map((letter) => JSON.stringify(letter.transform));

    expect(new Set(transforms).size).toBe(composition.letters.length);
  });

  it('centers a single surviving letter deterministically', () => {
    const first = composeSigil(processIntention('K'), { seed: 5 });
    const second = composeSigil(processIntention('K'), { seed: 5 });

    expect(first.letters).toHaveLength(1);
    expect(first.letters[0]?.transform.x).toBe(SIGIL_WIDTH / 2);
    expect(first.letters[0]?.transform.y).toBe(SIGIL_HEIGHT / 2);
    expect(second.letters[0]?.transform).toEqual(first.letters[0]?.transform);
  });

  it('derives a stable seed from surviving letters when no seed is supplied', () => {
    const fromMixedCase = composeSigil(processIntention('Sigil'));
    const fromConsonants = composeSigil(processIntention('sgl'));

    expect(fromMixedCase.seed).toBe(seedFromLetters(['S', 'G', 'L']));
    expect(fromConsonants.seed).toBe(fromMixedCase.seed);
    expect(fromConsonants.letters.map((letter) => letter.transform)).toEqual(
      fromMixedCase.letters.map((letter) => letter.transform),
    );
  });

  it('never includes vowels or unsupported characters in a composition', () => {
    const composition = composeSigil(processIntention('B!A?C😀D'), { seed: 3 });

    expect(composition.letters.map((letter) => letter.letter)).toEqual(['B', 'C', 'D']);
  });

  it('returns an explicit empty composition when no letters survive', () => {
    for (const input of ['', 'AEIOU', '!!!', '你好']) {
      const composition = composeSigil(processIntention(input), { seed: 1 });

      expect(composition.isEmpty).toBe(true);
      expect(composition.letters).toEqual([]);
      expect(composition.width).toBe(SIGIL_WIDTH);
      expect(composition.height).toBe(SIGIL_HEIGHT);
    }
  });

  it('normalizes seeds to unsigned 32-bit integers and rejects non-finite values', () => {
    const intention = processIntention('K');

    expect(composeSigil(intention, { seed: -1 }).seed).toBe(0xffffffff);
    expect(composeSigil(intention, { seed: 0x100000000 }).seed).toBe(0);
    expect(() => composeSigil(intention, { seed: Number.NaN })).toThrow(RangeError);
    expect(() => composeSigil(intention, { seed: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe('cohesive sigil geometry', () => {
  it('gathers every surviving letter into a compact central field', () => {
    const phrases = ['MKTRC', 'LUNARZ SIGILIZER 42!', 'steady light', CONSONANT_ALPHABET];

    for (const phrase of phrases) {
      const intention = processIntention(phrase);

      for (const seed of [0, 1, 2, 12345, 0xdeadbeef]) {
        const composition = composeSigil(intention, { seed });

        expect(composition.letters).toHaveLength(intention.letters.length);

        for (const letter of composition.letters) {
          expect(centerOffset(letter)).toBeLessThanOrEqual(SIGIL_WIDTH * 0.2);
        }

        expect(markExtent(composition.letters)).toBeLessThanOrEqual(SIGIL_WIDTH * 0.3);
      }
    }
  });

  it('interlocks glyphs into one connected overlap cluster for 1 to 21 letters', () => {
    for (let count = 1; count <= CONSONANT_ALPHABET.length; count += 1) {
      const phrase = CONSONANT_ALPHABET.slice(0, count);

      for (const seed of [0, 1, 2]) {
        const composition = composeSigil(processIntention(phrase), { seed });

        expect(composition.letters).toHaveLength(count);
        expect(isSingleOverlapCluster(composition.letters)).toBe(true);
      }
    }
  });

  it('balances the mark around the canvas center for every letter count', () => {
    for (let count = 1; count <= CONSONANT_ALPHABET.length; count += 1) {
      const phrase = CONSONANT_ALPHABET.slice(0, count);

      for (const seed of [0, 1, 2, 777]) {
        const composition = composeSigil(processIntention(phrase), { seed });
        const center = weightedCenter(composition.letters);

        expect(Math.hypot(center.x - CENTER_X, center.y - CENTER_Y)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('keeps the stable 512 canvas and clears the outer margin at every scale', () => {
    for (let count = 1; count <= CONSONANT_ALPHABET.length; count += 1) {
      const composition = composeSigil(processIntention(CONSONANT_ALPHABET.slice(0, count)), {
        seed: count * 7919,
      });

      expect(composition.width).toBe(SIGIL_WIDTH);
      expect(composition.height).toBe(SIGIL_HEIGHT);
      expect(markExtent(composition.letters)).toBeLessThanOrEqual(SIGIL_WIDTH / 2 - 24);
    }
  });

  it('scales glyphs down and keeps center spacing as the alphabet grows', () => {
    const small = composeSigil(processIntention(CONSONANT_ALPHABET.slice(0, 4)), { seed: 5 });
    const medium = composeSigil(processIntention(CONSONANT_ALPHABET.slice(0, 10)), { seed: 5 });
    const large = composeSigil(processIntention(CONSONANT_ALPHABET), { seed: 5 });

    const smallScale = averageScale(small.letters);
    const mediumScale = averageScale(medium.letters);
    const largeScale = averageScale(large.letters);

    expect(largeScale).toBeLessThan(mediumScale);
    expect(mediumScale).toBeLessThan(smallScale);
    expect(largeScale).toBeLessThan(smallScale * 0.7);

    for (let count = 2; count <= CONSONANT_ALPHABET.length; count += 1) {
      for (const seed of [0, 1, 2]) {
        const composition = composeSigil(processIntention(CONSONANT_ALPHABET.slice(0, count)), {
          seed,
        });
        const spacing = nearestCenterDistance(composition.letters);
        const glyphSize = GLYPH_BOX_SIZE * averageScale(composition.letters);

        expect(spacing / glyphSize).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('makes the three seeded alternatives materially distinct at every letter count', () => {
    for (let count = 1; count <= CONSONANT_ALPHABET.length; count += 1) {
      const intention = processIntention(CONSONANT_ALPHABET.slice(0, count));

      for (const regeneration of [0, 1]) {
        const seeds = variantSeeds(intention.letters, regeneration);
        const compositions = seeds.map((seed) => composeSigil(intention, { seed }));

        expect(new Set(seeds).size).toBe(3);

        for (const composition of compositions) {
          expect(composition.letters.map((letter) => letter.letter)).toEqual(intention.letters);
        }

        for (let left = 0; left < compositions.length; left += 1) {
          for (let right = left + 1; right < compositions.length; right += 1) {
            expect(
              layoutDistance(compositions[left]!.letters, compositions[right]!.letters),
            ).toBeGreaterThanOrEqual(0.2);
          }
        }
      }
    }
  });
});

describe('deterministic random source', () => {
  it('returns repeatable values in the unit interval', () => {
    const first = createSeededRandom(123);
    const second = createSeededRandom(123);
    const firstValues = Array.from({ length: 12 }, () => first());
    const secondValues = Array.from({ length: 12 }, () => second());

    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('returns a different sequence for a different seed', () => {
    const first = createSeededRandom(1);
    const second = createSeededRandom(2);

    expect(Array.from({ length: 8 }, () => first())).not.toEqual(Array.from({ length: 8 }, () => second()));
  });
});

describe('seedFromLetters', () => {
  it('is stable and stays in the unsigned 32-bit range', () => {
    const seed = seedFromLetters(['L', 'N', 'R', 'Z']);

    expect(seed).toBe(seedFromLetters(['L', 'N', 'R', 'Z']));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
