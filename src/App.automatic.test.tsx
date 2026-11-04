import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App, { RELEASE_STAGE_MS, SIGIL_DRAW_MS } from './App';
import { composeWheelSigil, processIntention, type WheelMode, type WheelSigil } from './core';
import { ErrorWorker, FakeWorker } from './test/fakeWorker';

class DelayedWorker extends FakeWorker {
  static open: DelayedWorker[] = [];

  override postMessage(data: Parameters<FakeWorker['postMessage']>[0]): void {
    this.request = data;
    DelayedWorker.open.push(this);
  }

  respond(sigil: WheelSigil): void {
    this.onmessage?.({
      data: { ok: true, sigil },
    } as MessageEvent);
  }
}

function sigilFor(input: string, mode: WheelMode = 'multi'): WheelSigil {
  return composeWheelSigil(processIntention(input), { mode });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function advanceToStage(target: number): void {
  for (let stage = 0; stage < target; stage += 1) {
    advance(RELEASE_STAGE_MS);
  }
}

function advanceToSettled(): void {
  advanceToStage(3);
  advance(SIGIL_DRAW_MS);
}

async function begin(user: ReturnType<typeof userEvent.setup>, input: string): Promise<void> {
  await user.type(screen.getByLabelText('Your intention'), input);
  await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
}

function setupUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function previewPath(): string | null {
  return document
    .querySelector('.preview__stage path.sigilpath')
    ?.getAttribute('d') ?? null;
}

function previewMark(): SVGPathElement | SVGCircleElement | null {
  return document.querySelector(
    '.preview__stage path.sigilpath, .preview__stage circle.wheel-dot',
  );
}

function classTokens(element: Element | null): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeWorker.reset();
  FakeWorker.defer = false;
  DelayedWorker.open = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('continuous release', () => {
  it('runs the four stages automatically and settles exports without Continue', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BCDFG');

    const stream = screen.getByRole('list', { name: 'Letter reduction' });
    expect(stream).toHaveAttribute('data-stage', '0');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gather the kept letters/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

    advance(RELEASE_STAGE_MS);
    expect(stream).toHaveAttribute('data-stage', '1');

    advance(RELEASE_STAGE_MS);
    expect(stream).toHaveAttribute('data-stage', '2');

    advance(RELEASE_STAGE_MS);
    expect(stream).toHaveAttribute('data-stage', '3');
    expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save PNG/ })).toBeNull();

    advance(SIGIL_DRAW_MS);
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save PNG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('moves exactly one stage per interval and never runs stages early', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'banana sleep');
    const stream = screen.getByRole('list', { name: 'Letter reduction' });

    advance(RELEASE_STAGE_MS / 2);
    expect(stream).toHaveAttribute('data-stage', '0');
    advance(RELEASE_STAGE_MS / 2 + 50);
    expect(stream).toHaveAttribute('data-stage', '1');

    advance(RELEASE_STAGE_MS / 2);
    expect(stream).toHaveAttribute('data-stage', '1');
    advance(RELEASE_STAGE_MS / 2 + 50);
    expect(stream).toHaveAttribute('data-stage', '2');

    advance(RELEASE_STAGE_MS / 2);
    expect(stream).toHaveAttribute('data-stage', '2');
    advance(RELEASE_STAGE_MS / 2 + 50);
    expect(stream).toHaveAttribute('data-stage', '3');
  });

  it('settles immediately from Skip at every playback stage using the keyboard', async () => {
    for (let target = 0; target < 4; target += 1) {
      cleanup();
      FakeWorker.reset();
      FakeWorker.defer = false;
      vi.stubGlobal('Worker', FakeWorker);

      const user = setupUser();
      render(<App />);
      await begin(user, 'BANANA');

      advanceToStage(target);
      expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
        'data-stage',
        String(target),
      );

      const skip = screen.getByRole('button', { name: 'Skip' });
      skip.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
        'data-stage',
        '3',
      );
      expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    }
  });

  it('enables drawing only while a natural draw is settling, and again on Replay', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BE CALM');

    advanceToStage(3);
    const drawingMark = previewMark();
    expect(drawingMark).not.toBeNull();
    expect(classTokens(drawingMark)).toContain('is-drawing');

    advance(SIGIL_DRAW_MS);
    const settledMark = previewMark();
    expect(settledMark).not.toBeNull();
    expect(classTokens(settledMark)).not.toContain('is-drawing');

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    advanceToStage(3);
    const replayedMark = previewMark();
    expect(replayedMark).not.toBeNull();
    expect(classTokens(replayedMark)).toContain('is-drawing');
  });

  it('keeps the mark fully still when Skip is pressed during stage 0 after Replay', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BE CALM');
    advanceToSettled();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    const stream = screen.getByRole('list', { name: 'Letter reduction' });
    expect(stream).toHaveAttribute('data-stage', '3');
    expect(stream).toHaveAttribute('data-settled', 'true');
    const mark = previewMark();
    expect(mark).not.toBeNull();
    expect(classTokens(mark)).not.toContain('is-drawing');
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
  });

  it('shows Replay only after completion and repeats the same committed mark and wheel', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BE CALM');
    await user.click(screen.getByRole('radio', { name: /Single ring/i }));

    advanceToSettled();
    const path = previewPath();
    expect(path).not.toBeNull();
    expect(screen.getByRole('radio', { name: /Single ring/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();

    advanceToSettled();
    expect(previewPath()).toBe(path);
    expect(FakeWorker.instances.at(-1)?.request?.wheelMode).toBe('single');
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
  });

  it('keeps rapid replay and skip cycles free of leftover timers', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BE CALM');

    for (let cycle = 0; cycle < 5; cycle += 1) {
      advance(RELEASE_STAGE_MS);
      await user.click(screen.getByRole('button', { name: 'Skip' }));
      expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
        'data-stage',
        '3',
      );
      await user.click(screen.getByRole('button', { name: 'Replay' }));
      expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
        'data-stage',
        '0',
      );
    }

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('reduced motion', () => {
  it('reaches the final result promptly and preserves Replay for the same mark', async () => {
    stubReducedMotion(true);
    const user = setupUser();
    render(<App />);
    await begin(user, 'BE CALM');

    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '3',
    );
    expect(screen.getByRole('img', { name: /Sigil mark from/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const mark = previewMark();
    expect(mark).not.toBeNull();
    expect(classTokens(mark)).not.toContain('is-drawing');

    const path = previewPath();
    await user.click(screen.getByRole('button', { name: 'Replay' }));

    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '3',
    );
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(previewPath()).toBe(path);
    expect(classTokens(previewMark())).not.toContain('is-drawing');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('delayed and failed composition', () => {
  it('shows honest loading after Skip before the worker completes, then the real result', async () => {
    vi.stubGlobal('Worker', DelayedWorker);
    const user = setupUser();
    render(<App />);
    await begin(user, 'BCD');

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '3',
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.getByText(/wheel mark will appear here/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    expect(DelayedWorker.open).toHaveLength(1);
    act(() => {
      DelayedWorker.open[0]!.respond(sigilFor('BCD'));
    });

    expect(screen.getByRole('img', { name: /Sigil mark from 3 letters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    const mark = previewMark();
    expect(mark).not.toBeNull();
    expect(classTokens(mark)).not.toContain('is-drawing');
  });

  it('never shows a stale result while a new replay worker is pending', async () => {
    vi.stubGlobal('Worker', DelayedWorker);
    const user = setupUser();
    render(<App />);
    await begin(user, 'BC');

    advanceToSettled();
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.getByText(/wheel mark will appear here/i)).toBeInTheDocument();

    expect(DelayedWorker.open).toHaveLength(1);
    const stale = DelayedWorker.open[0]!;

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(stale.terminated).toBe(true);
    expect(DelayedWorker.open).toHaveLength(2);
    const fresh = DelayedWorker.open[1]!;

    act(() => {
      stale.respond(sigilFor('BC'));
    });
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    advanceToSettled();
    act(() => {
      fresh.respond(sigilFor('BC'));
    });
    expect(screen.getByRole('img', { name: /Sigil mark from 2 letters/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a worker failure after the automatic sequence instead of hanging or showing a mark', async () => {
    vi.stubGlobal('Worker', ErrorWorker);
    const user = setupUser();
    render(<App />);
    await begin(user, 'B');

    advanceToSettled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Web Worker|background composer/i);
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
  });
});

describe('honest edge inputs', () => {
  it('completes and exports with zero vowels and zero duplicates', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BCDFG');

    advanceToSettled();
    expect(screen.getByRole('img', { name: /Sigil mark from 5 letters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save PNG/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('settles and exports one-letter and two-letter marks automatically', async () => {
    for (const input of ['B', 'BC']) {
      cleanup();
      FakeWorker.reset();
      FakeWorker.defer = false;
      vi.stubGlobal('Worker', FakeWorker);

      const user = setupUser();
      render(<App />);
      await begin(user, input);
      advanceToSettled();

      expect(
        screen.getByRole('img', {
          name: new RegExp(`Sigil mark from ${input.length} letter`),
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save SVG/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save PNG/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    }
  });

  it('cancels the pending sequence timer when the bench unmounts', async () => {
    const user = setupUser();
    const { unmount } = render(<App />);
    await begin(user, 'BE CALM');
    advance(RELEASE_STAGE_MS / 2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('all-vowel input completes without a mark or export and stays replayable', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'AEIOU');

    expect(screen.getByText(/Only vowels so far/)).toBeInTheDocument();
    advanceToSettled();
    expect(screen.getByText(/Vowels alone cannot build/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save SVG/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
  });

  it('starts a fresh automatic sequence when Begin again commits edited words', async () => {
    const user = setupUser();
    render(<App />);
    await begin(user, 'BC');
    advanceToStage(2);

    const input = screen.getByLabelText('Your intention');
    await user.clear(input);
    await user.type(input, 'BCD');
    await user.click(screen.getByRole('button', { name: 'Begin again' }));

    expect(screen.getByRole('list', { name: 'Letter reduction' })).toHaveAttribute(
      'data-stage',
      '0',
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    advanceToSettled();
    expect(screen.getByRole('img', { name: /Sigil mark from 3 letters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
  });
});
