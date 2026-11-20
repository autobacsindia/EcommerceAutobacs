/**
 * Procurement records, accounts approves (owner, 2026-11-20):
 *   - "Supplier refunded" on the order (ClaimProgress): procurement records a part or
 *     all of the money back, with how / reference / proof; the order then shows
 *     "Refunded ₹X on <date>" and what is still to come back — numbers from the server
 *   - accounts sees no "Supplier refunded" button (canRecordRefund false)
 *   - a declined refund shows why
 *   - the supplier change history shows accounts' review; accounts gets Approve /
 *     Reject (reject needs a reason); procurement gets no buttons
 *   - "Waiting for your approval" lists payments, supplier credit and supplier
 *     changes, and its buttons go to the server
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClaimProgress } from './SupplierCredit';
import ApprovalsInbox from './ApprovalsInbox';
import { SupplierChanges } from '@/components/staff/work/SupplierParts';
import type { SupplierPart } from '@/components/staff/work/types';
import type { CreditEntry } from './credit';
import type { SupplierRefundClaim } from './api';

const get = jest.fn();
const post = jest.fn();
// Slip reading has its own tests (slipReader.test.tsx); here it is off, so the forms behave as before.
jest.mock('./slipReaderStatus', () => ({ slipReaderEnabled: () => Promise.resolve(false), resetSlipReaderForTests: () => {} }));
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: jest.fn() },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'X-XSRF-TOKEN': 't' }) },
}));
jest.mock('./PaymentRequestDetail', () => ({ __esModule: true, default: () => <div data-testid="detail" /> }));
jest.mock('./PaymentRequestForm', () => ({ __esModule: true, default: () => null }));

const fetchMock = jest.fn();
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const entry = (over: Partial<CreditEntry>): CreditEntry => ({
  id: 'e1', kind: 'repaid', kindLabel: 'Supplier paid back', status: 'approved', statusLabel: 'Approved',
  supplier: { id: 's1', name: 'G S Enterprises' }, currency: 'INR', amount: 1000, signedAmount: -1000, amountText: '₹1,000',
  order: { id: 'o1', number: '#C96938BD' }, paymentRequest: { id: 'r1', number: 'PR-0088' }, date: '2026-11-22', reference: 'UTR998877',
  note: '', method: 'upi', methodLabel: 'UPI', files: [], createdByName: 'Aromal S', createdAt: '2026-11-22T05:00:00Z',
  decidedByName: 'Fathima KA', decidedAt: '2026-11-22T06:00:00Z', decisionNote: '', history: [], rev: 0, correctionOf: null,
  correctedAmount: null, correctedAmountText: '', correctionPending: false, edits: [],
  can: { approve: false, decline: false, cancel: false, edit: false }, ...over,
});
const claim = (over: Partial<SupplierRefundClaim> = {}): SupplierRefundClaim => ({
  id: 'c1', status: 'approved', amount: 2065, currency: 'INR', refunded: 0, refundPending: 0, left: 2065, refunds: [], canRecordRefund: true, ...over,
});

describe('Supplier refunded — on the order', () => {
  it('procurement records a part refund with how, reference and proof; it is sent once to the server', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, entry: entry({ status: 'pending' }) }) });
    wrap(<ClaimProgress requestId="r1" claim={claim()} />);
    expect(screen.getByText(/Supplier must refund ₹2,065 · approved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Supplier refunded' }));
    const form = screen.getByRole('form', { name: 'Supplier refunded' });
    expect(within(form).getByText(/At most ₹2,065 is still to come back/)).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/Amount/), { target: { value: '1000' } });
    fireEvent.change(within(form).getByLabelText('How'), { target: { value: 'bank' } });
    fireEvent.change(within(form).getByLabelText('UTR / reference'), { target: { value: 'NEFT55' } });
    const file = new File(['x'], 'upi.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Proof'), { target: { files: [file] } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/suppliers/credit/order-refunds');
    const body = init.body as FormData;
    expect(body.get('paymentRequestId')).toBe('r1');
    expect(body.get('amount')).toBe('1000');
    expect(body.get('method')).toBe('bank');
    expect(body.get('reference')).toBe('NEFT55');
    expect(String(body.get('formKey')).length).toBeGreaterThanOrEqual(8);
    expect((body.get('proof') as File).name).toBe('upi.jpg');
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Supplier refunded' })).not.toBeInTheDocument());
  });

  it('shows "Refunded ₹X on <date>", what is waiting and what is left — the server numbers', () => {
    wrap(<ClaimProgress requestId="r1" claim={claim({
      refunded: 1000, refundPending: 500, left: 565,
      refunds: [entry({}), entry({ id: 'e2', amount: 500, status: 'pending', decidedByName: '', reference: 'UTR2' })],
    })} />);
    const list = screen.getByRole('list', { name: 'Refunds from the supplier' });
    expect(within(list).getByText(/Refunded ₹1,000 on 22 Nov 2026/)).toBeInTheDocument();
    expect(within(list).getByText(/approved by Fathima KA/)).toBeInTheDocument();
    expect(within(list).getByText(/recorded by Aromal S/)).toBeInTheDocument();
    expect(screen.getByText(/₹565 still to come back/)).toBeInTheDocument();
    expect(screen.getByText(/₹500 waiting for accounts/)).toBeInTheDocument();
  });

  it('a declined refund shows why; fully refunded shows no button', () => {
    wrap(<ClaimProgress requestId="r1" claim={claim({
      refunded: 2065, left: 0, canRecordRefund: false,
      refunds: [entry({ id: 'x', status: 'declined', amount: 2065, decisionNote: 'UTR not in the bank statement' }), entry({ id: 'y', amount: 2065 })],
    })} />);
    expect(screen.getByText(/Why: UTR not in the bank statement/)).toBeInTheDocument();
    expect(screen.getByText('Fully refunded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier refunded' })).not.toBeInTheDocument();
  });

  it('accounts gets no "Supplier refunded" button', () => {
    wrap(<ClaimProgress requestId="r1" claim={claim({ canRecordRefund: false })} />);
    expect(screen.queryByRole('button', { name: 'Supplier refunded' })).not.toBeInTheDocument();
  });

  it('the server refusing an over-refund is shown, the form stays open', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Only ₹2,065 is still to come back on PR-0088 — a refund cannot be more than that.' }) });
    wrap(<ClaimProgress requestId="r1" claim={claim()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier refunded' }));
    const form = screen.getByRole('form', { name: 'Supplier refunded' });
    fireEvent.change(within(form).getByLabelText('UTR / reference'), { target: { value: 'UTR1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send to accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only ₹2,065 is still to come back/);
    expect(screen.getByRole('form', { name: 'Supplier refunded' })).toBeInTheDocument();
  });
});

const part = (over: Partial<SupplierPart>): SupplierPart => ({
  id: 'p1', what: '', supplierName: 'G S Enterprises', status: 'replaced', state: 'replaced', paymentRef: '', orderedAt: null,
  createdAt: null, createdByName: '', replacedAt: '2026-11-20T05:00:00Z', replacedByName: 'Aromal S', replacedWith: 'p2', replaces: null,
  reasonCode: 'late', reason: "Supplier can't deliver on time", review: { status: 'pending', byName: '', at: null, note: '' }, ...over,
});
const now = part({ id: 'p2', supplierName: 'India Motor Stores', status: 'active', state: 'to_order', replacedWith: null, review: null });

describe('Supplier changes — accounts review', () => {
  it('accounts: Approve sends approve; Reject needs a reason', () => {
    const onReview = jest.fn();
    const prompt = jest.spyOn(window, 'prompt');
    wrap(<SupplierChanges parts={[part({}), now]} onReview={onReview} />);
    expect(screen.getByText('Waiting for accounts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve change' }));
    expect(onReview).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }), 'approve', '');
    prompt.mockReturnValueOnce('');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    prompt.mockReturnValueOnce('Ask GS first');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReview).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }), 'reject', 'Ask GS first');
    prompt.mockRestore();
  });

  it('procurement (no onReview) sees the state, no buttons; a rejection shows who and why', () => {
    wrap(<SupplierChanges parts={[part({ review: { status: 'rejected', byName: 'Fathima KA', at: '2026-11-20T07:00:00Z', note: 'Ask GS first' } }), now]} />);
    expect(screen.getByText(/Rejected by Fathima KA/)).toBeInTheDocument();
    expect(screen.getByText('Why: Ask GS first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve change' })).not.toBeInTheDocument();
  });
});

describe('Waiting for your approval', () => {
  const request = {
    id: 'r9', number: 'PR-0128', kind: 'supplier', status: 'submitted', statusLabel: 'Waiting', team: 'procurement', teamLabel: 'Procurement',
    requestedBy: 'Aromal S', amount: 4280, currency: 'INR', category: 'supplier', description: '', payee: { name: 'India Motor Stores', method: 'bank' },
    order: { id: 'o1', number: '#C96938BD' }, itemNames: ['Jerry Can 20L'], createdAt: '2026-11-20T05:00:00Z',
    can: { approve: true, decline: true, pay: false, hold: false, cancel: false },
  };
  const change = {
    orderId: 'o1', orderNumber: '#C96938BD', itemId: 'i1', itemName: 'Jerry Can 20L', partId: 'p1', what: '',
    from: 'G S Enterprises', to: 'India Motor Stores', reason: "Supplier can't deliver on time", changedByName: 'Aromal S',
    changedAt: '2026-11-20T05:00:00Z', can: { review: true },
  };
  beforeEach(() => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/payment-requests')) return Promise.resolve({ requests: [request], nextCursor: null, summary: { count: 1, total: 4280, capped: false } });
      if (url.startsWith('/suppliers/credit/pending')) return Promise.resolve({ entries: [entry({ status: 'pending', can: { approve: true, decline: true, cancel: false, edit: false } })], nextAfter: null });
      if (url.startsWith('/staff/work/supplier-changes/pending')) return Promise.resolve({ changes: [change], nextAfter: null });
      return Promise.reject(new Error(url));
    });
    post.mockResolvedValue({});
  });

  it('lists all three kinds; each button goes to the server; reject needs a reason', async () => {
    const prompt = jest.spyOn(window, 'prompt');
    wrap(<ApprovalsInbox />);
    const payments = await screen.findByRole('region', { name: 'Payments & expenses' });
    expect(await within(payments).findByText(/PR-0128 · Supplier payment · ₹4,280 to India Motor Stores/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/payment-requests?status=submitted');
    fireEvent.click(within(payments).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r9/approve', { note: '' }));

    const credit = screen.getByRole('region', { name: 'Supplier refunds & credit' });
    const row = await within(credit).findByRole('listitem', { name: 'Supplier paid back ₹1,000' });
    expect(row).toHaveTextContent(/G S Enterprises · Supplier paid back/);
    expect(row).toHaveTextContent(/by UPI · ref UTR998877/);
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    const changes = screen.getByRole('region', { name: 'Supplier changes' });
    expect(await within(changes).findByText('India Motor Stores')).toBeInTheDocument();
    prompt.mockReturnValueOnce('no');
    fireEvent.click(within(changes).getByRole('button', { name: 'Reject' }));
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining('/review'), expect.anything());
    prompt.mockReturnValueOnce('Ask GS first');
    fireEvent.click(within(changes).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/parts/p1/review', { decision: 'reject', note: 'Ask GS first' }));
    prompt.mockRestore();
  });

  it('nothing waiting: says so; a row someone may not review has no buttons', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/payment-requests')) return Promise.resolve({ requests: [], nextCursor: null, summary: { count: 0, total: 0, capped: false } });
      if (url.startsWith('/suppliers/credit/pending')) return Promise.resolve({ entries: [], nextAfter: null });
      return Promise.resolve({ changes: [{ ...change, can: { review: false } }], nextAfter: null });
    });
    wrap(<ApprovalsInbox />);
    const changes = await screen.findByRole('region', { name: 'Supplier changes' });
    expect(await within(changes).findByText('India Motor Stores')).toBeInTheDocument();
    expect(within(changes).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(await screen.findAllByText('Nothing waiting.')).toHaveLength(2);
  });
});
