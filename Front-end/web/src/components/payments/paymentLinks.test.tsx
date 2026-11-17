/**
 * Linking a payment to a project / other ID (the form and the detail) and the
 * admin's "Find by ID" lookup. The server decides everything; these check that
 * the screens send what it needs and show what it says.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import PaymentRequestDetail from './PaymentRequestDetail';
import LinkLookup, { type LookupResult } from './LinkLookup';
import type { ExpenseOptions, PaymentRequest } from './api';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn() },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const OPS: ExpenseOptions = {
  team: 'operations', baseCurrency: 'INR', currencies: [{ code: 'INR', label: 'Indian rupee (₹)' }],
  categories: [{ value: 'fuel', label: 'Fuel', noteRequired: false }],
};
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const base: PaymentRequest = {
  id: 'r1', number: 'PR-0007', kind: 'expense', status: 'paid', statusLabel: 'Paid',
  team: 'operations', teamLabel: 'Operations', requestedBy: 'Omar', amount: 1250, category: 'fuel', description: 'Diesel',
  payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuel@okaxis' }, order: null, itemNames: [], customer: null, closedBy: '',
  files: [], payment: null, decisionNote: '', createdAt: '2026-10-15T05:00:00Z', history: [],
  can: { approve: false, decline: false, pay: false, hold: false, cancel: false, linkProject: true },
};

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { ...base, status: 'submitted' } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('the expense form', () => {
  const fill = async () => {
    get.mockResolvedValue({ options: OPS });
    wrap(<PaymentRequestForm onDone={jest.fn()} />);
    await screen.findByRole('combobox', { name: 'What for' });
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '840' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Kerala Taxi' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'taxi@okicici' } });
  };

  it('sends the project ID and other ID typed, and one id for the form', async () => {
    await fill();
    fireEvent.change(screen.getByLabelText('Project ID (optional)'), { target: { value: ' prj-0007 ' } });
    fireEvent.change(screen.getByLabelText('Other ID (optional)'), { target: { value: 'INV-2231' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('project')).toBe('prj-0007');
    expect(form.get('reference')).toBe('INV-2231');
    expect(String(form.get('clientId'))).toMatch(/^[\w-]{8,64}$/);
  });

  it('both are optional: left empty, neither is sent; a retry after an error keeps the same id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Project PRJ-9999 was not found.' }) });
    await fill();
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByText('Project PRJ-9999 was not found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [a, b] = fetchMock.mock.calls.map((c) => c[1].body as FormData);
    expect(a.has('project')).toBe(false);
    expect(a.has('reference')).toBe(false);
    expect(a.get('clientId')).toBe(b.get('clientId'));
  });
});

describe('the detail', () => {
  it('shows the project and other ID, and changes them (even when paid)', async () => {
    get.mockResolvedValue({ request: { ...base, project: { id: 'p1', code: 'PRJ-0007', name: 'Diwali launch' }, reference: 'AWB 778' } });
    post.mockResolvedValue({ request: { ...base, project: { id: 'p2', code: 'PRJ-0012', name: 'Website' }, reference: '' } });
    wrap(<PaymentRequestDetail id="r1" onClose={jest.fn()} />);
    expect(await screen.findByText('PRJ-0007')).toBeInTheDocument();
    expect(screen.getByText('Diwali launch', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('AWB 778')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Change/ }));
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'PRJ-0012' } });
    fireEvent.change(screen.getByLabelText('Other ID'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r1/links', { project: 'PRJ-0012', reference: '' }));
    expect(await screen.findByText('PRJ-0012')).toBeInTheDocument();
  });

  it('shows the server’s refusal; nothing to change and no right to: no row at all', async () => {
    get.mockResolvedValue({ request: base });
    post.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'Project PRJ-0099 is deleted — restore it first to link to it.' } }));
    const { unmount } = wrap(<PaymentRequestDetail id="r1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Link project/ }));
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'PRJ-0099' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/deleted/);
    unmount();

    get.mockResolvedValue({ request: { ...base, can: { ...base.can, linkProject: false } } });
    wrap(<PaymentRequestDetail id="r1" onClose={jest.fn()} />);
    await screen.findByText('PR-0007', { exact: false });
    expect(screen.queryByText('Not linked to a project')).toBeNull();
  });
});

describe('paying', () => {
  it('sends the version of the figures on screen; a "changed" refusal reloads them', async () => {
    const waiting = { ...base, status: 'approved' as const, payVersion: 'v-old', can: { ...base.can, pay: true } };
    get.mockResolvedValueOnce({ request: waiting }).mockResolvedValue({ request: { ...waiting, amount: 9999, payVersion: 'v-new' } });
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'The amount or who is paid was changed since you opened this request. Check the new details, then pay again.' }) });
    wrap(<PaymentRequestDetail id="r1" onClose={jest.fn()} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Record payment' }));
    fireEvent.click(within(panel).getByRole('button', { name: /Mark as paid/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0][1].body as FormData).get('payVersion')).toBe('v-old');
    expect(await within(panel).findByText(/changed since you opened/)).toBeInTheDocument();
    // The new figures are fetched at once.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect((await within(panel).findAllByText('₹9,999')).length).toBeGreaterThan(0);
  });
});

describe('Find by ID', () => {
  const projectResult: LookupResult = {
    match: 'project', query: 'PRJ-0007',
    project: { id: 'p1', code: 'PRJ-0007', name: 'Diwali launch', statusLabel: 'On track', owner: { name: 'Meera' }, dueOn: null, archivedAt: null, progress: { total: 2, done: 1 } },
    tasks: {
      open: { items: [{ id: 't1', code: 'T-12', title: 'Book the hall', status: 'todo', bucket: 'open', dueOn: null, assignees: ['Omar'], order: null }], nextCursor: null },
      done: { items: [], nextCursor: null },
    },
    payments: {
      items: [{ id: 'r1', number: 'PR-0031', kind: 'expense', status: 'paid', team: 'operations', category: 'fuel', amount: 840, currency: 'INR', foreignAmount: null, payee: 'Kerala Taxi', requestedBy: 'Omar', order: null, project: null, reference: 'INV-2231', paidAt: null, createdAt: '2026-11-01T05:00:00Z' }],
      nextCursor: 'c1',
      totals: { paid: { count: 1, amount: 840 }, waiting: { count: 0, amount: 0 }, closed: { count: 0 } },
    },
    orders: [{ id: 'o1', number: '#AB12CD34', customer: 'Ravi Kumar', city: 'Kochi', total: 52000, status: 'shipped', paymentStatus: 'paid', createdAt: '2026-10-01T05:00:00Z',
      timeline: [{ status: 'processing', at: '2026-10-01T05:00:00Z' }, { status: 'shipped', at: '2026-10-03T05:00:00Z' }] }],
  };

  it('finds a project: its tasks, payments with totals, and linked orders with their timeline; pages more', async () => {
    get.mockImplementation(async (url: string) => (url.includes('cursor=c1')
      ? { payments: { items: [{ ...projectResult.payments!.items[0], id: 'r2', number: 'PR-0032' }], nextCursor: null } }
      : projectResult));
    const onSearch = jest.fn();
    wrap(<LinkLookup onSearch={onSearch} />);
    fireEvent.change(screen.getByLabelText(/Project ID, order number/), { target: { value: ' PRJ-0007 ' } });
    fireEvent.click(screen.getByRole('button', { name: /Find/ }));
    expect(onSearch).toHaveBeenCalledWith('PRJ-0007');
    const project = await screen.findByRole('region', { name: 'Project' });
    expect(within(project).getByRole('heading', { name: 'Diwali launch' })).toBeInTheDocument();
    expect(screen.getByText('Book the hall')).toBeInTheDocument();
    expect(screen.getByText(/Paid ₹840 \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Timeline of #AB12CD34' })).toHaveTextContent(/Processing.*Shipped/);
    expect(get).toHaveBeenCalledWith('/admin/lookup?q=PRJ-0007');
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(await screen.findByText('PR-0032')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admin/lookup?q=PRJ-0007&section=payments&cursor=c1');
  });

  it('says plainly when nothing matches, and lets you pick between several orders', async () => {
    get.mockResolvedValueOnce({ match: 'none', query: 'PRJ-9999', message: 'No project PRJ-9999.' });
    const { unmount } = wrap(<LinkLookup initial="PRJ-9999" />);
    expect(await screen.findByText('No project PRJ-9999.')).toBeInTheDocument();
    unmount();

    get.mockResolvedValueOnce({ match: 'orders', query: 'AB12', message: 'Several orders match — pick one.', orders: [
      { ...projectResult.orders![0] }, { ...projectResult.orders![0], id: 'o2', number: '#99AB12' },
    ] });
    get.mockResolvedValueOnce({ match: 'none', query: '#99AB12', message: 'x' });
    wrap(<LinkLookup initial="AB12" />);
    fireEvent.click(await screen.findByRole('button', { name: /#99AB12/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/admin/lookup?q=%2399AB12'));
  });
});
