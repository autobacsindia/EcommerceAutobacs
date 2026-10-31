/** Pop-up check: who has no browser (first), who is failing, who works — from GET /push/devices. */
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PopUpCheckPage from './page';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const device = (over: object) => ({
  id: 'd', device: 'Chrome on Mac', addedAt: '2026-10-01T05:00:00Z', lastSeenAt: '2026-10-28T05:00:00Z',
  lastWorkedAt: '2026-10-28T06:00:00Z', failures: 0, lastError: '', health: 'working', ...over,
});
const body = {
  configured: true, staleDays: 60, truncated: false,
  people: [
    { id: 'p1', name: 'Priya Nair', team: 'Procurement', isHead: true, devices: [device({ id: 'd1' }), device({ id: 'd2', device: 'Chrome on Android', health: 'untested', lastWorkedAt: null })] },
    { id: 'p2', name: 'Arun Kumar', team: 'Procurement', isHead: false, devices: [device({ id: 'd3', device: 'Edge on Windows', health: 'failing', failures: 2, lastError: '403 credentials do not match' })] },
    { id: 'p3', name: 'Bala S', team: 'Procurement', isHead: false, devices: [] },
  ],
};

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PopUpCheckPage />
  </QueryClientProvider>,
);

beforeEach(() => { get.mockReset().mockResolvedValue(body); });

it('counts working, failing and never-turned-on people, and lists the never-on first', async () => {
  renderPage();
  expect(await screen.findByText('people with a working browser')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/push/devices');
  const rows = screen.getAllByRole('listitem').filter((li) => li.querySelector('p.font-semibold'));
  expect(rows[0]).toHaveTextContent('Bala S');
  expect(within(rows[0]).getByText(/No browser — pop-ups were never turned on, or not for 60 days/)).toBeInTheDocument();
});

it('shows each browser with its health and why a failing one fails', async () => {
  renderPage();
  expect(await screen.findByText('Edge on Windows')).toBeInTheDocument();
  expect(screen.getByText(/Refused 2 times in a row \(403 credentials do not match\)/)).toBeInTheDocument();
  expect(screen.getByText('Not tested yet')).toBeInTheDocument();
  expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
  expect(screen.getByText('Priya Nair')).toBeInTheDocument();
});

it('says so when the server has no push keys, and when the list cannot load', async () => {
  get.mockResolvedValueOnce({ ...body, configured: false });
  const { unmount } = renderPage();
  expect(await screen.findByText(/not set up on the server/)).toBeInTheDocument();
  unmount();
  get.mockRejectedValueOnce(new Error('down'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load/);
});
