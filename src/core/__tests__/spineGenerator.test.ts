import { describe, expect, it } from 'vitest';

import { stableSeed } from '../geometry';
import { getGlyph } from '../glyphs';
import { generateSizeSigil } from '../sizeHierarchy';

const SEED_DOMAIN = 'size-hierarchy-v1';

const APPROVED = [
  { id: 'calm', phrase: 'BE CALM', source: 'BCLM' },
  { id: 'make', phrase: 'I MAKE TIME TO CREATE', source: 'MKTCR' },
  { id: 'protect', phrase: 'I PROTECT MY SPACE', source: 'PRTCMYS' },
  { id: 'build', phrase: 'I BUILD RESILIENT STRENGTH', source: 'BLDRSNTGH' },
] as const;

describe('size_hierarchy.py port', () => {
  it('reproduces the approved calm spine-dominant reference exactly', () => {
    const seed = 14759392546341412399n;
    const result = generateSizeSigil('BE CALM', 'size-spine', {
      seed,
      sigilId: 'calm-size-spine',
    });

    expect(result.source).toBe('BCLM');
    expect(result.schema).toBe('lunarz-size-hierarchy-sigil/1');
    expect(result.seed).toBe(seed.toString());
    expect(result.metrics.per_letter_scales).toEqual([1.22, 0.705, 0.69, 0.675]);
    expect(result.metrics.spine_letter).toBe(0);
    expect(result.metrics.spine_scale).toBe(1.22);
    expect(result.metrics.spine_joins).toBe(3);
    expect(result.metrics.scale_min).toBe(0.675);
    expect(result.metrics.scale_max).toBe(1.22);
    expect(result.metrics.scale_ratio).toBeCloseTo(1.807407407, 9);
    expect(result.metrics.shared_strokes).toBe(9);
    expect(result.metrics.shared_overlap_total).toBeCloseTo(3.148196448, 9);
    expect(result.attachments.map((attachment: any) => attachment.to_letter)).toEqual([
      0, 0, 0,
    ]);
    expect(
      result.attachments.map(
        (attachment: any) => attachment.actual_contact.shared_length,
      ),
    ).toEqual([0.199404112, 0.5612, 0.37166]);
    expect(
      result.attachments.map((attachment: any) => attachment.candidate_score),
    ).toEqual([16.161758008, 16.347921347, 19.319311613]);
    expect(result.letters[0].transform).toEqual({
      angle_deg: 0,
      scale: 1.22,
      tx: -0.6222,
      ty: -0.61,
    });
    expect(result.exact_check.exact_stroke_components).toBe(1);
    expect(result.exact_check.exact_letter_components).toBe(1);
    expect(result.exact_check.near_only_dependency).toBe(false);
  });

  it('reproduces every approved sample across all three scale recipes', () => {
    const results: any[] = [];
    for (const sample of APPROVED) {
      for (const variant of ['size-spine', 'size-steps', 'size-anchor']) {
        const seed = stableSeed(sample.id, variant, SEED_DOMAIN);
        const result = generateSizeSigil(sample.phrase, variant, { seed });
        results.push(result);

        expect(result.source).toBe(sample.source);
        expect(result.variant).toBe(variant);
        expect(result.letters).toHaveLength(sample.source.length);
        expect(result.attachments).toHaveLength(sample.source.length - 1);
        expect(result.exact_check.exact_stroke_components).toBe(1);
        expect(result.exact_check.exact_letter_components).toBe(1);
        expect(result.exact_check.near_only_dependency).toBe(false);
        expect(result.metrics.fallback_count).toBe(0);
        expect(result.metrics.attachment_mode_counts).toEqual({
          shared: sample.source.length - 1,
        });

        for (const attachment of result.attachments) {
          expect(attachment.mode).toBe('shared');
          expect(attachment.exact).toBe(true);
          expect(attachment.actual_contact.kind).toBe('shared');
          expect(attachment.actual_contact.shared_length + 1e-9).toBeGreaterThanOrEqual(
            0.075,
          );
          expect(attachment.candidate_score).toBeGreaterThan(0);
        }
        for (const letter of result.letters) {
          expect(letter.local_strokes).toEqual(
            getGlyph(letter.char)!.strokes.map((stroke, index) => ({
              index,
              closed: stroke.closed,
              points: stroke.points.map((point) => point.asList()),
            })),
          );
        }
      }
    }

    expect(results).toHaveLength(12);
  }, 60000);

  it('uses genuinely different per-letter scale hierarchies', () => {
    const seed = 42n;
    const spine = generateSizeSigil('MKTCR', 'size-spine', { seed });
    const steps = generateSizeSigil('MKTCR', 'size-steps', { seed });
    const anchor = generateSizeSigil('MKTCR', 'size-anchor', { seed });

    expect(spine.metrics.per_letter_scales).toEqual([1.22, 0.705, 0.69, 0.675, 0.66]);
    expect(steps.metrics.per_letter_scales).toEqual([1.22, 1.06, 0.9, 0.74, 0.58]);
    expect(anchor.metrics.per_letter_scales).toEqual([1.12, 0.7, 0.68, 0.66, 0.92]);
    expect(
      new Set([
        JSON.stringify(spine.metrics.per_letter_scales),
        JSON.stringify(steps.metrics.per_letter_scales),
        JSON.stringify(anchor.metrics.per_letter_scales),
      ]).size,
    ).toBe(3);
  });

  it('handles the 11-letter reference example and Q-bearing sources without near-only joins', () => {
    const eleven = generateSizeSigil(
      'I BUILD RESILIENT STRENGTH WITH CARE',
      'size-spine',
      { seed: stableSeed('eleven', 'size-spine', SEED_DOMAIN) },
    );
    expect(eleven.source).toBe('BLDRSNTGHWC');
    expect(eleven.letters).toHaveLength(11);
    expect(eleven.attachments).toHaveLength(10);
    expect(eleven.metrics.fallback_count).toBe(0);

    for (const [phrase, seed] of [
      ['quiet night', 817072757n],
      ['quiet mind', 4133800725n],
      ['query', 1959199689n],
    ] as const) {
      const result = generateSizeSigil(phrase, 'size-spine', { seed });
      expect(result.exact_check.exact_stroke_components).toBe(1);
      expect(result.exact_check.exact_letter_components).toBe(1);
      expect(result.exact_check.near_only_dependency).toBe(false);
    }
  }, 30000);

  it('is deterministic for an explicit seed', () => {
    const first = generateSizeSigil('I PROTECT MY SPACE', 'size-anchor', {
      seed: 99n,
    });
    const second = generateSizeSigil('I PROTECT MY SPACE', 'size-anchor', {
      seed: 99n,
    });

    expect(second).toEqual(first);
  });

  it('rejects empty, too-long and unsupported sources', () => {
    expect(() => generateSizeSigil('AEIOU', 'size-spine', { seed: 1n })).toThrow(
      /reduces to empty/,
    );
    expect(generateSizeSigil('B1C', 'size-spine', { seed: 1n }).source).toBe('BC');
  });
});

