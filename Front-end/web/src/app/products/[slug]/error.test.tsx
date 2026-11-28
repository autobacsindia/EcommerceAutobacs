/**
 * Product page error screen: a failed script download reloads the page ONCE
 * (a fresh load fixes it; "Try again" alone re-renders with the same missing
 * script), and never loops. Every crash is reported to "Website errors".
 */
import { render, screen } from '@testing-library/react';
import ProductDetailError from './error';
import { reportClientError } from '@/lib/reportClientError';
import { blockStorage } from '@/test-utils/blockStorage';

const reload = jest.fn();
jest.mock('@/lib/chunkErrorRecovery', () => ({
  ...jest.requireActual('@/lib/chunkErrorRecovery'),
  reloadPage: () => reload(),
}));
jest.mock('@/lib/reportClientError', () => ({ reportClientError: jest.fn() }));

const chunkErr = () => Object.assign(new Error('Loading chunk 4521 failed.'), { name: 'ChunkLoadError' });

beforeEach(() => {
  reload.mockClear();
  (reportClientError as jest.Mock).mockClear();
  window.sessionStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('ProductDetailError', () => {
  it('ordinary crash → shows the error screen, no reload, reported', () => {
    render(<ProductDetailError error={new Error('boom')} reset={jest.fn()} />);
    expect(screen.getByRole('heading', { name: /product unavailable/i })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'page-crash', step: 'route-error',
      context: expect.objectContaining({ scope: 'product-detail', chunkLoad: false }),
    }));
  });

  it('script download failed → reloads once and says so', () => {
    render(<ProductDetailError error={chunkErr()} reset={jest.fn()} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/reloading/i);
  });

  it('does not loop: a second chunk failure right after the reload shows the screen', () => {
    window.sessionStorage.setItem('chunk-reload-at', String(Date.now() - 1000));
    render(<ProductDetailError error={chunkErr()} reset={jest.fn()} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /product unavailable/i })).toBeInTheDocument();
  });

  it('storage blocked → cannot prove it is not looping, so no auto-reload (and no crash)', () => {
    const restore = blockStorage();
    try {
      render(<ProductDetailError error={chunkErr()} reset={jest.fn()} />);
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /product unavailable/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
