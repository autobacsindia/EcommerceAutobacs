/**
 * Company revenue page: shows the server's figures as they are, switches period,
 * uploads the Zoho export, and settles held-back bills.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompanyRevenuePage from './CompanyRevenuePage';

const get = jest.fn();
const patch = jest.fn();
const post = jest.fn();
const postForm = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: (...a: unknown[]) => post(...a) },
}));
jest.mock('@/lib/postForm', () => ({ postForm: (...a: unknown[]) => postForm(...a) }));

const summary = (label: string, total: number) => ({
  period: { kind: label === 'All time' ? 'all' : 'fy', label, startDate: null },
  basis: 'incl_gst',
  revenue: {
    total,
    website: { total: 6193000, extraCharges: 0, bySource: { web: { total: 3000000, count: 100 }, woocommerce: { total: 2000000, count: 70 }, offline: { total: 1193000, count: 32 } } },
    zoho: { total: total - 6193000 - 1450000, exGst: 7500000, creditNotes: 817600, unpaid: 3120000, count: 116 },
    unbilled: { total: 1450000, count: 2, zoho: 200000, manual: 1250000, needsCheck: { count: 1, total: 12000 } },
  },
  sales: { total: 306, website: { total: 74, delivered: 35, shipped: 30, processing: 9 }, zoho: 232, zohoCancelled: 12, unbilled: 2 },
  ordersFulfilled: { total: 267, website: 35, zoho: 232 },
  zohoMatched: { linked: { count: 128, total: 3310000 }, needsCheck: { count: 1, total: 4000 } },
  months: [{ month: '2026-04', website: 500000, zoho: 1300000, unbilled: 200000, total: 2000000, sales: 25, ordersFulfilled: 20, needsCheck: 1 }],
  lastImport: { at: '2026-11-23T10:00:00Z', byName: 'Owner' },
});
const heldBack = {
  _id: 'inv1', invoiceNumber: 'AUTO/26-27/0007', invoiceDate: '2026-09-10T00:00:00Z', status: 'closed', customerName: 'Ravi',
  total: 4000, subTotal: 3389.83, balance: 0,
  match: { state: 'needs_check', by: 'auto', reason: 'Same customer, smaller than a panel order (part billed?)',
    order: { _id: '64b000000000000012345678', totalAmount: 10000, createdAt: '2026-09-01T00:00:00Z', status: 'delivered', shippingAddress: { fullName: 'Ravi Kumar' } } },
};

const arun = {
  _id: 'u1', source: 'manual', receivedAt: '2026-11-12T00:00:00Z', customerName: 'Arun', amount: 1250000,
  proof: 'https://app.clickup.com/t/abc', note: 'Phase 2 balance', state: 'open', stateBy: 'admin', addedByName: 'Owner',
};
const lookalike = {
  _id: 'u2', source: 'zoho_payment', paymentNumber: '612', receivedAt: '2026-10-02T00:00:00Z', customerName: 'Meena', amount: 12000,
  paymentTotal: 12000, proof: 'javascript:alert(1)', state: 'needs_check', stateBy: 'auto', reason: 'Same customer and amount',
  order: { _id: '64b000000000000087654321', totalAmount: 12000, createdAt: '2026-10-01T00:00:00Z', status: 'delivered', shippingAddress: { fullName: 'Meena' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url.startsWith('/admin/revenue?period=all')) return Promise.resolve({ summary: summary('All time', 20000000) });
    if (url.startsWith('/admin/revenue?')) return Promise.resolve({ summary: summary('FY 26-27', 14943696) });
    if (url.startsWith('/admin/revenue/sales')) {
      return Promise.resolve({
        sales: url.includes('source=zoho')
          ? [{ _id: 'z1', kind: 'zoho', source: 'zoho', date: '2026-10-02T00:00:00Z', amount: 0, gross: 50000, credited: 50000, status: 'cancelled_by_credit_note', name: 'Fleet Co', number: 'AUTO/26-27/0200' }]
          : [{ _id: '64b000000000000012345678', kind: 'order', source: 'web', date: '2026-10-01T00:00:00Z', amount: 10000, status: 'shipped', name: 'Ravi' }],
        nextCursor: null,
      });
    }
    if (url.startsWith('/admin/revenue/zoho-invoices')) return Promise.resolve({ invoices: [heldBack], nextCursor: null });
    if (url.startsWith('/admin/revenue/unbilled')) {
      return Promise.resolve({ receipts: url.includes('state=needs_check') ? [lookalike] : [arun], nextCursor: null });
    }
    return Promise.reject(new Error(url));
  });
});

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CompanyRevenuePage /></QueryClientProvider>,
);

it('shows the total, the split and orders fulfilled from the server', async () => {
  wrap();
  expect(await screen.findByText('₹1.49 Cr')).toBeInTheDocument();
  expect(screen.getByText(/Zoho Books bills ₹73 L · Website orders not yet in Zoho ₹61.9 L/)).toBeInTheDocument();
  expect(screen.getByText('306')).toBeInTheDocument();
  expect(screen.getByText(/232 billed in Zoho · 74 website orders not yet in Zoho \(35 delivered, 39 on the way\)/)).toBeInTheDocument();
  expect(screen.getByText(/12 Zoho bill\(s\) cancelled by credit note/)).toBeInTheDocument();
  expect(screen.getByText('Apr 2026')).toBeInTheDocument();
  expect(screen.getByText(/probably website orders — please check \(1\)/)).toBeInTheDocument();
});

it('switches to all time', async () => {
  wrap();
  await screen.findByText('₹1.49 Cr');
  fireEvent.click(screen.getByRole('button', { name: 'All time' }));
  expect(await screen.findByText('₹2.00 Cr')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/revenue?period=all');
});

it('uploads the Zoho CSV and reports what was imported', async () => {
  postForm.mockResolvedValue({ result: { kind: 'invoices', batchId: 'b', inserted: 244, updated: 0, skipped: { draft: 29, void: 2 }, errors: [], rematched: 244, creditsUnmatched: 0 } });
  wrap();
  const file = new File(['x'], 'invoices.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Zoho CSV file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Bills: 244 new, 0 updated. Left out: 29 draft, 2 void.');
  expect(postForm.mock.calls[0][0]).toBe('/admin/revenue/zoho-import');
  expect((postForm.mock.calls[0][1] as FormData).get('file')).toBe(file);
});

it('settles a held-back bill as a separate sale', async () => {
  patch.mockResolvedValue({ success: true });
  wrap();
  expect(await screen.findByText(/Looks like AB-12345678/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Separate sale/ }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/revenue/zoho-invoices/inv1', { decision: 'different' }));
});

it('lists every sale and filters by source', async () => {
  wrap();
  expect(await screen.findByRole('link', { name: 'AB-12345678' })).toHaveAttribute('href', '/admin/orders/64b000000000000012345678');
  fireEvent.click(screen.getByRole('button', { name: 'Zoho (store & B2B)' }));
  expect(await screen.findByText('Cancelled (credit note)')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/revenue/sales?period=fy&source=zoho');
});

describe('Paid, no sale bill yet', () => {
  it('shows it in the total breakdown, the sales count and the months, and lists the entries', async () => {
    wrap();
    expect(await screen.findByRole('link', { name: /Paid, no sale bill yet ₹14.5 L/ })).toHaveAttribute('href', '#unbilled');
    expect(screen.getByText(/1 to check, not counted/)).toBeInTheDocument();
    expect(screen.getByText(/2 paid, no sale bill yet/)).toBeInTheDocument();
    expect(screen.getByText('₹2,00,000.00')).toBeInTheDocument();
    expect(await screen.findByText(/Arun · ₹12,50,000/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://app.clickup.com/t/abc' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a non-web proof is shown as text, never as a link; a look-alike can be settled', async () => {
    patch.mockResolvedValue({ success: true });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'To check' }));
    expect(await screen.findByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Same as that order' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/revenue/unbilled/u2', { decision: 'same_as_panel' }));
  });

  it('"now billed" asks for the Zoho invoice number', async () => {
    patch.mockResolvedValue({ success: true });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Now billed in Zoho' }));
    fireEvent.change(screen.getByLabelText('Zoho invoice number'), { target: { value: ' AUTO/26-27/0301 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/revenue/unbilled/u1', { decision: 'billed', invoiceNumber: 'AUTO/26-27/0301' }));
  });

  it('adds a paid sale without a bill, and shows the server refusal', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('400'), { rawData: { message: 'The date cannot be in the future.' } })).mockResolvedValueOnce({ success: true });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Add paid sale without bill' }));
    const form = screen.getByRole('form', { name: 'Add paid sale without bill' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Suresh' } });
    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: '90000' } });
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Proof'), { target: { value: 'Quote QT-000123' } });
    fireEvent.submit(form);
    expect(await screen.findByText('The date cannot be in the future.')).toBeInTheDocument();
    fireEvent.submit(form);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith('/admin/revenue/unbilled', {
      customerName: 'Suresh', amount: 90000, receivedAt: '2026-11-01', mode: null, proof: 'Quote QT-000123', note: null,
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add paid sale without bill' })).toBeNull());
  });
});

it('reports a paid-sales sheet upload', async () => {
  postForm.mockResolvedValue({ result: { kind: 'paid_sales', inserted: 3, updated: 0, skipped: { draft: 0, void: 0 }, errors: ['Line 5 (CU-X): Add proof — skipped.'], rematched: 0, creditsUnmatched: 0 } });
  wrap();
  fireEvent.change(screen.getByLabelText('Zoho CSV file'), { target: { files: [new File(['x'], 'paid-sales.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Paid sales without bill: 3 new, 0 updated.');
  expect(screen.getByText('Line 5 (CU-X): Add proof — skipped.')).toBeInTheDocument();
});
