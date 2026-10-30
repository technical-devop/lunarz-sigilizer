import { describe, expect, it } from 'vitest';

import { processIntention } from '../intention';
import { compositionToExportSvg, SIGIL_BACKGROUND, SIGIL_GLOW, SIGIL_STROKE, SIGIL_STROKE_WIDTH } from '../svg';
import { buildWheelSigil } from '../wheel';
import { wheelToExportSvg } from '../wheelSvg';

describe('clean wheel SVG export', () => {
  it('serializes exactly one clean path with the preview stroke and width', () => {
    const sigil = buildWheelSigil(processIntention('BE CALM').letters, { mode: 'single' });
    const svg = wheelToExportSvg(sigil);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    const paths = Array.from(doc.querySelectorAll('path'));
    expect(paths).toHaveLength(1);
    const path = paths[0]!;
    expect(path.getAttribute('d')).toBe(sigil.pathD);
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
    expect(path.getAttribute('stroke-width')).toBe(String(SIGIL_STROKE_WIDTH));
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('transform')).toBeNull();

    expect(doc.querySelectorAll('text')).toHaveLength(0);
    expect(doc.querySelectorAll('circle.wheel-ring')).toHaveLength(0);
    expect(svg).not.toContain('wheel-ring');
    expect(svg).not.toContain('wheel-label');
    expect(svg).not.toContain('wheel-order');
    expect(svg).not.toContain('BCLM');
    expect(svg).not.toContain('BE CALM');
    expect(svg).not.toMatch(/data-(letter|source-index|surviving-index|seed|seq)/);
    expect(svg).not.toMatch(/intention|seed/i);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('https://');
    expect(svg.match(/http:\/\/(?!www\.w3\.org)/)).toBeNull();
    expect(svg).toContain(`stop-color="${SIGIL_GLOW}"`);
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
  });

  it('exports one visible dot for a single letter and no path', () => {
    const sigil = buildWheelSigil('B', { mode: 'multi' });
    const svg = wheelToExportSvg(sigil);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('path')).toHaveLength(0);
    const dot = doc.querySelector('circle');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('r')).toBe('3.5');
    expect(dot!.getAttribute('fill')).toBe(SIGIL_STROKE);
    expect(svg).not.toContain('data-letter');
    expect(svg).not.toContain('data-order');
  });

  it('exports an empty scene for zero letters without text or marks', () => {
    const sigil = buildWheelSigil([], { mode: 'multi' });
    const svg = wheelToExportSvg(sigil);
    expect(svg).not.toContain('<path ');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('no marks');
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
  });

  it('keeps export geometry identical to what the preview model renders', () => {
    const sigil = buildWheelSigil(processIntention('I BUILD RESILIENT STRENGTH').letters, {
      mode: 'multi',
    });
    const svg = wheelToExportSvg(sigil);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('path')!.getAttribute('d')).toBe(sigil.pathD);
    const legacy = compositionToExportSvg({
      seed: '0',
      width: 1,
      height: 1,
      letters: [],
      isEmpty: true,
      spineSurvivingIndex: null,
      connections: [],
      searchStats: {
        maxCandidatesPerLetter: 0,
        candidatesEvaluated: 0,
        acceptedConnections: 0,
      },
      variant: 'none',
      variantName: '',
      scaleRecipe: '',
      canvasScale: 1,
    });
    expect(legacy).toContain('<title>Lunarz Sigil</title>');
  });
});