interface PythonLetter {
  readonly char: string;
  readonly transform: {
    readonly angle_deg: number;
    readonly scale: number;
    readonly tx: number;
    readonly ty: number;
  };
}

interface PythonAttachment {
  readonly from: number;
  readonly to: number;
  readonly score: number;
  readonly sharedLength: number;
}

const PYTHON_REORDERED_CASES: readonly {
  readonly source: string;
  readonly spine: number;
  readonly seed: bigint;
  readonly letters: readonly PythonLetter[];
  readonly attachments: readonly PythonAttachment[];
}[] = [
  {
    source: 'BCLM',
    spine: 0,
    seed: 42n,
    letters: [
      { char: 'B', transform: { angle_deg: 0, scale: 1.22, tx: -0.6222, ty: -0.61 } },
      { char: 'C', transform: { angle_deg: -45, scale: 0.705, tx: -0.559239926, ty: -0.38004658 } },
      { char: 'L', transform: { angle_deg: -90, scale: 0.69, tx: -0.4548, ty: 0.0632 } },
      { char: 'M', transform: { angle_deg: 270, scale: 0.675, tx: -0.23502, ty: 0.02 } },
    ],
    attachments: [
      { from: 1, to: 0, score: 16.161758746, sharedLength: 0.199404112 },
      { from: 2, to: 0, score: 14.810129112, sharedLength: 0.5856 },
      { from: 3, to: 0, score: 17.971252789, sharedLength: 0.39362 },
    ],
  },
  {
    source: 'BCLM',
    spine: 1,
    seed: 42n,
    letters: [
      { char: 'C', transform: { angle_deg: 0, scale: 1.22, tx: -0.61, ty: -0.61 } },
      { char: 'B', transform: { angle_deg: -45, scale: 0.705, tx: -0.775198841, ty: -0.454260411 } },
      { char: 'L', transform: { angle_deg: -135, scale: 0.69, tx: -0.497624074, ty: -0.107530601 } },
      { char: 'M', transform: { angle_deg: -103.495733281, scale: 0.675, tx: -0.38879484, ty: -0.294338579 } },
    ],
    attachments: [
      { from: 0, to: 1, score: 14.674688997, sharedLength: 0.272869071 },
      { from: 2, to: 0, score: 15.120084675, sharedLength: 0.3384 },
      { from: 3, to: 2, score: 14.090527192, sharedLength: 0.438625396 },
    ],
  },
  {
    source: 'BCLM',
    spine: 2,
    seed: 99n,
    letters: [
      { char: 'L', transform: { angle_deg: 0, scale: 1.22, tx: -0.61, ty: -0.61 } },
      { char: 'B', transform: { angle_deg: 90, scale: 0.705, tx: -0.07315, ty: -0.5645 } },
      { char: 'C', transform: { angle_deg: 45, scale: 0.69, tx: -0.078141645, ty: -0.759920268 } },
      { char: 'M', transform: { angle_deg: 31.504266719, scale: 0.675, tx: -0.459460701, ty: -0.420792923 } },
    ],
    attachments: [
      { from: 0, to: 2, score: 13.808889923, sharedLength: 0.3384 },
      { from: 1, to: 0, score: 16.401476478, sharedLength: 0.178232736 },
      { from: 3, to: 0, score: 18.461274225, sharedLength: 0.265165396 },
    ],
  },
];

