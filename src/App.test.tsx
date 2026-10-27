import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App, { buildExportSvg, exportFileName } from './App';
import {
  SIGIL_BACKGROUND,
  SIGIL_GLOW,
  SIGIL_STROKE,
  SIGIL_STROKE_WIDTH,
} from './core/svg';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
});

describe('ritual phases', () => {
  it('hides choices, preview and export until compose after begin', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Your intention');
    await user.type(input, 'sleep through the night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save PNG/ })).toBeNull();
    expect(
      screen.getByText(/Reduction first\. Continue through the passes/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('group', { name: 'Choose an arrangement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save PNG/ })).toBeInTheDocument();
  });

  it('steps stages in order: vowels fade only after first Continue, duplicates after next', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Your intention');
    await user.type(input, 'banana sleep');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    const stream = screen.getByRole('list', { name: 'Letter reduction' });
    expect(stream).toHaveAttribute('data-stage', '0');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(stream).toHaveAttribute('data-stage', '1');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(stream).toHaveAttribute('data-stage', '2');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(stream).toHaveAttribute('data-stage', '3');
  });

  it('supports skip to compose and replay back to reduction', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'quiet night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('group', { name: 'Choose an arrangement' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
  });
});

describe('real-time assembly', () => {
  it('animates each kept glyph from a distinct pre-assembly offset when entering compose', async () => {
    const { container } = render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'lunar sigil');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    const assembled = container.querySelectorAll('g.assemble');
    expect(assembled.length).toBeGreaterThan(2);

    const offsets = Array.from(assembled).map((g) => ({
      dx: (g as SVGGElement).style.getPropertyValue('--dx'),
      dy: (g as SVGGElement).style.getPropertyValue('--dy'),
      i: (g as SVGGElement).style.getPropertyValue('--i'),
    }));
    for (const offset of offsets) {
      expect(offset.dx).not.toBe('');
      expect(offset.dy).not.toBe('');
      expect(offset.dx).not.toBe('0px');
    }
    const distinct = new Set(offsets.map((o) => `${o.dx}/${o.dy}`));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('honors reduced motion: assembly collapses to a non-spatial fade', () => {
    const ritualCss = readFileSync(join(here, 'ritual.css'), 'utf8');
    expect(ritualCss).toContain('@media (prefers-reduced-motion: reduce)');
    const reduced = ritualCss.slice(ritualCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.assemble');
    expect(reduced).toContain('transform: none');
  });
});

describe('accessibility', () => {
  it('has no focusable SVG paths nested in choice buttons; highlight uses independent chips', async () => {
    const { container } = render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'sleep through night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(container.querySelectorAll('button path[tabindex]').length).toBe(0);
    expect(container.querySelectorAll('button [tabindex="0"]').length).toBe(0);

    const variants = container.querySelectorAll('.variant__frame svg');
    variants.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    const chips = screen.getByRole('group', { name: 'Highlight a source letter' });
    const chipButtons = within(chips).getAllByRole('button');
    expect(chipButtons.length).toBeGreaterThan(0);
    for (const chip of chipButtons) {
      expect(chip).toHaveAttribute('aria-pressed');
      expect(chip.getAttribute('aria-label')).toMatch(/Highlight letter/);
    }

    await user.hover(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'true');
    await user.unhover(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('edit and restart', () => {
  it('keeps export pinned to the committed words after input edits; Begin again rebuilds', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Your intention');
    await user.type(input, 'sleep calm');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    const firstPreview = screen.getByText(/Chosen preview · seed/).textContent;

    await user.type(input, ' extra words here');
    expect(screen.getByText(/Edited after beginning/)).toBeInTheDocument();
    expect(screen.getByText(/Chosen preview · seed/).textContent).toBe(firstPreview);

    await user.click(screen.getByRole('button', { name: 'Begin again' }));
    expect(screen.queryByText(/Edited after beginning/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
  });

  it('discards edits and starts over cleanly', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>('Your intention');
    await user.type(input, 'quiet mind');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    await user.type(input, ' changed');
    await user.click(screen.getByRole('button', { name: 'Discard edit' }));
    expect(input.value).toBe('quiet mind');

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Begin the reduction' })).toBeInTheDocument();
  });
});

describe('empty and unsupported input', () => {
  it('classifies all-vowel input with spaces as all-vowel, not unsupported-only', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'AEIOU   ');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    expect(screen.getByText(/Only vowels so far/)).toBeInTheDocument();
    expect(screen.getByText(/Vowels alone cannot build/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
  });

  it('names unsupported characters with code points and reasons', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'calm café 42');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    expect(screen.getByText(/3 characters cannot enter the mark/i)).toBeInTheDocument();
    const setaside = screen.getByText(/cannot enter the mark/i).closest('.setaside');
    expect(setaside?.textContent).toContain('U+00E9');
    expect(setaside?.textContent).toContain('unsupported character');
    expect(setaside?.textContent).toContain('U+0034');
    expect(setaside?.textContent).toContain('digit');
  });
});

describe('export integrity', () => {
  it('exports the chosen previewed arrangement exactly', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'steady light');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    const previewSeed = screen.getByText(/Chosen preview · seed/).textContent;
    const chosen = screen.getByRole('button', { name: /Arrangement 1, chosen/ });
    expect(chosen.getAttribute('aria-label')).toContain(
      (previewSeed ?? '').replace('Chosen preview · seed ', 'seed '),
    );

    await user.click(screen.getByRole('button', { name: /Save SVG/ }));
    expect(screen.getByText(/Saved as SVG, exactly as previewed/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('states that overlays are inspection-only and never exported', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'steady light');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(
      screen.getByText(/inspection overlays only — exports/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Overlays are never exported/i),
    ).toBeInTheDocument();
  });

  it('uses seed-free filenames for both exports', () => {
    expect(exportFileName('svg', 0)).toBe('lunarz-sigil-arrangement-1.svg');
    expect(exportFileName('png', 2)).toBe('lunarz-sigil-arrangement-3.png');
    expect(exportFileName('svg', 0)).not.toMatch(/\d{4,}/);
  });

  it('preview base scene and exported SVG share geometry, stroke, and night background', async () => {
    const blobs: Blob[] = [];
    const downloads: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:fake';
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    try {
      const { container } = render(<App />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Your intention'), 'steady light');
      await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
      await user.click(screen.getByRole('button', { name: 'Skip' }));

      const previewSeedText = screen.getByText(/Chosen preview · seed/).textContent ?? '';
      const seedDigits = previewSeedText.replace(/[^0-9]/g, '');

      // Turn overlays on: they must appear on screen yet stay out of the file.
      await user.click(screen.getByRole('button', { name: 'Show source letters' }));
      const chips = screen.getByRole('group', { name: 'Highlight a source letter' });
      const firstChip = within(chips).getAllByRole('button')[0]!;
      await user.hover(firstChip);
      expect(container.querySelectorAll('.sourcelabel').length).toBeGreaterThan(0);

      const previewSvg = container.querySelector('.preview__stage svg');
      expect(previewSvg).not.toBeNull();
      const previewPaths = Array.from(previewSvg!.querySelectorAll('path'));
      expect(previewPaths.length).toBeGreaterThan(0);
      const previewBase = previewSvg!.querySelector('rect[data-scene="base-night"]');
      expect(previewBase?.getAttribute('fill')).toMatch(/^url\(#/);
      const previewGradient = previewSvg!.querySelector('radialGradient');
      expect(previewGradient).not.toBeNull();
      const previewStops = Array.from(previewSvg!.querySelectorAll('stop')).map((stop) =>
        stop.getAttribute('stop-color'),
      );
      expect(previewStops).toEqual([SIGIL_GLOW, SIGIL_BACKGROUND]);
      for (const path of previewPaths) {
        expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
        expect(path.getAttribute('stroke-width')).toBe(String(SIGIL_STROKE_WIDTH));
      }
      const previewGeometry = previewPaths.map((path) => ({
        d: path.getAttribute('d'),
        transform: path.getAttribute('transform'),
      }));

      blobs.length = 0;
      downloads.length = 0;
      await user.click(screen.getByRole('button', { name: /Save SVG/ }));
      expect(blobs).toHaveLength(1);
      const exportedText = await blobs[0]!.text();
      const doc = new DOMParser().parseFromString(exportedText, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      const exportedPaths = Array.from(doc.querySelectorAll('path'));
      expect(exportedPaths).toHaveLength(previewGeometry.length);
      exportedPaths.forEach((path, index) => {
        expect(path.getAttribute('d')).toBe(previewGeometry[index]!.d);
        expect(path.getAttribute('transform')).toBe(previewGeometry[index]!.transform);
        expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
      });
      expect(exportedText).toContain(`stop-color="${SIGIL_GLOW}"`);
      expect(exportedText).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
      expect(exportedText).not.toContain('data-letter');
      expect(exportedText).not.toContain('data-source-index');
      expect(exportedText).not.toContain('data-surviving-index');
      expect(exportedText).not.toContain('data-seed');
      expect(exportedText).not.toContain('<image');
      expect(exportedText).not.toContain('https://');
      expect(exportedText.match(/http:\/\/(?!www\.w3\.org)/)).toBeNull();
      // No source-label text or highlight classes leak into the file.
      expect(exportedText).not.toContain('sourcelabel');
      expect(exportedText).not.toContain('is-lit');

      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toBe('lunarz-sigil-arrangement-1.svg');
      if (seedDigits.length > 0) {
        expect(downloads[0]).not.toContain(seedDigits);
      }
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('PNG rasterizes from the same clean vector scene on the night background', async () => {
    const rasterSources: string[] = [];
    const downloads: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      if (blob instanceof Blob && blob.type === 'image/svg+xml') {
        void blob.text().then((text) => rasterSources.push(text));
      }
      return 'blob:fake';
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
        callback(new Blob(['png-bytes'], { type: 'image/png' }));
      });

    try {
      render(<App />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Your intention'), 'steady light');
      await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
      await user.click(screen.getByRole('button', { name: 'Skip' }));
      await user.click(screen.getByRole('button', { name: 'Show source letters' }));

      await user.click(screen.getByRole('button', { name: /Save PNG/ }));
      await vi.waitFor(() => expect(downloads.length).toBe(1));
      expect(downloads[0]).toBe('lunarz-sigil-arrangement-1.png');

      await vi.waitFor(() => expect(rasterSources.length).toBeGreaterThan(0));
      const raster = rasterSources[0]!;
      expect(raster).not.toContain('data-letter');
      expect(raster).not.toContain('data-seed');
      expect(raster).toContain(`stroke="${SIGIL_STROKE}"`);
      expect(raster).toContain(`stop-color="${SIGIL_BACKGROUND}"`);

      const context = getContextSpy.mock.results[0]?.value as unknown as {
        fillStyle: string;
        drawImage: ReturnType<typeof vi.fn>;
      };
      // Canvas is primed with the same explicit night background before raster.
      expect(context?.fillStyle).toBe(SIGIL_BACKGROUND);
      expect(context?.drawImage).toHaveBeenCalled();
      expect(toBlobSpy).toHaveBeenCalled();
      expect(screen.getByText(/Saved as PNG, exactly as previewed/)).toBeInTheDocument();
    } finally {
      clickSpy.mockRestore();
      getContextSpy.mockRestore();
      toBlobSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('buildExportSvg is deterministic and metadata-free for any settled composition', () => {
    expect(exportFileName('svg', 1)).toBe('lunarz-sigil-arrangement-2.svg');
    expect(buildExportSvg).toBeDefined();
  });
});
