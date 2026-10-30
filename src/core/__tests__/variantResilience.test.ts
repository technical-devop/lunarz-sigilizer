import { beforeEach, describe, expect, it, vi } from 'vitest';

const blockedSpines = vi.hoisted(() => new Set<number>());
const blockedSeeds = vi.hoisted(() => new Set<string>());

vi.mock('../sizeHierarchy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sizeHierarchy')>();
  return {
    ...actual,
    generateSizeSigil: (
      source: string,
      variantKey: string,
      options?: Parameters<typeof actual.generateSizeSigil>[2],
    ) => {
      if (blockedSpines.has(options?.spineIndex ?? 0)) {
        throw new Error(`blocked spine ${options?.spineIndex ?? 0} for regression`);
      }
      if (blockedSeeds.has(String(options?.seed ?? ''))) {
        throw new Error(`blocked seed ${String(options?.seed ?? '')} for regression`);
      }
      return actual.generateSizeSigil(source, variantKey, options);
    },
  };
});

import {
  composeSigilVariants,
  composeSigilVariantsWithDiagnostics,
  variantSeeds,
} from '../compose';
import { processIntention } from '../intention';

const RETRY_STRIDE = 224_737;

beforeEach(() => {
  blockedSpines.clear();
  blockedSeeds.clear();
});

describe('variant spine distinctness and failure isolation', () => {
  it('returns three distinct spines for 3+ letters when every spine is feasible', () => {
    for (const phrase of ['BCD', 'I MAKE TIME TO CREATE', 'I BUILD RESILIENT STRENGTH']) {
      const intention = processIntention(phrase);
      const result = composeSigilVariantsWithDiagnostics(intention, 0);
      const spines = result.compositions.map(
        (composition) => composition.spineSurvivingIndex,
      );

      expect(result.compositions).toHaveLength(3);
      expect(result.partial).toBe(false);
      expect(result.failures).toEqual([]);
      expect(spines).toEqual([0, 1, 2]);
      expect(new Set(spines).size).toBe(3);
      for (const composition of result.compositions) {
        expect(composition.letters.map((letter) => letter.letter)).toEqual(
          intention.letters,
        );
      }
    }
  }, 60000);

  it('returns three compositions for one and two letters without pretending distinct spines exist', () => {
    for (const [phrase, expectedSpines] of [
      ['B', [0, 0, 0]],
      ['BC', [0, 1, 0]],
    ] as const) {
      const result = composeSigilVariantsWithDiagnostics(processIntention(phrase), 0);
      const spines = result.compositions.map(
        (composition) => composition.spineSurvivingIndex,
      );

      expect(result.compositions).toHaveLength(3);
      expect(result.partial).toBe(false);
      expect(spines).toEqual(expectedSpines);
    }
  }, 30000);

  it('marks one- and two-letter batches partial when requested slots fail', () => {
    for (const phrase of ['B', 'BC']) {
      const intention = processIntention(phrase);
      const seeds = variantSeeds(intention.letters, 0);
      for (const seed of seeds.slice(1)) {
        for (let attempt = 0; attempt <= 8; attempt += 1) {
          blockedSeeds.add(String(BigInt((seed + attempt * RETRY_STRIDE) >>> 0)));
        }
      }

      const result = composeSigilVariantsWithDiagnostics(intention, 0);

      expect(result.compositions).toHaveLength(1);
      expect(result.partial).toBe(true);
      expect(result.failures.length).toBeGreaterThan(0);
      blockedSeeds.clear();
    }
  }, 60000);

  it('finds three distinct unused spines when the first requested spine fails', () => {
    blockedSpines.add(0);
    const intention = processIntention('I MAKE TIME TO CREATE');
    const result = composeSigilVariantsWithDiagnostics(intention, 0);
    const spines = result.compositions.map(
      (composition) => composition.spineSurvivingIndex,
    );

    expect(result.compositions).toHaveLength(3);
    expect(spines).toEqual([1, 2, 3]);
    expect(new Set(spines).size).toBe(3);
    expect(result.partial).toBe(false);
    expect(result.failures.map((failure) => failure.spineIndex)).toContain(0);
    for (const composition of result.compositions) {
      expect(composition.letters.map((letter) => letter.letter)).toEqual(
        intention.letters,
      );
    }
  }, 30000);

  it('returns only the feasible distinct spines and marks the set partial', () => {
    blockedSpines.add(0);
    const result = composeSigilVariantsWithDiagnostics(processIntention('BCD'), 0);
    const spines = result.compositions.map(
      (composition) => composition.spineSurvivingIndex,
    );

    expect(spines).toEqual([1, 2]);
    expect(new Set(spines).size).toBe(2);
    expect(result.partial).toBe(true);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.map((failure) => failure.spineIndex)).toContain(0);
  }, 30000);

  it('surfaces a descriptive error instead of swallowing every failed spine', () => {
    blockedSpines.add(0);
    blockedSpines.add(1);
    blockedSpines.add(2);
    const intention = processIntention('BCD');
    const result = composeSigilVariantsWithDiagnostics(intention, 0);

    expect(result.compositions).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
    expect(() => composeSigilVariants(intention, 0)).toThrow(
      /could not compose|spine|arrangement/i,
    );
  }, 30000);
});
