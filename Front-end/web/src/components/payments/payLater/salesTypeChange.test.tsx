/**
 * Changing B2B ↔ B2C after accounts' check (owner 2026-11-26).
 *
 * What must hold on screen (the server enforces the same rules on its own):
 *   - accounts sees "Change to B2C…" / "Change to B2B…" with a required reason
 *   - to B2B also asks company name + GSTIN + billing address
 *   - before the click it says what happens to "Ship before payment"
 *   - when the server says no, the button is replaced by its reason
 *   - every change shows in the order view, newest first, with who / when / why
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderPayLater from './OrderPayLater';
import SalesTypeChecks from './SalesTypeChecks';
import type { SalesTypeInfo } from '@/components/staff/sales/types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const fill = (labelText: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

const B2B: SalesTypeInfo = {
  type: 'b2b', label: 'B2B', reason: 'Business order — no offers. Ship before payment allowed.',
  shipBeforePayment: 'allowed', company: { legalName: 'ABC Motors Pvt Ltd', gstin: '27AAPFU0939F1ZV' },
  check: { status: 'approved', type: 'b2b', byName: 'Meera', role: 'accounts', at: '2026-11-25T06:00:00.000Z', note: 'GSTIN checked', changes: [] },
};

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('change B2B ↔ B2C', () => {
  it('B2B → B2C: reason required, warns that ship before payment is taken back, sends to + reason only', async () => {
    get.mockResolvedValue({ canApprove: false, dueDays: 3, salesType: B2B, typeChange: { to: 'b2c', toLabel: 'B2C', allowed: true, why: null, payLaterEffect: 'withdrawn' } });
    post.mockResolvedValue({ order: {}, unchanged: false });
    wrap(<OrderPayLater orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change to B2C…' }));
    expect(screen.getByText(/taken back: the order will wait for payment again/)).toBeInTheDocument();
    const yes = screen.getByRole('button', { name: 'Yes, change to B2C' });
    expect(yes).toBeDisabled();
    fill(/Why are you changing it/, 'Customer buys for personal use');
    fireEvent.click(yes);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/orders/o1/sales-type-change', { to: 'b2c', reason: 'Customer buys for personal use' }));
  });

  it('B2C → B2B: needs company, GSTIN and billing address', async () => {
    const b2c: SalesTypeInfo = { ...B2B, type: 'b2c', label: 'B2C', reason: 'Retail order — no offer applied.', shipBeforePayment: 'not_b2c', company: null };
    get.mockResolvedValue({ canApprove: false, dueDays: 3, salesType: b2c, typeChange: { to: 'b2b', toLabel: 'B2B', allowed: true, why: null, payLaterEffect: 'none' } });
    post.mockResolvedValue({ order: {}, unchanged: false });
    wrap(<OrderPayLater orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change to B2B…' }));
    fill(/Why are you changing it/, 'Dealer, gave GSTIN');
    const yes = screen.getByRole('button', { name: 'Yes, change to B2B' });
    expect(yes).toBeDisabled();
    fill(/Company name/, 'ABC Motors Pvt Ltd');
    fill(/^GSTIN$/, '27aapfu0939f1zv');
    fill(/^Billing address$/, 'Suman Heights');
    fill(/Billing city/, 'Navi Mumbai');
    fill(/Billing PIN code/, '400706');
    fireEvent.click(yes);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/orders/o1/sales-type-change', {
      to: 'b2b', reason: 'Dealer, gave GSTIN',
      buyer: { legalName: 'ABC Motors Pvt Ltd', gstin: '27AAPFU0939F1ZV', billingAddress: { addressLine1: 'Suman Heights', city: 'Navi Mumbai', postalCode: '400706' } },
    }));
  });

  it('server says no: the reason instead of a button; errors are shown', async () => {
    get.mockResolvedValue({ canApprove: false, dueDays: 3, salesType: B2B,
      typeChange: { to: 'b2c', toLabel: 'B2C', allowed: false, why: 'The receipt has already been emailed to the customer with this type, so it cannot be changed now.', payLaterEffect: 'none' } });
    wrap(<OrderPayLater orderId="o1" />);
    expect(await screen.findByText(/Change to B2C: not possible — The receipt has already been emailed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change to/ })).toBeNull();
  });

  it('history: every change, newest first, with who / why / what happened; red alert shown', async () => {
    const info: SalesTypeInfo = {
      ...B2B, type: 'b2c', label: 'B2C', company: null, shipBeforePayment: 'not_b2c',
      alert: 'Changed to B2C after it was shipped without payment. The customer still has to pay — follow up.',
      check: { ...B2B.check!, changes: [
        { at: '2026-11-26T08:00:00.000Z', byName: 'Owner', role: 'admin', from: 'b2b', to: 'b2c', fromLabel: 'B2B', toLabel: 'B2C', reason: 'Retail after all',
          payLaterEffect: 'kept_shipped_unpaid', payLaterNote: 'Already shipped without payment, so ship before payment was left running. The admin was told.' },
        { at: '2026-11-25T08:00:00.000Z', byName: 'Meera', role: 'accounts', from: 'b2c', to: 'b2b', fromLabel: 'B2C', toLabel: 'B2B', reason: 'Dealer', payLaterEffect: 'none', payLaterNote: null },
      ] },
    };
    get.mockResolvedValue({ canApprove: false, dueDays: 3, salesType: info, typeChange: null });
    wrap(<OrderPayLater orderId="o1" />);
    const list = await screen.findByRole('list', { name: 'Type changes' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/B2B → B2C by Owner.*Retail after all/);
    expect(items[0]).toHaveTextContent(/left running/);
    expect(items[1]).toHaveTextContent(/B2C → B2B by Meera.*Dealer/);
    expect(screen.getByRole('alert')).toHaveTextContent(/shipped without payment/);
    expect(screen.getByText(/First approved by Meera/)).toBeInTheDocument();
  });

  it('accounts list "approved": each row offers the change; GTM head gets none', async () => {
    const row = { id: 'o1', orderNumber: '#AB12', createdAt: '2026-11-25T06:00:00.000Z', status: 'awaiting_payment', paymentStatus: 'pending', amount: 9000,
      customer: { name: 'Ravi', phone: '98200', city: 'Pune' }, salesPerson: 'Asha', bankTransferPending: false, salesType: B2B, payLater: null,
      typeChange: { to: 'b2c', toLabel: 'B2C', allowed: true, why: null, payLaterEffect: 'none' } };
    get.mockResolvedValue({ canCheck: true, nextCursor: null, orders: [row] });
    const { unmount } = wrap(<SalesTypeChecks view="approved" />);
    const li = (await screen.findByText(/#AB12/)).closest('li') as HTMLElement;
    expect(within(li).getByRole('button', { name: 'Change to B2C…' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/sales-type-checks?view=approved');
    unmount();
    get.mockResolvedValue({ canCheck: false, nextCursor: null, orders: [row] });
    wrap(<SalesTypeChecks view="approved" />);
    await screen.findByText(/#AB12/);
    expect(screen.queryByRole('button', { name: /Change to/ })).toBeNull();
  });
});
