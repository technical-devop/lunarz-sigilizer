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
} from '../svg';

describe('compositionToSvg base scene', () => {
  it('renders one path per surviving letter with shared geometry', () => {
    const composition = composeSigil(processIntention('LUNARZ'), { seed: 99 });
    const svg = compositionToSvg(composition);

    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg.match(/<path /g)).toHaveLength(composition.letters.length);
    expect(svg).toContain(letterTransformToSvg(composition.letters[0]!.transform));
  });

  it('shares the explicit preview stroke and background', () => {
    const composition = composeSigil(processIntention('SIGIL'), { seed: 7 });
    const svg = compositionToExportSvg(composition);

    expect(svg).toContain(`stroke="${SIGIL_STROKE}"`);
    expect(svg).toContain(`stroke-width="${SIGIL_STROKE_WIDTH}"`);
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain(`stop-color="${SIGIL_GLOW}"`);
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
    expect(svg).toContain(`fill="url(#sigil-night)"`);
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
    // Only the generic product title remains; no intention words leak.
    expect(svg).toContain('<title>Lunarz Sigil</title>');
    expect(svg).not.toContain('intention');
    expect(svg).not.toContain('derivation');
  });

  it('contains no remote assets or embedded images', () => {
    const svg = compositionToExportSvg(composeSigil(processIntention('REST'), { seed: 5 }));

    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('https://');
    // xmlns namespace is the only permitted http reference.
    expect(svg.match(/http:\/\/(?!www\.w3\.org)/)).toBeNull();
    expect(svg).not.toContain('href=');
    expect(svg).not.toContain('xlink');
  });

  it('keeps metadata only when explicitly requested for in-memory editor use', () => {
    const composition = composeSigil(processIntention('LUNARZ'), { seed: 99 });
    const withMetadata = compositionToSvg(composition, { includeMetadata: true });

    expect(withMetadata).toContain('data-seed="99"');
    expect(withMetadata).toContain('data-letter="L"');
    expect(withMetadata).toContain('data-source-index="0"');
    expect(withMetadata).toContain('data-surviving-index="0"');

    // Default export path stays clean.
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
    expect(root.getAttribute('viewBox')).toBe(`0 0 ${composition.width} ${composition.height}`);

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
      expect(path.getAttribute('stroke-width')).toBe(String(SIGIL_STROKE_WIDTH));
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
  it('serializes translation, rotation, scale, and glyph centering', () => {
    expect(letterTransformToSvg({ x: 10, y: 20, rotation: 15, scale: 0.5, mirror: false })).toBe(
      'translate(10 20) rotate(15) scale(0.5 0.5) translate(-50 -50)',
    );
  });

  it('mirrors the horizontal scale without changing the vertical scale', () => {
    expect(letterTransformToSvg({ x: 0, y: 0, rotation: 0, scale: 0.75, mirror: true })).toBe(
      'translate(0 0) rotate(0) scale(-0.75 0.75) translate(-50 -50)',
    );
  });
});
