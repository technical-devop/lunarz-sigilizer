import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { composeWheelSigil, processIntention, type WheelMode, type WheelSigil } from './core';
import { ErrorWorker, FakeWorker, SilentWorker } from './test/fakeWorker';

class ControlledWorker extends FakeWorker {
  static open: ControlledWorker[] = [];

  override postMessage(data: Parameters<FakeWorker['postMessage']>[0]): void {
    this.request = data;
    ControlledWorker.open.push(this);
  }

  respond(sigil: WheelSigil): void {
    this.onmessage?.({
      data: { ok: true, sigil },
    } as MessageEvent);
  }
}

function wheelFor(input: string, mode: WheelMode = 'multi'): WheelSigil {
  return composeWheelSigil(processIntention(input), { mode });
}

beforeEach(() => {
  FakeWorker.reset();
  ControlledWorker.open = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function reachCompose(user: ReturnType<typeof userEvent.setup>, input: string) {
  await user.type(screen.getByLabelText('Your intention'), input);
  await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
}

describe('all wheel composition runs in a worker', () => {
  it('uses a worker even for a one-letter intention', async () => {
    FakeWorker.defer = false;
    vi.stubGlobal('Worker', FakeWorker);
    render(<App />);
    const user = userEvent.setup();
    await reachCompose(user, 'B');

    expect(FakeWorker.instances.length).toBeGreaterThan(0);
    expect(
      await screen.findByRole('img', { name: /Sigil mark from 1 letter/ }, { timeout: 8000 }),
    ).toBeInTheDocument();
  }, 15000);

  it('does not render a synchronous wheel while a short-input worker is pending', async () => {
    vi.stubGlobal('Worker', SilentWorker);
    render(<App />);
    const user = userEvent.setup();
    await reachCompose(user, 'B');

    expect(SilentWorker.instances.length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/wheel mark will appear here/i)).toBeInTheDocument();
  }, 15000);

  it('shows an actionable error when the browser cannot start a worker', async () => {
    vi.stubGlobal('Worker', undefined);
    render(<App />);
    const user = userEvent.setup();
    await reachCompose(user, 'B');

    expect(screen.getByRole('alert')).toHaveTextContent(/Web Worker|background composer/i);
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
  }, 15000);

  it('shows an actionable error and never composes on the main thread when a worker errors', async () => {
    vi.stubGlobal('Worker', ErrorWorker);
    render(<App />);
    const user = userEvent.setup();
    await reachCompose(user, 'B');

    expect(ErrorWorker.instances.length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/Web Worker|background composer/i);
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
  }, 15000);

  it('cancels stale work and keeps the bench responsive while a worker is pending', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const stale = wheelFor('BC');
    const fresh = wheelFor('BCD');
    render(<App />);
    const user = userEvent.setup();

    await reachCompose(user, 'BC');
    expect(ControlledWorker.open).toHaveLength(1);
    const staleWorker = ControlledWorker.open[0]!;
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    const input = screen.getByLabelText('Your intention');
    await user.clear(input);
    await user.type(input, 'BCD');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(staleWorker.terminated).toBe(true);
    expect(ControlledWorker.open).toHaveLength(2);
    const freshWorker = ControlledWorker.open[1]!;

    staleWorker.respond(stale);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();

    freshWorker.respond(fresh);
    expect(
      await screen.findByRole('img', { name: /Sigil mark from 3 letters/ }),
    ).toBeInTheDocument();

    staleWorker.respond(stale);
    expect(screen.getByRole('img', { name: /Sigil mark from 3 letters/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  }, 30000);

  it('renders the worker response as exactly one wheel, including the one-letter dot', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    render(<App />);
    const user = userEvent.setup();

    await reachCompose(user, 'B');
    expect(ControlledWorker.open).toHaveLength(1);
    ControlledWorker.open[0]!.respond(wheelFor('B'));

    expect(
      await screen.findByRole('img', { name: /Sigil mark from 1 letter/ }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.preview__stage circle.wheel-dot')).toHaveLength(1);
    expect(document.querySelectorAll('.preview__stage path.sigilpath')).toHaveLength(0);
  }, 30000);

  it('passes the selected wheel mode to the worker and reports a mode switch', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    render(<App />);
    const user = userEvent.setup();
    await reachCompose(user, 'BCD');
    ControlledWorker.open[0]!.respond(wheelFor('BCD', 'multi'));
    await screen.findByRole('img', { name: /Sigil mark from 3 letters/ });

    await user.click(screen.getByRole('radio', { name: /Single ring/i }));
    expect(ControlledWorker.open).toHaveLength(2);
    expect(ControlledWorker.open[1]!.request?.wheelMode).toBe('single');
    ControlledWorker.open[1]!.respond(wheelFor('BCD', 'single'));
    expect(
      await screen.findByText(/Chosen wheel · single ring/),
    ).toBeInTheDocument();
  }, 30000);
});
