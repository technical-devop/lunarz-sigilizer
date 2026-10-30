import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App, { buildExportSvg } from './App';
import { composeWheelSigil, processIntention } from './core';
import { SIGIL_STROKE } from './core/svg';
import { FakeWorker } from './test/fakeWorker';

const here = dirname(fileURLToPath(import.meta.url));
const RITUAL_CSS = join(here, 'ritual.css');

beforeEach(() => {
  FakeWorker.reset();
  FakeWorker.defer = false;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function reachCompose(input: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your intention'), input);
  await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  await screen.findByRole('img', { name: /Sigil mark from/ });
  return user;
}

function rootVar(css: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const match = css.match(pattern);
  return match ? match[1]!.trim() : null;
}

function resolveColor(raw: string | null, css: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const varMatch = trimmed.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) {
    return rootVar(css, varMatch[1]!)?.trim() ?? null;
  }
  return trimmed;
}

/**
 * Model the real browser cascade for the preview dot: collect fill/stroke
 * declarations from every CSS rule whose selector is composed solely of the
 * element's classes (e.g. `.wheel-dot`, `.sigilpath`,
 * `.wheel-dot.sigilpath`), in source order — later wins at equal
 * specificity. CSS wins over presentation attributes.
 */
function cascadedDeclarations(
  css: string,
  classes: string[],
): { fill: string | null; stroke: string | null } {
  const classSet = new Set(classes);
  let fill: string | null = null;
  let stroke: string | null = null;
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  for (const match of css.matchAll(rulePattern)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    const body = match[2] ?? '';
    for (const selector of selectors) {
      // Only plain class selectors; skip at-rules, pseudo-classes,
      // descendants, and element-qualified selectors.
      if (!/^\.[\w-]+(\.[\w-]+)*$/.test(selector)) continue;
      const needed = selector.slice(1).split('.');
      if (!needed.every((name) => classSet.has(name))) continue;
      const fillDecl = body.match(/fill\s*:\s*([^;]+);/);
      if (fillDecl) fill = fillDecl[1]!.trim();
      const strokeDecl = body.match(/(^|[\s;{])stroke\s*:\s*([^;]+);/);
      if (strokeDecl) stroke = strokeDecl[2]!.trim();
      break;
    }
  }
  return { fill, stroke };
}

describe('one-letter wheel dot preview/export parity', () => {
  it('settled preview dot matches the exported circle: fill-only, same geometry, no guides', async () => {
    const { container } = render(<App />);
    await reachCompose('B');

    // Real one-letter preview: a single dot, no path.
    expect(container.querySelectorAll('.preview__stage path.sigilpath')).toHaveLength(0);
    const dot = container.querySelector(
      '.preview__stage circle.wheel-dot',
    ) as SVGCircleElement | null;
    expect(dot).not.toBeNull();
    const classes = (dot!.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    // Old behavior carried `sigilpath` here, which paints the path stroke
    // (plus the default 1px width) onto the dot. The dot is fill-only.
    expect(classes).toContain('wheel-dot');
    expect(classes).not.toContain('sigilpath');

    const css = readFileSync(RITUAL_CSS, 'utf8');
    // Guard: the dot rule itself must neutralize stroke so no cascade path
    // can repaint the 1px outline (fails the old `.wheel-dot` rule).
    expect(css).toMatch(/\.wheel-dot\s*\{[^}]*stroke\s*:\s*none/s);
    const { fill: cssFill, stroke: cssStroke } = cascadedDeclarations(css, classes);
    const previewFillAttr = dot!.getAttribute('fill');
    const previewStrokeAttr = dot!.getAttribute('stroke');
    const computedFill =
      resolveColor(cssFill, css) ?? previewFillAttr?.trim() ?? null;
    // SVG default stroke is none; CSS or the presentation attribute may set it.
    const computedStroke =
      resolveColor(cssStroke, css)?.toLowerCase() ??
      previewStrokeAttr?.trim().toLowerCase() ??
      'none';

    // Fill must be the sigil color through the cascade, not `none`.
    expect(computedFill?.toLowerCase()).toBe(SIGIL_STROKE.toLowerCase());
    expect(previewFillAttr).toBe(SIGIL_STROKE);
    // Stroke must settle to none — old CSS resolved `.sigilpath` to the
    // stroke color with the default 1px width, while the export is fill-only.
    expect(computedStroke).toBe('none');

    // Actual preview/export parity against the exported circle (not just r).
    const sigil = composeWheelSigil(processIntention('B'), { mode: 'multi' });
    expect(sigil.dot).not.toBeNull();
    const exported = buildExportSvg(sigil);
    const doc = new DOMParser().parseFromString(exported, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const exportedDot = doc.querySelector('circle');
    expect(exportedDot).not.toBeNull();
    expect(doc.querySelectorAll('path')).toHaveLength(0);
    for (const attr of ['cx', 'cy'] as const) {
      const previewValue = Number(dot!.getAttribute(attr));
      const exportedValue = Number(exportedDot!.getAttribute(attr));
      // Export rounds to 9 decimals; the preview carries the raw float.
      // Parity means numerically identical within serialization rounding.
      expect(Math.abs(previewValue - exportedValue)).toBeLessThan(1e-6);
    }
    expect(dot!.getAttribute('r')).toBe(exportedDot!.getAttribute('r'));
    expect(exportedDot!.getAttribute('fill')).toBe(SIGIL_STROKE);
    expect(exportedDot!.getAttribute('stroke')).toBeNull();
    expect(dot!.getAttribute('fill')).toBe(exportedDot!.getAttribute('fill'));
    // No guides in either scene: overlays are inspection-only.
    const previewSvg = container.querySelector('.preview__stage svg')!;
    expect(previewSvg.querySelectorAll('.wheel-ring, .wheel-label, .wheel-order')).toHaveLength(0);
    expect(doc.querySelectorAll('.wheel-ring, .wheel-label, .wheel-order')).toHaveLength(0);
    expect(doc.querySelectorAll('text')).toHaveLength(0);
    expect(exported).not.toContain('wheel-ring');
    expect(exported).not.toContain('wheel-label');
    expect(exported).not.toContain('wheel-order');

    // Position/radius/color preserved from the model.
    expect(dot!.getAttribute('r')).toBe(String(sigil.dot!.radius));
    expect(Number(dot!.getAttribute('cx'))).toBeCloseTo(sigil.dot!.x, 3);
    expect(Number(dot!.getAttribute('cy'))).toBeCloseTo(sigil.dot!.y, 3);

    // Accessibility preserved: decorative mark stays out of the tab order.
    expect(dot!.getAttribute('aria-hidden')).toBe('true');
    expect(dot!.getAttribute('focusable')).toBe('false');
    expect(previewSvg.getAttribute('role')).toBe('img');
    expect(previewSvg.getAttribute('aria-label')).toMatch(/Sigil mark from 1 letter/);

    // Animation system preserved: path fade still exists with a
    // reduced-motion fallback.
    expect(css).toContain('.wheelmark');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
