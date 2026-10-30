import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App, { buildExportSvg, exportFileName } from './App';
import { FakeWorker } from './test/fakeWorker';
import { composeWheelSigil, processIntention } from './core';
import { SIGIL_STROKE, SIGIL_STROKE_WIDTH } from './core/svg';

const here = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  FakeWorker.reset();
  FakeWorker.defer = false;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  cleanup();
});

describe('ritual phases', () => {
  it('hides the wheel mark and exports until compose after begin', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'sleep through the night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save PNG/ })).toBeNull();
    expect(
      screen.getByText(/Reduction first\. Continue through the passes/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save PNG/ })).toBeInTheDocument();
  }, 15000);

  it('steps stages in order: vowels fade only after first Continue, duplicates after next', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'banana sleep');
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

  it('gathers one wheel mark for longer intentions without blocking the bench', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'steady light');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(
      await screen.findByRole('img', { name: /Sigil mark from/ }, { timeout: 8000 }),
    ).toBeInTheDocument();
  }, 12000);

  it('supports skip to compose and replay back to reduction', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'quiet night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
  });
});

describe('wheel motion', () => {
  it('animates the single wheel path in and keeps a reduced-motion fallback', () => {
    const ritualCss = readFileSync(join(here, 'ritual.css'), 'utf8');
    expect(ritualCss).toContain('.wheelmark');
    expect(ritualCss).toContain('@media (prefers-reduced-motion: reduce)');
    const reduced = ritualCss.slice(ritualCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.assemble');
    expect(reduced).toContain('transform: none');
    expect(reduced).toContain('.sigilpath');
  });
});

describe('accessibility', () => {
  it('has no focusable SVG paths in the preview; highlight uses independent chips', async () => {
    const { container } = render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'sleep through night');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    const preview = await screen.findByRole('img', { name: /Sigil mark from/ });
    expect(preview.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelectorAll('svg button, svg [tabindex]').length).toBe(0);

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

    await user.click(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(chipButtons[0]!);
    expect(chipButtons[0]).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('edit and restart', () => {
  it('keeps the wheel pinned to the committed words after input edits; Begin again rebuilds', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Your intention');
    await user.type(input, 'sleep calm');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    const firstPreview = screen.getByRole('img', { name: /Sigil mark from/ });

    await user.type(input, ' extra words here');
    expect(screen.getByText(/Edited after beginning/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBe(firstPreview);

    await user.click(screen.getByRole('button', { name: 'Begin again' }));
    expect(screen.queryByText(/Edited after beginning/)).toBeNull();
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
  }, 15000);

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
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
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
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
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
  it('uses seed-free filenames and states that overlays are inspection-only', async () => {
    expect(exportFileName('svg')).toBe('lunarz-sigil.svg');
    expect(exportFileName('png')).toBe('lunarz-sigil.png');
    expect(exportFileName('svg')).not.toMatch(/\d{4,}/);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'steady light');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(
      screen.getByText(/inspection only — exports/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Overlays are never exported/i)).toBeInTheDocument();
  });

  it('buildExportSvg is deterministic, clean, and matches the wheel model', () => {
    const sigil = composeWheelSigil(processIntention('steady light'), { mode: 'multi' });
    const first = buildExportSvg(sigil);
    const second = buildExportSvg(sigil);
    expect(first).toBe(second);
    expect(first).toContain('<path');
    expect(first).toContain(`stroke="${SIGIL_STROKE}"`);
    expect(first).toContain(`stroke-width="${SIGIL_STROKE_WIDTH}"`);
    expect(first).not.toContain('data-letter');
    expect(first).not.toContain('data-seed');
    expect(first).not.toContain('wheel-ring');
    expect(first).not.toContain('wheel-label');
    expect(first).not.toContain('wheel-order');
    expect(first).not.toContain('steady light');
  });
});
