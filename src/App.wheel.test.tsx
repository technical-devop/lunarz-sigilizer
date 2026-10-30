import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { FakeWorker } from './test/fakeWorker';
import { SIGIL_BACKGROUND, SIGIL_GLOW, SIGIL_STROKE, SIGIL_STROKE_WIDTH } from './core/svg';

const here = dirname(fileURLToPath(import.meta.url));

function stubObjectUrls(
  createObjectURL: typeof URL.createObjectURL,
  revokeObjectURL: typeof URL.revokeObjectURL,
): void {
  class StubURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', StubURL);
}

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

function previewSvgElement(container: HTMLElement): SVGSVGElement {
  return container.querySelector('.preview__stage svg') as SVGSVGElement;
}

function previewPath(container: HTMLElement): SVGPathElement {
  return container.querySelector('.preview__stage path.sigilpath') as SVGPathElement;
}

describe('one deterministic wheel mark', () => {
  it('replaces the three arrangement choices with one wheel mark', async () => {
    const { container } = render(<App />);
    await reachCompose('BE CALM');

    expect(screen.queryByRole('group', { name: 'Choose an arrangement' })).toBeNull();
    expect(screen.queryByText(/Three small arrangements/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Regenerate/i })).toBeNull();
    expect(screen.getByRole('heading', { name: /One quiet mark/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Sigil mark from 4 letters/i })).toBeInTheDocument();
    expect(container.querySelectorAll('.preview__stage path.sigilpath')).toHaveLength(1);
  });

  it('switches between three rings and a single ring without changing letter order', async () => {
    const { container } = render(<App />);
    const user = await reachCompose('I BUILD RESILIENT STRENGTH');

    const multiPath = previewPath(container).getAttribute('d');
    const lettersBefore = screen
      .getByRole('group', { name: 'Surviving letters' })
      .querySelectorAll('.chip');
    expect(Array.from(lettersBefore).map((chip) => chip.textContent)).toEqual([
      'B', 'L', 'D', 'R', 'S', 'N', 'T', 'G', 'H',
    ]);

    await user.click(screen.getByRole('radio', { name: /Single ring/i }));
    await waitFor(() => {
      expect(previewPath(container).getAttribute('d')).not.toBe(multiPath);
    });
    expect(screen.getByRole('radio', { name: /Single ring/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Three rings/i })).not.toBeChecked();
    const lettersAfter = screen
      .getByRole('group', { name: 'Surviving letters' })
      .querySelectorAll('.chip');
    expect(Array.from(lettersAfter).map((chip) => chip.textContent)).toEqual(
      Array.from(lettersBefore).map((chip) => chip.textContent),
    );
    expect(FakeWorker.instances.at(-1)?.request?.wheelMode).toBe('single');
  });

  it('is deterministic: the same intention and wheel always produce the same path', async () => {
    const first = render(<App />);
    const user = await reachCompose('BE CALM');
    const path = previewPath(first.container).getAttribute('d');

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    await user.type(screen.getByLabelText('Your intention'), 'BE CALM');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('img', { name: /Sigil mark from/ });
    expect(previewPath(first.container).getAttribute('d')).toBe(path);
  });
});

