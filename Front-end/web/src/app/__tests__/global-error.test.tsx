/**
 * app/global-error.tsx replaces Next's blank "Application error" screen for
 * crashes in the root layout (the 2026-11 careers outage).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalError from '../global-error';

const reload = jest.fn();
jest.mock('@/lib/chunkErrorRecovery', () => ({
  ...jest.requireActual('@/lib/chunkErrorRecovery'),
  reloadPage: () => reload(),
}));

beforeEach(() => {
  reload.mockClear();
  window.sessionStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// global-error renders its own <html>/<body>, so it is mounted on the document itself.
const renderPage = (error: Error) =>
  render(<GlobalError error={error} reset={jest.fn()} />, { container: document });

describe('GlobalError', () => {
  it('shows a way forward (Reload, home link) for an ordinary crash, without auto-reloading', () => {
    renderPage(new Error('Cannot read properties of undefined'));
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home page/i })).toHaveAttribute('href', '/');
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads automatically, once, when a script failed to download', () => {
    const chunkErr = Object.assign(new Error('Loading chunk 23330 failed.'), { name: 'ChunkLoadError' });
    renderPage(chunkErr);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: /reloading/i })).toBeInTheDocument();
  });

  it('does not loop: a second chunk failure right after the reload shows the page instead', () => {
    const chunkErr = Object.assign(new Error('Loading chunk 23330 failed.'), { name: 'ChunkLoadError' });
    // This tab already auto-reloaded a moment ago (what the first failure records).
    window.sessionStorage.setItem('chunk-reload-at', String(Date.now() - 1000));
    renderPage(chunkErr);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /reload page/i }).length).toBeGreaterThan(0);
  });
});
