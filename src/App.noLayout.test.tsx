import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core')>();
  return {
    ...actual,
    composeWheelSigil: () => {
      throw new Error('no layout available');
    },
  };
});

import App from './App';
import { FakeWorker } from './test/fakeWorker';

beforeEach(() => {
  FakeWorker.reset();
  FakeWorker.defer = false;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  cleanup();
});

describe('no layout', () => {
  it('shows a visible error instead of waiting forever for the wheel mark', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your intention'), 'BE CALM');
    await user.click(screen.getByRole('button', { name: 'Begin the reduction' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByRole('alert').textContent).toMatch(
      /could not settle into a clear mark/i,
    );
    expect(screen.queryByRole('img', { name: /Sigil mark from/ })).toBeNull();
  });
});