describe('wheel and sequence inspection', () => {
  it('shows all actual wheel positions and order badges without changing the path', async () => {
    const { container } = render(<App />);
    const user = await reachCompose('BE CALM');
    const before = previewPath(container).getAttribute('d');

    await user.click(screen.getByRole('button', { name: 'Show wheel' }));
    await user.click(screen.getByRole('button', { name: 'Show sequence' }));
    expect(screen.getByRole('button', { name: 'Show wheel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(container.querySelectorAll('.wheel-ring')).toHaveLength(3);
    expect(container.querySelectorAll('.wheel-label')).toHaveLength(26);
    expect(container.querySelectorAll('.wheel-order')).toHaveLength(4);
    expect(previewPath(container).getAttribute('d')).toBe(before);

    const sequence = screen.getByRole('list', { name: 'Wheel sequence' });
    const items = within(sequence).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '1 B', '2 C', '3 L', '4 M',
    ]);
    expect(within(sequence).getAllByRole('button')).toHaveLength(4);
  });

  it('shows one ring for the accessible single-ring option', async () => {
    const { container } = render(<App />);
    const user = await reachCompose('BC');
    await user.click(screen.getByRole('radio', { name: /Single ring/i }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Single ring/i })).toBeChecked(),
    );
    await user.click(screen.getByRole('button', { name: 'Show wheel' }));
    expect(container.querySelectorAll('.wheel-ring')).toHaveLength(1);
    expect(container.querySelectorAll('.wheel-label')).toHaveLength(26);
  });

  it('highlights the actual wheel position when a source letter chip is used', async () => {
    const { container } = render(<App />);
    const user = await reachCompose('BE CALM');
    const path = previewPath(container).getAttribute('d');
    const chips = screen.getByRole('group', { name: 'Highlight a source letter' });
    const first = within(chips).getAllByRole('button')[0]!;
    await user.hover(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.wheel-label.is-used')).toHaveLength(1);
    expect(previewPath(container).getAttribute('d')).toBe(path);
    await user.unhover(first);
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('safe exports on the wheel', () => {
  it('exports exactly the clean previewed path with no guides, text, intention or seeds', async () => {
    const blobs: Blob[] = [];
    const downloads: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:fake';
    });
    stubObjectUrls(createObjectURL, vi.fn());
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    try {
      const { container } = render(<App />);
      const user = await reachCompose('I PROTECT MY SPACE');
      await user.click(screen.getByRole('button', { name: 'Show wheel' }));
      await user.click(screen.getByRole('button', { name: 'Show sequence' }));
      const previewSvg = previewSvgElement(container);
      const previewD = previewPath(container).getAttribute('d');
      expect(previewPath(container).getAttribute('stroke')).toBe(SIGIL_STROKE);
      expect(previewPath(container).getAttribute('stroke-width')).toBe(
        String(SIGIL_STROKE_WIDTH),
      );
      expect(previewPath(container).getAttribute('transform')).toBeNull();
      expect(previewSvg.querySelector('rect[data-scene="base-night"]')?.getAttribute('fill')).toMatch(
        /^url\(#/,
      );
      expect(
        Array.from(previewSvg.querySelectorAll('stop')).map((stop) =>
          stop.getAttribute('stop-color'),
        ),
      ).toEqual([SIGIL_GLOW, SIGIL_BACKGROUND]);

      blobs.length = 0;
      downloads.length = 0;
      await user.click(screen.getByRole('button', { name: /Save SVG/ }));
      expect(blobs).toHaveLength(1);
      const text = await blobs[0]!.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.querySelectorAll('path')).toHaveLength(1);
      const path = doc.querySelector('path')!;
      expect(path.getAttribute('d')).toBe(previewD);
      expect(path.getAttribute('stroke')).toBe(SIGIL_STROKE);
      expect(path.getAttribute('stroke-width')).toBe(String(SIGIL_STROKE_WIDTH));
      expect(path.getAttribute('fill')).toBe('none');
      expect(doc.querySelectorAll('text')).toHaveLength(0);
      expect(doc.querySelectorAll('.wheel-ring, .wheel-label, .wheel-order')).toHaveLength(0);
      expect(text).not.toContain('wheel-ring');
      expect(text).not.toContain('wheel-label');
      expect(text).not.toContain('wheel-order');
      expect(text).not.toContain('PRTCMYS');
      expect(text).not.toContain('I PROTECT MY SPACE');
      expect(text).not.toMatch(/data-(letter|source-index|surviving-index|seed|seq)/);
      expect(text).not.toMatch(/seed|intention/i);
      expect(text).not.toContain('<image');
      expect(text).not.toContain('https://');
      expect(downloads[0]).toBe('lunarz-sigil.svg');
      expect(downloads[0]).not.toMatch(/\d{4,}/);
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rasterizes PNG from the same clean wheel scene', async () => {
    const rasterSources: string[] = [];
    const downloads: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      if (blob instanceof Blob && blob.type === 'image/svg+xml') {
        void blob.text().then((value) => rasterSources.push(value));
      }
      return 'blob:fake';
    });
    stubObjectUrls(createObjectURL, vi.fn());
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
      const { container } = render(<App />);
      const user = await reachCompose('steady light');
      const previewD = previewPath(container).getAttribute('d');
      await user.click(screen.getByRole('button', { name: 'Show wheel' }));
      await user.click(screen.getByRole('button', { name: /Save PNG/ }));
      await vi.waitFor(() => expect(downloads.length).toBe(1));
      expect(downloads[0]).toBe('lunarz-sigil.png');
      await vi.waitFor(() => expect(rasterSources.length).toBeGreaterThan(0));
      const raster = rasterSources[0]!;
      expect(raster).not.toContain('wheel-ring');
      expect(raster).not.toContain('wheel-label');
      expect(raster).not.toContain('data-seed');
      expect(raster).toContain(`stroke="${SIGIL_STROKE}"`);
      expect(raster).toContain(`d="${previewD}"`);
    } finally {
      clickSpy.mockRestore();
      getContextSpy.mockRestore();
      toBlobSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('stale intention and wheel edges', () => {
  it('keeps the wheel pinned to the committed words after an input edit', async () => {
    const { container } = render(<App />);
    const user = await reachCompose('sleep calm');
    const path = previewPath(container).getAttribute('d');
    await user.type(screen.getByLabelText('Your intention'), ' changed');
    expect(screen.getByText(/Edited after beginning/)).toBeInTheDocument();
    expect(previewPath(container).getAttribute('d')).toBe(path);
    await user.click(screen.getByRole('radio', { name: /Single ring/i }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Single ring/i })).toBeChecked());
    expect(screen.getByRole('group', { name: 'Surviving letters' }).textContent).toBe('SLPCM');
  });

  it('renders one letter as a visible dot and exports the same dot', async () => {
    const blobs: Blob[] = [];
    stubObjectUrls(vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:fake';
    }), vi.fn());
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      const { container } = render(<App />);
      const user = await reachCompose('B');
      expect(container.querySelectorAll('.preview__stage path.sigilpath')).toHaveLength(0);
      const dot = container.querySelector('.preview__stage circle.wheel-dot');
      expect(dot).not.toBeNull();
      expect(screen.getByRole('img', { name: /Sigil mark from 1 letter/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Save SVG/ }));
      const text = await blobs[0]!.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      expect(doc.querySelectorAll('path')).toHaveLength(0);
      expect(doc.querySelector('circle')).not.toBeNull();
      expect(text).not.toContain('data-letter');
      expect(text).not.toContain('data-order');
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('renders two letters as a single quadratic segment', async () => {
    const { container } = render(<App />);
    await reachCompose('BC');
    const d = previewPath(container).getAttribute('d') ?? '';
    expect(d.match(/Q/g)).toHaveLength(1);
    expect(d.match(/M/g)).toHaveLength(1);
  });
});

describe('HTML accessibility and reduced motion', () => {
  it('exposes the wheel as a native radio fieldset and toggles as pressed buttons', async () => {
    render(<App />);
    const user = await reachCompose('BE CALM');
    const group = screen.getByRole('group', { name: 'Wheel' });
    expect(group.tagName.toLowerCase()).toBe('fieldset');
    expect(within(group).getByRole('radio', { name: /Three rings/i })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /Single ring/i })).not.toBeChecked();
    const showWheel = screen.getByRole('button', { name: 'Show wheel' });
    const showSequence = screen.getByRole('button', { name: 'Show sequence' });
    expect(showWheel).toHaveAttribute('aria-pressed', 'false');
    expect(showSequence).toHaveAttribute('aria-pressed', 'false');

    showWheel.focus();
    await user.keyboard('{Enter}');
    expect(showWheel).toHaveAttribute('aria-pressed', 'true');

    const single = within(group).getByRole('radio', { name: /Single ring/i });
    single.focus();
    await user.keyboard(' ');
    expect(single).toBeChecked();
    expect(within(group).getByRole('radio', { name: /Three rings/i })).not.toBeChecked();
  });

  it('keeps focusable content out of the preview SVG', async () => {
    const { container } = render(<App />);
    await reachCompose('BE CALM');
    const svg = previewSvgElement(container);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toMatch(/Sigil mark from 4 letters/);
    expect(svg.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(svg.querySelectorAll('button')).toHaveLength(0);
    expect(svg.querySelector('title')?.textContent).toBe('Lunarz Sigil');
  });

  it('preserves reduced-motion handling for the sigil path', () => {
    const css = readFileSync(join(here, 'ritual.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.sigilpath');
    expect(reduced).toContain('animation: none');
  });
});
