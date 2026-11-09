import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import MetaLeadsList, { type MetaLead } from './MetaLeadsList';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn() } }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/team/meta-leads',
  useSearchParams: () => new URLSearchParams(),
}));

const api = apiClient as unknown as { get: jest.Mock; patch: jest.Mock };
const lead = (over: Partial<MetaLead> = {}): MetaLead => ({
  id: 'a1', tab: 'jimny suspension', rowNumber: 3, leadDate: '2026-11-08T03:51:17.000Z', dateRaw: '2026-11-07T22:51:17-05:00', dateHasTime: true,
  name: 'Asha', phone: '+919876543210', email: '', product: 'jimny form', campaign: 'camp', salesPerson: 'nevin', status: 'responded',
  followUp1: 'msgd', followUp2: '', revision: 0, ...over,
});
const page = (leads: MetaLead[], canEdit: boolean, sync: { lastSuccessAt: string | null; connected: boolean; stale: boolean } = { lastSuccessAt: '2026-11-09T04:00:00.000Z', connected: true, stale: false }) =>
  ({ leads, nextCursor: null, tabs: [{ name: 'jimny suspension', rows: 1 }], sync, you: { canEdit } });
const detail = (canEdit: boolean, extras = [{ label: 'your_car?', value: 'Jimny', readOnly: false }, { label: 'id', value: 'l:1', readOnly: true }]) =>
  ({ lead: { ...lead(), extras, edits: [] }, you: { canEdit } });

function mockApi(list: unknown, one: unknown = detail(true)) {
  api.get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/staff/meta-leads?') ? list : one));
}
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MetaLeadsList /></QueryClientProvider>,
);

beforeEach(() => jest.clearAllMocks());

test('shows the row in table columns, with the time in India', async () => {
  mockApi(page([lead()], true));
  show();
  const row = (await screen.findAllByTestId('meta-lead-row'))[0];
  expect(within(row).getByText('Asha')).toBeInTheDocument();
  expect(within(row).getByText('+919876543210')).toHaveAttribute('href', 'tel:+919876543210');
  expect(within(row).getByText(/8 Nov 2026.*9:21 am IST/i)).toBeInTheDocument();
  ['Date', 'Name', 'Phone', 'Tab', 'Sales person', 'Status', 'Follow-up 1', 'Follow-up 2'].forEach((h) =>
    expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument());
});

test('a blank date is a dash; an unreadable one shows as typed', async () => {
  mockApi(page([lead({ id: 'a', leadDate: null, dateRaw: '' }), lead({ id: 'b', leadDate: null, dateRaw: 'next monday' })], true));
  show();
  const rows = await screen.findAllByTestId('meta-lead-row');
  expect(within(rows[0]).getAllByText('—').length).toBeGreaterThan(0);
  expect(within(rows[1]).getByText('next monday')).toBeInTheDocument();
});

test('edit sends only what changed, with the version it was based on', async () => {
  mockApi(page([lead()], true));
  api.patch.mockResolvedValue({ lead: lead() });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  const status = await screen.findByLabelText('Status');
  fireEvent.change(status, { target: { value: 'called' } });
  fireEvent.change(screen.getByLabelText('your_car?'), { target: { value: 'Thar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/staff/meta-leads/a1', { revision: 0, changes: { status: 'called' }, extras: { 'your_car?': 'Thar' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test("Meta's own id can be read but not changed", async () => {
  mockApi(page([lead()], true));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  expect(await screen.findByLabelText('id')).toBeDisabled();
});

test('someone saved first: the message shows, the form reloads their version and stays open', async () => {
  mockApi(page([lead()], true));
  api.patch.mockRejectedValue(Object.assign(new Error('x'), { message: 'Someone else just changed this lead.', rawData: { outcome: 'changed' } }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'called' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('responded'));
});

test('view-only people get View and disabled fields, no Save', async () => {
  mockApi(page([lead()], false), detail(false));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'View Asha' }));
  expect(await screen.findByLabelText('Status')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});

test('a stopped feed warns, so "no new leads" is not believed', async () => {
  mockApi(page([lead()], true, { lastSuccessAt: '2026-11-09T04:00:00.000Z', connected: true, stale: true }));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not update from the sheet/);
});

test('not connected yet, and a load failure, each say so', async () => {
  mockApi(page([], true, { lastSuccessAt: null, connected: false, stale: true }));
  const { unmount } = show();
  expect(await screen.findByText(/not connected yet/)).toBeInTheDocument();
  unmount();
  api.get.mockRejectedValue(new Error('nope'));
  show();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