describe('reordered input parity with size_hierarchy.py', () => {
  it('matches the Python prototype when each choice spine is moved to the front', () => {
    for (const testCase of PYTHON_REORDERED_CASES) {
      const result = generateSizeSigil(testCase.source, 'size-spine', {
        seed: testCase.seed,
        spineIndex: testCase.spine,
      });

      expect(result.source).toBe(testCase.source);
      expect(result.variant).toBe('size-spine');
      expect(result.metrics.spine_letter).toBe(testCase.spine);
      expect(result.metrics.spine_scale).toBe(1.22);
      expect(result.letters.map((letter: any) => letter.index)).toEqual(
        testCase.source.split('').map((_, index) => index),
      );
      expect(result.letters.map((letter: any) => letter.char)).toEqual(
        testCase.source.split(''),
      );

      for (const expected of testCase.letters) {
        const actual = result.letters.find(
          (letter: any) => letter.char === expected.char,
        );
        expect(actual).toBeDefined();
        expect(actual.transform.angle_deg).toBeCloseTo(
          expected.transform.angle_deg,
          9,
        );
        expect(actual.transform.scale).toBeCloseTo(expected.transform.scale, 9);
        expect(actual.transform.tx).toBeCloseTo(expected.transform.tx, 9);
        expect(actual.transform.ty).toBeCloseTo(expected.transform.ty, 9);
      }

      for (const expected of testCase.attachments) {
        const actual = result.attachments.find(
          (attachment: any) =>
            Number(attachment.from_letter) === expected.from &&
            Number(attachment.to_letter) === expected.to,
        );
        expect(actual).toBeDefined();
        expect(actual.candidate_score).toBeCloseTo(expected.score, 9);
        expect(actual.actual_contact.shared_length).toBeCloseTo(
          expected.sharedLength,
          9,
        );
      }
      expect(result.exact_check.exact_stroke_components).toBe(1);
      expect(result.exact_check.exact_letter_components).toBe(1);
      expect(result.exact_check.near_only_dependency).toBe(false);
    }
  }, 30000);

  it('keeps verified precision deviations at zero against the Python values', () => {
    let maxDeviation = 0;
    for (const testCase of PYTHON_REORDERED_CASES) {
      const result = generateSizeSigil(testCase.source, 'size-spine', {
        seed: testCase.seed,
        spineIndex: testCase.spine,
      });
      for (const expected of testCase.letters) {
        const actual = result.letters.find(
          (letter: any) => letter.char === expected.char,
        )!;
        maxDeviation = Math.max(
          maxDeviation,
          Math.abs(actual.transform.angle_deg - expected.transform.angle_deg),
          Math.abs(actual.transform.scale - expected.transform.scale),
          Math.abs(actual.transform.tx - expected.transform.tx),
          Math.abs(actual.transform.ty - expected.transform.ty),
        );
      }
      for (const expected of testCase.attachments) {
        const actual = result.attachments.find(
          (attachment: any) =>
            Number(attachment.from_letter) === expected.from &&
            Number(attachment.to_letter) === expected.to,
        )!;
        maxDeviation = Math.max(
          maxDeviation,
          Math.abs(actual.candidate_score - expected.score),
          Math.abs(actual.actual_contact.shared_length - expected.sharedLength),
        );
      }
    }
    expect(maxDeviation).toBeLessThanOrEqual(1e-9);
  }, 30000);
});
