import { describe, expect, it } from 'vitest';

import {
  composeSigil,
  composeSigilVariants,
  type CompositionLetter,
  type SigilComposition,
} from '../compose';
import {
  Segment,
  Transform,
  collinearOverlap,
  type SegmentRef,
} from '../geometry';
import { getGlyph } from '../glyphs';
import { processIntention } from '../intention';
import { compositionToExportSvg, letterTransformToSvg, SIGIL_STROKE } from '../svg';

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

function worldSegment(letter: CompositionLetter, reference: SegmentRef): Segment {
  const glyph = getGlyph(letter.glyphId)!;
  const stroke = glyph.strokes[reference.strokeIndex]!;
  const segment = stroke.segments()[reference.segmentIndex]!;
  const transform = new Transform(
    letter.transform.angle,
    letter.transform.scale,
    letter.transform.tx,
    letter.transform.ty,
  );
  return new Segment(
    transform.apply(segment.p0),
    transform.apply(segment.p1),
    letter.letter,
    reference.segmentIndex,
  );
}

function assertExactConnections(composition: SigilComposition): void {
  expect(composition.connections).toHaveLength(composition.letters.length - 1);
  for (const connection of composition.connections) {
    expect(connection.mode).toBe('shared');
    expect(connection.kind).toBe('shared');
    const from = worldSegment(
      composition.letters[connection.fromSurvivingIndex]!,
      connection.fromSegment,
    );
    const to = worldSegment(
      composition.letters[connection.toSurvivingIndex]!,
      connection.toSegment,
    );
    const overlap = collinearOverlap(from, to, 0.032, 0.075);
    expect(overlap, `${connection.fromLetter}->${connection.toLetter}`).not.toBeNull();
    expect(overlap![2]).toBeGreaterThan(0.075);
  }
}

describe('rendered prototype geometry', () => {
  it('renders the exact connected paths and matrix transforms used by composition', () => {
    const compositions = [
      ...composeSigilVariants(processIntention('BE CALM'), 0),
      ...composeSigilVariants(processIntention('I BUILD RESILIENT'), 0),
    ];

    for (const composition of compositions) {
      const svg = compositionToExportSvg(composition);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();

      const paths = Array.from(doc.querySelectorAll('path'));
      expect(paths).toHaveLength(composition.letters.length);

      paths.forEach((path, index) => {
        const letter = composition.letters[index]!;
        expect(path.getAttribute('d')).toBe(letter.renderPath);
        expect(path.getAttribute('transform')).toBe(
          letterTransformToSvg(letter.transform),
        );
        expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
        expect(path.getAttribute('fill')).toBe('none');
      });

      assertExactConnections(composition);
    }
  });

  it('keeps 2, 11 and 21 letter sigils exactly joined after SVG serialization', () => {
    for (const count of [2, 11]) {
      const composition = composeSigilVariants(
        processIntention(CONSONANTS.slice(0, count)),
        0,
      )[0]!;
      assertExactConnections(composition);
      expect(compositionToExportSvg(composition)).not.toMatch(
        /data-(letter|source-index|surviving-index|seed)|provenance|overlap_length/i,
      );
    }

    const large = composeSigil(processIntention(CONSONANTS), {
      seed: 0,
      variantKey: 'size-spine',
      candidateCap: 80,
      requireAllStrokesExact: true,
    });
    expect(large.letters).toHaveLength(21);
    assertExactConnections(large);
  }, 60000);

  it('bridges the prototype Q tail intrinsic near-contact without moving glyph coordinates', () => {
    const composition = composeSigil(processIntention('quiet night'), {
      seed: 817072757,
      variantKey: 'size-spine',
    });

    expect(composition.letters.map((letter) => letter.letter)).toEqual([
      'Q',
      'T',
      'N',
      'G',
      'H',
    ]);
    expect(composition.connections).toHaveLength(4);
    assertExactConnections(composition);
  });

  it('keeps exports free of source, seed and provenance metadata', () => {
    const composition = composeSigil(processIntention('LUNARZ'), {
      seed: 99,
    });
    const svg = compositionToExportSvg(composition);
    const lower = svg.toLowerCase();

    for (const token of [
      'data-letter',
      'data-source-index',
      'data-surviving-index',
      'data-seed',
      'provenance',
      'connection',
      'overlap',
      'slide',
      'segmentindex',
      'spine',
      'sourceindex',
      'survivingindex',
    ]) {
      expect(lower).not.toContain(token);
    }
    expect(svg.match(/<path /g)).toHaveLength(composition.letters.length);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('https://');
    expect(svg.match(/http:\/\/(?!www\.w3\.org)/)).toBeNull();
  });
});
