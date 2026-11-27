import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '@/lib/api';
import WebsiteErrorsPage from './WebsiteErrorsPage';

/**
 * The "Website errors" panel page: lists what the API returns, opens a detail view,
 * and shows Mark resolved only when the API says this person may (admin / developer).
 * Status is never flipped optimistically — it re-reads after saving.
 */

jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn() } }));
let pathname = '/team/site-errors';
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

const api = apiClient as unknown as { get: jest.Mock; patch: jest.Mock };

const row = {
  _id: 'e1', feature: 'careers', step: 'file-upload', level: 'error', name: 'Error',
  message: 'Upload failed: HTTP 403', path: '/careers', count: 7,
  firstSeenAt: '2026-11-23T10:00:00Z', lastSeenAt: '2026-11-26T10:00:00Z', status: 'open',
};
const detail = {
  ...row, lastRelease: 'abc123',
  samples: [{ at: '2026-11-26T10:00:00Z', url: '/careers', browser: 'Chrome 131', os: 'Android 14', device: 'mobile', release: 'abc123', user: null, orderId: '65a1b2c3d4e5f60718293a4b', context: { slot: 'videoOne', httpStatus: '403' }, stack: 'Error: x\n at y' }],
};

function mockApi(canResolve: boolean, status = 'open') {
  api.get.mockImplementation(async (url: string) => (url.startsWith('/client-errors?')
    ? { errors: [{ ...row, status }], nextCursor: null, features: ['payment', 'checkout', 'careers'], canResolve }
    : { error: { ...detail, status }, canResolve }));
}

beforeEach(() => { api.get.mockReset(); api.patch.mockReset(); pathname = '/team/site-errors'; });

it('lists grouped errors with plain-English steps and counts, open first', async () => {
  mockApi(true);
  render(<WebsiteErrorsPage />);
  expect(await screen.findByText('A file failed to upload')).toBeInTheDocument();
  expect(screen.getByText('Upload failed: HTTP 403')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/client-errors?status=open');
});

it('detail shows samples, context and stack; developer can mark resolved (server-confirmed)', async () => {
  mockApi(true);
  render(<WebsiteErrorsPage />);
  fireEvent.click(await screen.findByText('A file failed to upload'));
  expect(await screen.findByText(/Chrome 131 · Android 14 · mobile/)).toBeInTheDocument();
  expect(screen.getByText(/slot: videoOne · httpStatus: 403/)).toBeInTheDocument();
  // Developer panel has no order screen: the id is shown, not linked.
  expect(screen.queryByRole('link', { name: /293a4b/ })).toBeNull();
  api.patch.mockResolvedValue({});
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'PR 700' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/client-errors/e1/status', { status: 'resolved', note: 'PR 700' }));
  // Re-read after saving, never flipped locally.
  await waitFor(() => expect(api.get.mock.calls.filter(([u]) => u === '/client-errors/e1').length).toBeGreaterThanOrEqual(2));
});

it('marketing is read only and links the order to its own order screen', async () => {
  pathname = '/team/marketing/site-errors';
  mockApi(false);
  render(<WebsiteErrorsPage />);
  fireEvent.click(await screen.findByText('A file failed to upload'));
  expect(await screen.findByText(/Chrome 131/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark resolved' })).toBeNull();
  expect(screen.getByRole('link', { name: '18293a4b' })).toHaveAttribute('href', '/team/marketing/orders/65a1b2c3d4e5f60718293a4b');
});

it('shows the API error instead of an empty list', async () => {
  api.get.mockRejectedValue(new Error('Not authorized'));
  render(<WebsiteErrorsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized');
});
