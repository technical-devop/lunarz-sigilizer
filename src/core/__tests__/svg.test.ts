import { describe, expect, it } from 'vitest';

import { composeSigil } from '../compose';
import { processIntention } from '../intention';
import {
  compositionToExportSvg,
  compositionToSvg,
  letterTransformToSvg,
  SIGIL_BACKGROUND,
  SIGIL_GLOW,
  SIGIL_STROKE,
  SIGIL_STROKE_WIDTH,
  strokeWidthForScale,
} from '../svg';

function parseMatrix(value: string): number[] {
  const match = value.match(/^matrix\(([^)]+)\)$/);
  expect(match).not.toBeNull();
  return match![1]!.trim().split(/\s+/).map(Number);
}

describe('compositionToSvg base scene', () => {
  it('renders one path per surviving letter with the shared prototype scene', () => {
    const composition = composeSigil(processIntention('LUNARZ'), { seed: 99 });
    const svg = compositionToSvg(composition);

    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg.match(/<path /g)).toHaveLength(composition.letters.length);
    expect(svg).toContain(letterTransformToSvg(composition.letters[0]!.transform));
  });

  it('shares the explicit preview stroke and night background', () => {
    const composition = composeSigil(processIntention('SIGIL'), { seed: 7 });
    const svg = compositionToExportSvg(composition);

    expect(svg).toContain(`stroke="${SIGIL_STROKE}"`);
    // Per-letter compensation keeps the *effective* rendered width at
    // SIGIL_STROKE_WIDTH (SVG scales stroke-width by the path transform).
    {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const pathEls = Array.from(doc.querySelectorAll('path'));
      expect(pathEls).toHaveLength(composition.letters.length);
      for (const [index, pathEl] of pathEls.entries()) {
        const letter = composition.letters[index]!;
        expect(Number(pathEl.getAttribute('stroke-width'))).toBeCloseTo(
          strokeWidthForScale(letter.transform.scale),
          9,
        );
      }
    }
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain(`stop-color="${SIGIL_GLOW}"`);
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
    expect(svg).toContain('fill="url(#sigil-night)"');
    expect(svg).toContain(
      `<rect x="0" y="0" width="${composition.width}" height="${composition.height}"`,
    );
  });

  it('regenerates identical SVG for identical input and seed', () => {
    const first = composeSigil(processIntention('SIGIL'), { seed: 404 });
    const second = composeSigil(processIntention('SIGIL'), { seed: 404 });

    expect(compositionToSvg(second)).toBe(compositionToSvg(first));
    expect(compositionToExportSvg(second)).toBe(compositionToExportSvg(first));
  });

  it('emits a valid empty SVG with background but no paths', () => {
    const svg = compositionToSvg(composeSigil(processIntention('AEIOU'), { seed: 1 }));

    expect(svg).toContain('<title>Lunarz Sigil</title>');
    expect(svg).not.toContain('<path ');
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('escapes caller-supplied stroke values instead of injecting markup', () => {
    const svg = compositionToSvg(composeSigil(processIntention('K'), { seed: 1 }), {
      stroke: '" onload="alert(1)',
    });

    expect(svg).toContain('&quot; onload=&quot;alert(1)');
    expect(svg).not.toContain('stroke="" onload="alert(1)"');
  });
});

describe('exported SVG carries no inspection or derivation metadata', () => {
  it('excludes source letters, indices, seeds, and intention text', () => {
    const intention = processIntention('QUIET NIGHT');
    const composition = composeSigil(intention, { seed: 99 });
    const svg = compositionToExportSvg(composition);

    expect(svg).not.toContain('data-letter');
    expect(svg).not.toContain('data-source-index');
    expect(svg).not.toContain('data-surviving-index');
    expect(svg).not.toContain('data-seed');
    expect(svg).not.toContain('QUIET');
    expect(svg).not.toContain('NIGHT');
    expect(svg).not.toContain('source-letter');
    expect(svg).not.toContain('surviving-index');
    expect(svg).not.toMatch(/data-seed|seed["=]/i);
    expect(svg).toContain('<title>Lunarz Sigil</title>');
    expect(svg).not.toContain('intention');
    expect(svg).not.toContain('derivation');
  });

  it('contains no remote assets or embedded images', () => {
    const svg = compositionToExportSvg(composeSigil(processIntention('REST'), { seed: 5 }));

    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('https://');
    expect(svg.match(/http:\/\/(?!www\.w3\.org)/)).toBeNull();
    expect(svg).not.toContain('href=');
    expect(svg).not.toContain('xlink');
  });

  it('keeps metadata only when explicitly requested for in-memory editor use', () => {
    const composition = composeSigil(processIntention('LUNARZ'), { seed: 99 });
    const withMetadata = compositionToSvg(composition, { includeMetadata: true });

    expect(withMetadata).toContain(`data-seed="${composition.seed}"`);
    expect(withMetadata).toContain('data-letter="L"');
    expect(withMetadata).toContain('data-source-index="0"');
    expect(withMetadata).toContain('data-surviving-index="0"');

    const clean = compositionToSvg(composition);
    expect(clean).not.toContain('data-seed');
    expect(clean).not.toContain('data-letter');
  });

  it('parses as SVG DOM with expected background, gradient, and path attributes', () => {
    const composition = composeSigil(processIntention('CALM'), { seed: 11 });
    const svg = compositionToExportSvg(composition);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');

    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName.toLowerCase()).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe(
      `0 0 ${composition.width} ${composition.height}`,
    );

    const gradient = doc.querySelector('radialGradient');
    expect(gradient).not.toBeNull();
    const stops = Array.from(doc.querySelectorAll('stop')).map((stop) =>
      stop.getAttribute('stop-color'),
    );
    expect(stops).toEqual([SIGIL_GLOW, SIGIL_BACKGROUND]);

    const rect = doc.querySelector('rect');
    expect(rect?.getAttribute('fill')).toMatch(/^url\(#/);
    expect(rect?.getAttribute('width')).toBe(String(composition.width));

    const paths = Array.from(doc.querySelectorAll('path'));
    expect(paths).toHaveLength(composition.letters.length);
    for (const [index, path] of paths.entries()) {
      expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
      const letter = composition.letters[index]!;
      expect(Number(path.getAttribute('stroke-width'))).toBeCloseTo(
        strokeWidthForScale(letter.transform.scale),
        9,
      );
      // Effective rendered width (attribute scaled by the path transform).
      expect(
        Number(path.getAttribute('stroke-width')) * Math.abs(letter.transform.scale),
      ).toBeCloseTo(SIGIL_STROKE_WIDTH, 6);
      expect(path.getAttribute('fill')).toBe('none');
      expect(path.getAttribute('d')).toBe(composition.letters[index]!.renderPath);
      expect(path.getAttribute('transform')).toBe(
        letterTransformToSvg(composition.letters[index]!.transform),
      );
      expect(path.hasAttribute('data-letter')).toBe(false);
    }
  });
});

describe('letterTransformToSvg', () => {
  it('serializes the prototype affine matrix with translation and scale', () => {
    const matrix = parseMatrix(
      letterTransformToSvg({ x: 10, y: 20, rotation: 15, scale: 0.5, mirror: false }),
    );
    const angle = (15 * Math.PI) / 180;
    const cosine = Math.cos(angle) * 0.5;
    const sine = Math.sin(angle) * 0.5;

    expect(matrix[0]).toBeCloseTo(cosine, 8);
    expect(matrix[1]).toBeCloseTo(sine, 8);
    expect(matrix[2]).toBeCloseTo(-sine, 8);
    expect(matrix[3]).toBeCloseTo(cosine, 8);
    expect(matrix[4]).toBe(10);
    expect(matrix[5]).toBe(20);
  });

  it('mirrors the horizontal axis without changing the vertical axis', () => {
    const matrix = parseMatrix(
      letterTransformToSvg({ x: 0, y: 0, rotation: 0, scale: 0.75, mirror: true }),
    );

    expect(matrix[0]).toBeCloseTo(-0.75, 12);
    expect(matrix[1]).toBeCloseTo(0, 12);
    expect(matrix[2]).toBeCloseTo(0, 12);
    expect(matrix[3]).toBeCloseTo(0.75, 12);
  });
});
