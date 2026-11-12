/**
 * "Above 10%: prior approval mandatory" in the panel: the quotation screen hides
 * the PDF / WhatsApp / accept buttons until approved, the seller asks with a reason,
 * and the approver approves or rejects (a note is needed to reject). The server
 * decides who may approve; the panel only sends the click with the prices it saw.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuotationDetail from './QuotationDetail';
import type { Quotation, QuotationApproval } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('./CustomerBankCard', () => ({ __esModule: true, default: () => null }));

const approval = (over: Partial<QuotationApproval> = {}): QuotationApproval => ({
  state: 'needed', threshold: 10, percent: 12, maxLinePercent: 0, totalPercent: 12, priceKey: 'k1',
  reason: null, requestedByName: null, requestedAt: null, decidedByName: null, decidedAt: null, note: null, ...over,
});
const quote = (a: QuotationApproval): Quotation => ({
  id: 'q1', number: 'QT-1', version: 1, status: 'open', customer: { name: 'Rohit', email: '', phone: '9820917286' },
  shippingAddress: null as unknown as Quotation['shippingAddress'],
  items: [{ product: null, variantId: null, variantLabel: null, custom: true, name: 'Installation', image: '', quantity: 1, price: 10000, listPrice: null }],
  subtotal: 10000, discount: { percent: 12, amount: 1200, reason: 'Fleet', byName: 'Asha', at: null }, totalAmount: 8800,
  notes: '', validUntil: '2026-12-01T00:00:00Z', salesPerson: 'Asha', orderId: null, createdAt: '', updatedAt: '', revisions: [],
  hold: null, approval: a,
});
const show = (a: QuotationApproval) => {
  get.mockResolvedValue({ quotation: quote(a) });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QuotationDetail id="q1" /></QueryClientProvider>);
};

beforeEach(() => { get.mockReset(); post.mockReset(); post.mockResolvedValue({}); });

it('above 10%: no PDF, WhatsApp or accept — and "Request approval" sends the reason', async () => {
  show(approval());
  expect(await screen.findByText(/Needs approval — 12% off the website price/)).toBeInTheDocument();
  expect(screen.queryByText('Quotation PDF')).toBeNull();
  expect(screen.queryByText('Share on WhatsApp')).toBeNull();
  expect(screen.queryByText(/Client accepted/)).toBeNull();
  const ask = screen.getByRole('button', { name: 'Request approval' });
  expect(ask).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Why does this customer/), { target: { value: 'Fleet, 6 cars' } });
  fireEvent.click(ask);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/quotations/q1/approval/request', { reason: 'Fleet, 6 cars' }));
});

it('pending, for the approver: approve sends the price key; reject needs a note', async () => {
  show(approval({ state: 'pending', reason: 'Fleet', requestedByName: 'Asha', canDecide: true }));
  expect(await screen.findByText(/Waiting for approval — asked by Asha/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Reject/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/quotations/q1/approval/decide', { decision: 'approve', note: '', priceKey: 'k1' }));
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Max 8%' } });
  fireEvent.click(screen.getByRole('button', { name: /Reject/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/quotations/q1/approval/decide', { decision: 'reject', note: 'Max 8%', priceKey: 'k1' }));
});

it('pending, for the seller: no approve buttons, still no accept', async () => {
  show(approval({ state: 'pending', reason: 'Fleet', requestedByName: 'Asha', canDecide: false }));
  await screen.findByText(/Waiting for approval/);
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  expect(screen.queryByText(/Client accepted/)).toBeNull();
});

it('approved: says who approved, and the PDF and accept are back', async () => {
  show(approval({ state: 'approved', decidedByName: 'Vikram', note: 'OK' }));
  expect(await screen.findByText(/Discount approved/)).toBeInTheDocument();
  expect(screen.getByText(/By Vikram/)).toBeInTheDocument();
  expect(screen.getByText('Quotation PDF')).toBeInTheDocument();
  expect(screen.getByText(/Client accepted/)).toBeInTheDocument();
});

it('10% or less: exactly as before, no approval box', async () => {
  show(approval({ state: 'not_needed', percent: 10, priceKey: null }));
  expect(await screen.findByText('Quotation PDF')).toBeInTheDocument();
  expect(screen.queryByText(/Needs approval/)).toBeNull();
  expect(screen.queryByText(/Discount approved/)).toBeNull();
});
