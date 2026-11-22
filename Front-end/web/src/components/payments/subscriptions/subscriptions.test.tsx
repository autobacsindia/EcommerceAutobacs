/**
 * Payments → Subscriptions & dues screens. The server decides who may do what;
 * these check that the screens ask it the right things and show what it says:
 *   - the list asks for the chosen quick filter / team / search, soonest due first
 *   - a team (no `teams`) gets no team filter; accounts does
 *   - only the buttons in `can` are shown (staff: no Verify; someone else's item: no Edit / Delete)
 *   - the form refuses a card that is not 4 digits and a card number typed in notes, before sending
 *   - an edit sends only what changed, with the version on screen; editing a verified
 *     item's amount warns that it goes back for check
 *   - delete says the record is kept, and sends the version on screen
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubscriptionList from './SubscriptionList';
import SubscriptionForm from './SubscriptionForm';
import SubscriptionDetail from './SubscriptionDetail';
import { looksLikeCardNumber, type BillCycle, type Subscription } from './api';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const item = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1', number: 'SD-0001', name: 'Railway', purpose: 'Hosts the backend', team: 'developer', teamLabel: 'Developer',
  kind: 'monthly', kindLabel: 'Monthly subscription', amount: 20, variableAmount: false, currency: 'USD', approxInr: 1760,
  dueDate: '2026-12-02', dueInDays: 30, overdue: false,
  payment: { method: 'card', methodLabel: 'Card', cardLast4: '4007', autoDebit: true },
  billingUrl: 'https://railway.com/account/billing', notes: '', files: [],
  status: 'pending', statusLabel: 'Waiting for check', rejectReason: '', verifiedByName: '', verifiedAt: null,
  addedBy: 'u1', addedByName: 'Dev', archived: false, rev: 3, createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z',
  history: [{ at: '2026-11-01T05:00:00Z', byName: 'Dev', role: 'developer', action: 'added', note: '' }],
  current: null,
  can: { edit: true, delete: true, verify: false, reject: false, markPaid: false },
  ...over,
});

const OPTIONS = {
  kinds: [{ value: 'monthly', label: 'Monthly subscription' }, { value: 'yearly', label: 'Yearly subscription' }, { value: 'one_time', label: 'One-time purchase' }],
  methods: [{ value: 'card', label: 'Card' }, { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', label: 'Bank transfer' }],
  currencies: [{ code: 'INR', label: 'Indian rupee', approxInrPerUnit: 1 }, { code: 'USD', label: 'US dollar', approxInrPerUnit: 88 }],
  baseCurrency: 'INR', teams: [], team: 'developer', canCheck: false,
  paidVia: [{ value: 'card', label: 'Card' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank transfer' }, { value: 'auto_debit', label: 'Auto-debit' }],
  markPaidFromDays: 3,
};

let fetchMock: jest.Mock;
let current: Subscription;
let months: { month: string; bills: number; rupees: number; unpriced: number }[];
beforeEach(() => {
  months = [];
  addressBar.reset('/team/payments');
  current = item();
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/subscription-dues/options') return Promise.resolve({ options: OPTIONS });
    if (url.startsWith('/subscription-dues/s1')) return Promise.resolve({ item: current });
    if (url.startsWith('/subscription-dues/monthly')) return Promise.resolve({ months });
    return Promise.resolve({ items: [current], nextCursor: null, summary: { count: 1, capped: false } });
  });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ item: current }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const lastList = () => {
  const urls = get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/subscription-dues?'));
  return Object.fromEntries(new URLSearchParams(urls[urls.length - 1].split('?')[1]));
};
// The receipt reader may ask whether it is on first: the save is the call to the API path.
const saveCall = () => fetchMock.mock.calls.find((c) => !String(c[0]).includes('/slip-reader/'));
const sentForm = () => (saveCall() ?? fetchMock.mock.calls[0])[1].body as FormData;

describe('the list', () => {
  it('shows each item with its due day, money (rough rupees as a label) and status', async () => {
    wrap(<SubscriptionList />);
    const row = await screen.findByRole('button', { name: /Railway/ });
    expect(row).toHaveTextContent('2 Dec 2026 · Due in 30 days');
    expect(row).toHaveTextContent('USD 20/month');
    expect(row).toHaveTextContent('about ₹1,760');
    expect(row).toHaveTextContent('Card 4007 · auto-debit');
    expect(row).toHaveTextContent('Waiting for check');
    expect(lastList()).toEqual({});
  });

  it('quick filters ask the server for due-in-7-days, overdue and waiting for check', async () => {
    wrap(<SubscriptionList />);
    await screen.findByRole('button', { name: /Railway/ });
    fireEvent.click(screen.getByRole('button', { name: 'Due in 7 days' }));
    await waitFor(() => expect(lastList()).toEqual({ due: 'week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    await waitFor(() => expect(lastList()).toEqual({ due: 'overdue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waiting for check' }));
    await waitFor(() => expect(lastList()).toEqual({ status: 'pending' }));
  });

  it('a team gets no team filter; accounts does, and it goes to the server', async () => {
    const { unmount } = wrap(<SubscriptionList />);
    await screen.findByRole('button', { name: /Railway/ });
    expect(screen.queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument();
    unmount();
    wrap(<SubscriptionList teams={[{ value: 'developer', label: 'Developer' }, { value: 'marketing', label: 'Marketing' }]} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Team' }), { target: { value: 'marketing' } });
    await waitFor(() => expect(lastList()).toEqual({ team: 'marketing' }));
  });

  it('an empty list says how to start', async () => {
    get.mockImplementation((url: string) => (url === '/subscription-dues/options'
      ? Promise.resolve({ options: OPTIONS })
      : Promise.resolve({ items: [], nextCursor: null, summary: { count: 0, capped: false } })));
    wrap(<SubscriptionList />);
    expect(await screen.findByText(/No subscriptions yet/)).toBeInTheDocument();
  });

  it('marks an overdue item', async () => {
    current = item({ dueInDays: -3, overdue: true });
    wrap(<SubscriptionList />);
    expect(await screen.findByText(/Overdue by 3 days/)).toBeInTheDocument();
  });
});

describe('the form', () => {
  const fill = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

  async function renderAdd() {
    const onDone = jest.fn();
    wrap(<SubscriptionForm onCancel={jest.fn()} onDone={onDone} />);
    await screen.findByRole('option', { name: 'Yearly subscription' });
    fill('Name', 'Railway');
    fill(/What it.s for/, 'Hosts the backend');
    fill('Amount on the bill', '20');
    fill('Next due date', '2026-12-02');
    return onDone;
  }

  it('refuses a card that is not exactly 4 digits, without sending', async () => {
    await renderAdd();
    // The box keeps digits only, and at most 4.
    fill(/last 4 digits only/, '40a');
    expect(screen.getByLabelText(/last 4 digits only/)).toHaveValue('40');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/last 4 digits/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a card number typed in the notes, without sending', async () => {
    await renderAdd();
    fill(/last 4 digits only/, '4007');
    fill(/Notes/, 'card 4111 1111 1111 1111');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/full card number/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds one: sends every field, the card as its last 4 only, and shows a rough rupee guide', async () => {
    const onDone = await renderAdd();
    fill(/last 4 digits only/, '4007');
    fireEvent.click(screen.getByLabelText(/Auto-debit/));
    expect(screen.getByText(/about ₹1,760/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/subscription-dues');
    expect(init.method).toBe('POST');
    const form = sentForm();
    expect(form.get('name')).toBe('Railway');
    expect(form.get('amount')).toBe('20');
    expect(form.get('currency')).toBe('USD');
    expect(form.get('dueDate')).toBe('2026-12-02');
    expect(JSON.parse(String(form.get('payment')))).toEqual({ method: 'card', cardLast4: '4007', autoDebit: true });
    expect(form.get('rev')).toBeNull();
  });

  it('an edit sends only what changed, with the version on screen; a verified item warns it goes back for check', async () => {
    const verified = item({ status: 'verified', statusLabel: 'Verified', rev: 7 });
    wrap(<SubscriptionForm item={verified} onCancel={jest.fn()} onDone={jest.fn()} />);
    await screen.findByRole('option', { name: 'Yearly subscription' });
    fill(/Notes/, 'new note');
    expect(screen.queryByText(/sends it back to accounts/)).not.toBeInTheDocument();
    fill('Amount on the bill', '25');
    expect(screen.getByText(/sends it back to accounts to check again/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/subscription-dues/s1');
    expect(init.method).toBe('PUT');
    expect([...sentForm().keys()].sort()).toEqual(['amount', 'notes', 'rev']);
    expect(sentForm().get('rev')).toBe('7');
  });

  it('shows the server’s refusal', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Someone has just changed this item. Refresh to see the latest, then try again.' }) });
    wrap(<SubscriptionForm item={item()} onCancel={jest.fn()} onDone={jest.fn()} />);
    await screen.findByRole('option', { name: 'Yearly subscription' });
    fill(/Notes/, 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Someone has just changed this item/);
  });
});

describe('the detail', () => {
  it('a staff member on their own item: Edit and Delete, no Verify / Reject', async () => {
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: /Railway · SD-0001/ });
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('someone else’s item: no buttons at all', async () => {
    current = item({ can: { edit: false, delete: false, verify: false, reject: false, markPaid: false } });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: /Railway/ });
    expect(screen.queryByRole('button', { name: /Edit|Delete|Verify|Reject/ })).not.toBeInTheDocument();
  });

  it('accounts verifies with the version on screen', async () => {
    current = item({ can: { edit: true, delete: true, verify: true, reject: true, markPaid: false } });
    post.mockResolvedValue({ item: { ...current, status: 'verified' } });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/subscription-dues/s1/verify', { rev: 3 }));
  });

  it('shows a rejected item’s reason to the team', async () => {
    current = item({ status: 'rejected', statusLabel: 'Rejected', rejectReason: 'It is $25 now' });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    expect(await screen.findByText(/It is \$25 now/)).toBeInTheDocument();
  });

  it('delete says the record is kept, and archives with the version on screen', async () => {
    const onClose = jest.fn();
    post.mockResolvedValue({ item: { ...current, archived: true } });
    wrap(<SubscriptionDetail id="s1" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    expect(screen.getByText(/record and its history are kept/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Why delete it/), { target: { value: 'Stopped using it' } });
    const panel = screen.getByRole('complementary', { name: 'Subscription' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/subscription-dues/s1/archive', { rev: 3, reason: 'Stopped using it' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('usage-based bills (amount varies)', () => {
  const fill = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
  const atlas = (over: Partial<Subscription> = {}) => item({
    name: 'MongoDB Atlas', amount: 100, variableAmount: true, status: 'verified', statusLabel: 'Verified', dueDate: '2026-11-30',
    can: { edit: true, delete: true, verify: false, reject: false, markPaid: true }, cycles: [], ...over,
  });

  it('the list shows the amount as an estimate; a fixed one is unchanged', async () => {
    current = atlas();
    wrap(<SubscriptionList />);
    const row = await screen.findByRole('button', { name: /MongoDB Atlas/ });
    expect(row).toHaveTextContent('~USD 100/month (estimate)');
  });

  it('ticking "Amount varies" makes the amount an estimate and sends it; one-time hides the box', async () => {
    const onDone = jest.fn();
    wrap(<SubscriptionForm onCancel={jest.fn()} onDone={onDone} />);
    await screen.findByRole('option', { name: 'Yearly subscription' });
    fireEvent.click(screen.getByLabelText(/Amount varies/));
    expect(screen.queryByLabelText('Amount on the bill')).not.toBeInTheDocument();
    fill('Name', 'MongoDB Atlas');
    fill(/What it.s for/, 'The database');
    fill('Next due date', '2026-11-30');
    fill(/last 4 digits only/, '4007');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/estimated amount/);
    fill('Estimated amount', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentForm().get('variableAmount')).toBe('true');
    expect(sentForm().get('amount')).toBe('100');

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'one_time' } });
    expect(screen.queryByLabelText(/Amount varies/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount on the bill')).toBeInTheDocument();
  });

  it('a fixed item has no bills yet: no history', async () => {
    current = item({ status: 'verified', statusLabel: 'Verified', cycles: [] });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: /Railway/ });
    expect(screen.queryByRole('button', { name: /Mark paid/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Bills paid')).not.toBeInTheDocument();
  });

  it('a usage-based bill needs its actual amount and invoice before it is sent', async () => {
    current = atlas();
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Mark paid/ }));
    fill(/Rupees charged/, '9500');
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/actual amount/);
    fill(/Actual amount/, '112');
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Attach the invoice/);
    expect(fetchMock).not.toHaveBeenCalled();

    const file = new File(['%PDF-1.4'], 'nov.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(saveCall()).toBeDefined());
    const [url, init] = saveCall()!;
    expect(url).toBe('/api/v1/subscription-dues/s1/mark-paid');
    expect(init.method).toBe('POST');
    expect(sentForm().get('amount')).toBe('112');
    expect(sentForm().get('rupees')).toBe('9500');
    expect(sentForm().get('rev')).toBe('3');
    expect(sentForm().get('paidVia')).toBe('auto_debit');
    expect(sentForm().getAll('invoice')).toHaveLength(1);
  });

  it('shows the paid history, newest first, actual beside the estimate', async () => {
    const cycle = (id: string, dueDate: string, amount: number) => ({
      id, dueDate, amount, currency: 'USD', estimate: 100, approxInr: null, rupees: null, state: 'paid' as const, stateLabel: 'Paid',
      expense: null, alreadyPaid: false, paidVia: '' as const, paidViaLabel: '', paidOn: '', reference: '', amountReason: '', rejectReason: '',
      note: '', paidByName: 'Anu', paidAt: '2026-11-01T05:00:00Z',
      invoices: [{ id: `f${id}`, name: 'inv.pdf', contentType: 'application/pdf', bytes: 9 }],
    });
    current = atlas({ cycles: [cycle('1', '2026-10-31', 95), cycle('2', '2026-11-30', 112), cycle('3', '2026-12-31', 104)] });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    const list = await screen.findByRole('list', { name: 'Bills paid' });
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toMatch(/Dec 2026.*USD 104.*estimate USD 100.*Paid/);
    expect(rows[1]).toMatch(/Nov 2026.*USD 112/);
    expect(rows[2]).toMatch(/Oct 2026.*USD 95/);
    expect(within(list).getAllByRole('link', { name: /Invoice/ })[0]).toHaveAttribute('href', '/api/v1/subscription-dues/s1/files/f3');
  });
});

describe('mark paid → expense', () => {
  const fill = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
  const rent = (over: Partial<Subscription> = {}) => item({
    name: 'Office rent', amount: 50000, currency: 'INR', approxInr: null, status: 'verified', statusLabel: 'Verified',
    dueInDays: 1, payment: { method: 'bank_transfer', methodLabel: 'Bank transfer', cardLast4: '', autoDebit: false },
    can: { edit: true, delete: true, verify: false, reject: false, markPaid: true }, cycles: [], ...over,
  });
  const cycle = (over: Partial<BillCycle> = {}): BillCycle => ({
    id: 'c1', dueDate: '2026-12-02', amount: 50000, currency: 'INR', estimate: 50000, approxInr: null, rupees: 50000,
    state: 'waiting', stateLabel: 'Waiting for accounts', expense: { id: 'e1', number: 'PR-0912' }, alreadyPaid: true,
    paidVia: 'bank', paidViaLabel: 'Bank transfer', paidOn: '2026-12-01', reference: 'UTR1', amountReason: '', rejectReason: '',
    note: '', paidByName: 'Dev', paidAt: '2026-12-01T05:00:00Z', invoices: [], ...over,
  } as BillCycle);

  it('is filled from the item; sends paid-already details, the version and the receipt — not the amount', async () => {
    current = rent();
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Mark paid/ }));
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('50000');
    expect(screen.getByLabelText('How was it paid?')).toHaveValue('bank');
    expect(screen.queryByLabelText(/Rupees charged/)).not.toBeInTheDocument();
    fill(/Reference/, 'UTR123');
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const f = sentForm();
    expect(f.get('alreadyPaid')).toBe('true');
    expect(f.get('paidVia')).toBe('bank');
    expect(f.get('reference')).toBe('UTR123');
    expect(f.get('paidOn')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The server takes the fixed amount from the item: nothing to tamper with.
    expect(f.get('amount')).toBeNull();
  });

  it('a different amount needs a reason; "not paid yet" sends no payment details', async () => {
    current = rent();
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Mark paid/ }));
    fill(/^Amount/, '51200');
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/say why/);
    fill(/Why is it different/, 'Late fee');
    fireEvent.click(screen.getByLabelText(/Not paid yet/));
    expect(screen.queryByLabelText('How was it paid?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const f = sentForm();
    expect(f.get('alreadyPaid')).toBe('false');
    expect(f.get('amount')).toBe('51200');
    expect(f.get('amountReason')).toBe('Late fee');
    expect(f.get('paidVia')).toBeNull();
  });

  it('a double click sends once', async () => {
    current = rent();
    let finish: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((r) => { finish = r; }));
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Mark paid/ }));
    const send = screen.getByRole('button', { name: 'Send to accounts' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish({ ok: true, json: async () => ({ item: current }) });
  });

  it('waiting for accounts: shows the expense, no Mark paid; rejected: shows why and offers it again', async () => {
    current = rent({ current: cycle(), can: { edit: true, delete: true, verify: false, reject: false, markPaid: false } });
    const { unmount } = wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    const status = await screen.findByText(/Waiting for accounts/, { selector: 'strong' });
    expect(status.closest('[role="status"]')).toHaveTextContent(/PR-0912/);
    expect(screen.queryByRole('button', { name: /Mark paid/ })).not.toBeInTheDocument();
    unmount();

    current = rent({ current: cycle({ state: 'rejected', stateLabel: 'Rejected', rejectReason: 'Wrong UTR' }) });
    wrap(<SubscriptionDetail id="s1" onClose={jest.fn()} />);
    expect(await screen.findByText(/“Wrong UTR” — fix it and mark it paid again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark paid/ })).toBeInTheDocument();
  });

  it('the list shows "Mark paid" when due, the cycle state once marked, and the monthly totals', async () => {
    months = [{ month: '2026-11', bills: 3, rupees: 54700, unpriced: 1 }];
    current = rent({ overdue: true, dueInDays: -2 });
    const { unmount } = wrap(<SubscriptionList />);
    const row = await screen.findByRole('button', { name: /Office rent/ });
    expect(row).toHaveTextContent('Mark paid');
    expect(row.className).toMatch(/border-red-500/);
    const totals = await screen.findByRole('region', { name: 'Paid per month' });
    expect(totals).toHaveTextContent(/Nov 2026.*₹54,700.*3 bills · 1 without rupees yet/);
    unmount();

    current = rent({ current: cycle(), can: { edit: true, delete: true, verify: false, reject: false, markPaid: false } });
    wrap(<SubscriptionList />);
    expect(await screen.findByRole('button', { name: /Office rent/ })).toHaveTextContent('Waiting for accounts');
  });
});

describe('looksLikeCardNumber (same rule as the server)', () => {
  it.each(['4111111111111111', '4111 1111 1111 1111', '378282246310005'])('flags %s', (t) => expect(looksLikeCardNumber(t)).toBe(true));
  it.each(['4007', '+91 98765 43210', '4111 1111 1111 1112', ''])('leaves %s alone', (t) => expect(looksLikeCardNumber(t)).toBe(false));
});
