/**
 * Regression: 2026-11 careers outage.
 *
 * FestivalEffectsLoader renders from the ROOT layout, above every error
 * boundary. When its lazy chunk failed to download, next/dynamic threw during
 * render and every page — /careers included — became Next's blank
 * "Application error: a client-side exception has occurred". A failed download
 * of this decoration must now leave the page standing.
 */
import { Component, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../FestivalEffects', () => {
  throw Object.assign(new Error('Loading chunk 23330 failed.'), { name: 'ChunkLoadError' });
});

// Make the retries instant so the test does not wait out the back-off.
jest.mock('@/lib/loadOptionalChunk', () => {
  const actual = jest.requireActual('@/lib/loadOptionalChunk');
  return {
    loadOptionalChunk: (loader: () => Promise<unknown>, opts: object) =>
      actual.loadOptionalChunk(loader, { ...opts, retryDelayMs: 0 }),
  };
});

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <p>crashed: {this.state.error.message}</p> : this.props.children;
  }
}

describe('FestivalEffectsLoader when its chunk cannot be downloaded', () => {
  it('renders nothing instead of throwing, so the rest of the page survives', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: FestivalEffectsLoader } = await import('../FestivalEffectsLoader');
    render(
      <Boundary>
        <FestivalEffectsLoader />
        <p>page content</p>
      </Boundary>,
    );
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByText(/crashed/)).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
