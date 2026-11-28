/**
 * B2B / B2C on GTM orders (owner 2026-11-25).
 *
 * What must hold on screen (the server enforces the same rules on its own):
 *   - a new quotation must be marked B2B or B2C before it is saved
 *   - B2B: company name + GSTIN sent as an enterprise buyer; staff may set a B2B
 *     price on each item (owner 2026-11-28), but there is no discount on the total
 *   - B2C: offers and the discount work as before, sent as an individual buyer
 *   - accounts / admin see the badge with the server's reason, approve with a note,
 *     and B2C says "Ship before payment: not available — retail (B2C) order"
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import SalesTypeBadge from './SalesTypeBadge';
import OrderPayLater from '@/components/payments/payLater/OrderPayLater';
import SalesTypeChecks from '@/components/payments/payLater/SalesTypeChecks';
import type { SalesTypeInfo } from './types';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const fill = (labelText: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

const PRODUCT = { id: 'p1', name: 'Dash cam', image: '', price: 5000, available: true, variants: [] };

function fillCustomer() {
  fill(/^Name$/, 'Rohit Shah');
  fill(/Mobile/, '9876543210');
  fill(/House name \/ flat/, 'Flat 4B'); fill(/Street \/ Area/, '12 MG Road');
  fill(/^City$/, 'Pune');
  fill(/^State$/, 'Maharashtra');
  fill(/^PIN code/, '411001');
}
async function addDashCam() {
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'Dash' } });
  fireEvent.click(await screen.findByRole('button', { name: /^Add · / }));
}

const B2C: SalesTypeInfo = {
  type: 'b2c', label: 'B2C', reason: 'Retail order — offer applied: 10% off (Black Friday).',
  shipBeforePayment: 'not_b2c', company: null, check: { status: 'pending', type: 'b2c', byName: null, role: null, at: null, note: '' },
};
const B2B: SalesTypeInfo = {
  type: 'b2b', label: 'B2B', reason: 'Business order — no discount on the total. Ship before payment once accounts approves.',
  shipBeforePayment: 'needs_check', company: { legalName: 'ABC Motors Pvt Ltd', gstin: '32AAACA1234A1Z5' },
  check: { status: 'pending', type: 'b2b', byName: null, role: null, at: null, note: '' },
};

beforeEach(() => {
  get.mockReset().mockImplementation((url: string) => Promise.resolve(url.startsWith('/staff/sales/products') ? { products: [PRODUCT] } : {}));
  post.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
  put.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
  push.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('the quotation form', () => {
  it('will not save until GTM picks B2B or B2C', async () => {
    wrap(<NewSalesOrderForm />);
    fillCustomer();
    await addDashCam();
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose B2B/);
    expect(post).not.toHaveBeenCalled();
  });

  it('B2B: company + GSTIN sent, B2B price editable and sent, no discount section', async () => {
    wrap(<NewSalesOrderForm />);
    fireEvent.click(screen.getByRole('radio', { name: /B2B — business/ }));
    fill(/Company name/, 'ABC Motors Pvt Ltd');
    fill(/^GSTIN$/, '32aaaca1234a1z5');
    fillCustomer();
    await addDashCam();
    const price = screen.getByLabelText(/B2B price for Dash cam/);
    expect(price).toBeEnabled();
    fill(/B2B price for Dash cam/, '4250');
    expect(screen.getByText(/B2B price · saves/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Discount %')).toBeNull();
    expect(screen.getByText(/B2B order: no discount on the total/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.buyer).toEqual({
      type: 'enterprise', legalName: 'ABC Motors Pvt Ltd', gstin: '32AAACA1234A1Z5',
      billingAddress: { addressLine1: 'Flat 4B, 12 MG Road', addressLine2: '', city: 'Pune', postalCode: '411001' },
    });
    expect(body.discount).toBeNull();
    expect(body.items[0].offerPrice).toBe(4250);
  });

  it('B2B with no price typed sends no offer price (the catalogue price applies)', async () => {
    wrap(<NewSalesOrderForm />);
    fireEvent.click(screen.getByRole('radio', { name: /B2B — business/ }));
    fill(/Company name/, 'ABC Motors Pvt Ltd');
    fill(/^GSTIN$/, '32aaaca1234a1z5');
    fillCustomer();
    await addDashCam();
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].items[0].offerPrice).toBeNull();
  });

  it('switching to B2B keeps the item price typed but clears the discount on the total', async () => {
    wrap(<NewSalesOrderForm />);
    fireEvent.click(screen.getByRole('radio', { name: /B2C — retail/ }));
    fillCustomer();
    await addDashCam();
    fill(/Offer price for Dash cam/, '4500');
    fill('Discount %', '5');
    fireEvent.click(screen.getByRole('radio', { name: /B2B — business/ }));
    expect(screen.getByLabelText(/B2B price for Dash cam/)).toHaveValue('4500');
    fireEvent.click(screen.getByRole('radio', { name: /B2C — retail/ }));
    expect(screen.getByLabelText('Discount %')).toHaveValue('');
  });

  it('B2B needs the GSTIN', async () => {
    wrap(<NewSalesOrderForm />);
    fireEvent.click(screen.getByRole('radio', { name: /B2B — business/ }));
    fill(/Company name/, 'ABC Motors Pvt Ltd');
    expect(screen.getByLabelText(/^GSTIN$/)).toBeRequired();
    fill(/^GSTIN$/, '32AAAC');
    fillCustomer();
    await addDashCam();
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/15-character GSTIN/);
    expect(post).not.toHaveBeenCalled();
  });

  it('B2C: offers and the discount go as before, as an individual buyer', async () => {
    wrap(<NewSalesOrderForm />);
    fireEvent.click(screen.getByRole('radio', { name: /B2C — retail/ }));
    fillCustomer();
    await addDashCam();
    fill(/Offer price for Dash cam/, '4500');
    fill('Discount %', '10');
    fill(/^Reason/, 'Black Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.buyer).toEqual({ type: 'individual' });
    expect(body.discount).toEqual({ percent: 10, reason: 'Black Friday' });
    expect(body.items[0].offerPrice).toBe(4500);
  });

  it('editing a B2B quotation starts as B2B with its company', () => {
    wrap(<NewSalesOrderForm quotation={{
      id: 'q1', number: 'QT-1', version: 1, status: 'open',
      customer: { name: 'Rohit', email: '', phone: '9876543210' },
      shippingAddress: { addressLine1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' },
      items: [], subtotal: 0, discount: null, totalAmount: 0, notes: '', validUntil: '2026-12-01T00:00:00.000Z',
      salesPerson: 'Asha', orderId: null, createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', revisions: [], hold: null,
      buyer: { type: 'enterprise', legalName: 'ABC Motors Pvt Ltd', gstin: '32AAACA1234A1Z5', billingAddress: { addressLine1: '12 MG Road', city: 'Pune', postalCode: '411001' } },
    } as never} />);
    expect(screen.getByRole('radio', { name: /B2B — business/ })).toBeChecked();
    expect(screen.getByLabelText(/Company name/)).toHaveValue('ABC Motors Pvt Ltd');
  });
});

describe('what accounts and the admin see', () => {
  it('B2C badge: the reason the server gives, and ship before payment not available', () => {
    render(<SalesTypeBadge info={B2C} detail />);
    expect(screen.getByText('B2C')).toBeInTheDocument();
    expect(screen.getByText(/offer applied: 10% off \(Black Friday\)/)).toBeInTheDocument();
    expect(screen.getByText('Ship before payment: not available — retail (B2C) order.')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for accounts to approve B2C/)).toBeInTheDocument();
  });

  it('B2B badge: company, GSTIN and who approved with what note', () => {
    render(<SalesTypeBadge info={{ ...B2B, shipBeforePayment: 'allowed', check: { status: 'approved', type: 'b2b', byName: 'Meera', role: 'accounts', at: '2026-11-25T06:00:00.000Z', note: 'GSTIN checked' } }} detail />);
    expect(screen.getByText('B2B')).toBeInTheDocument();
    expect(screen.getByText(/ABC Motors Pvt Ltd · GSTIN 32AAACA1234A1Z5/)).toBeInTheDocument();
    expect(screen.getByText(/approved by Meera.*GSTIN checked/)).toBeInTheDocument();
  });

  it('order page: badge, approve with a note, then ship-before-payment reason', async () => {
    get.mockResolvedValue({ canApprove: false, why: 'Accounts must first approve this order as B2B (with a note).', dueDays: 3, salesType: B2B });
    post.mockResolvedValue({ order: {} });
    wrap(<OrderPayLater orderId="o1" />);
    expect(await screen.findByText(/Business order — no discount on the total/)).toBeInTheDocument();
    expect(screen.getByText(/Accounts must first approve this order as B2B/)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve as B2B' });
    expect(approve).toBeDisabled();
    fill(/Note \(accounts\)/, 'GSTIN checked');
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/orders/o1/sales-type-check', { note: 'GSTIN checked' }));
  });

  it('order page, B2C: says not available once, offers no ship-before-payment button', async () => {
    get.mockResolvedValue({ canApprove: false, why: 'Ship before payment: not available — retail (B2C) order.', dueDays: 3, salesType: { ...B2C, check: null } });
    wrap(<OrderPayLater orderId="o1" />);
    expect(await screen.findByText(/Retail order — offer applied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ship before payment/ })).toBeNull();
    expect(screen.queryByText(/not available — Ship before payment/)).toBeNull();
  });

  it('accounts list: each order with its badge and an approve-with-note form', async () => {
    get.mockResolvedValue({
      canCheck: true, nextCursor: null,
      orders: [{ id: 'o1', orderNumber: '#AB12', createdAt: '2026-11-25T06:00:00.000Z', status: 'awaiting_payment', paymentStatus: 'pending', amount: 9000,
        customer: { name: 'Ravi', phone: '98200', city: 'Pune' }, salesPerson: 'Asha', bankTransferPending: false, salesType: B2C, payLater: null }],
    });
    wrap(<SalesTypeChecks view="check" />);
    const row = (await screen.findByText(/#AB12/)).closest('li') as HTMLElement;
    expect(within(row).getByText('B2C')).toBeInTheDocument();
    expect(within(row).getByText(/Black Friday/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Approve as B2C' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/sales-type-checks?view=check');
  });

  it('GTM head (read-only): no approve form', async () => {
    get.mockResolvedValue({ canCheck: false, nextCursor: null, orders: [{ id: 'o1', orderNumber: '#AB12', createdAt: '2026-11-25T06:00:00.000Z', status: 'awaiting_payment', paymentStatus: 'pending', amount: 9000,
      customer: { name: 'Ravi', phone: '98200', city: 'Pune' }, salesPerson: 'Asha', bankTransferPending: false, salesType: B2C, payLater: null }] });
    wrap(<SalesTypeChecks view="check" />);
    await screen.findByText(/#AB12/);
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});
