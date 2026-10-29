/**
 * Quotation % discount and editing after the client accepted (sales panel).
 *
 * What must hold:
 *   - the form sends ONLY the percent and the reason — never an amount or a total;
 *     its preview uses the server's rule (whole rupees, half-up)
 *   - a discount needs a reason; 100% and 3-decimal percents are stopped before saving
 *   - editing an accepted quotation says what will happen, and asks "checked they
 *     have not paid" when the customer has bank / QR details
 *   - the quotation page shows who gave the discount and why, and offers Edit only
 *     when the server says the accepted quotation can still change
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import QuotationDetail from './QuotationDetail';
import QuoteDiscountSummary from './QuoteDiscountSummary';
import { discountRuleProblem, previewDiscount, type Quotation } from './types';

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
// The bank-details card fetches on its own; it is not what these tests are about.
jest.mock('./CustomerBankCard', () => ({ __esModule: true, default: () => null }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const fill = (labelText: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

function fillCustomer() {
  fill(/^Name$/, 'Rohit Shah');
  fill(/Mobile/, '9876543210');
  fill(/House \/ street/, '12 MG Road');
  fill(/^City$/, 'Pune');
  fill(/^State$/, 'Maharashtra');
  fill(/PIN code/, '411001');
}
async function addLabour(price: string) {
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'Installation' } });
  fireEvent.click(await screen.findByRole('button', { name: /Add .Installation. as a custom item/ }));
  fireEvent.change(screen.getByLabelText(/Price for Installation/), { target: { value: price } });
}

const quotation = (over: Partial<Quotation> = {}): Quotation => ({
  id: 'q1', number: 'QT-AB12CD34', version: 1, status: 'open',
  customer: { name: 'Rohit Shah', email: '', phone: '9876543210' },
  shippingAddress: { addressLine1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' } as Quotation['shippingAddress'],
  items: [{ product: null, variantId: null, variantLabel: null, custom: true, name: 'Installation', image: '', quantity: 1, price: 10000, listPrice: null }],
  subtotal: 10000, discount: null, totalAmount: 10000, notes: '', validUntil: '2026-11-05T10:00:00.000Z',
  salesPerson: 'Asha', orderId: null, createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z',
  revisions: [], hold: null,
  ...over,
});

beforeEach(() => {
  get.mockReset().mockResolvedValue({ products: [] });
  post.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
  put.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
  push.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('the rules the form checks before saving', () => {
  it('previews like the server: whole rupees, half-up', () => {
    expect(previewDiscount(11800, 5)).toEqual({ amount: 590, total: 11210 });
    expect(previewDiscount(11799, 5)).toEqual({ amount: 590, total: 11209 });
    expect(previewDiscount(11789, 5)).toEqual({ amount: 589, total: 11200 });
    expect(previewDiscount(1000, 0)).toEqual({ amount: 0, total: 1000 });
  });
  it('explains what is wrong', () => {
    expect(discountRuleProblem('', '')).toBe('');
    expect(discountRuleProblem('0', '')).toBe('');
    expect(discountRuleProblem('5', '')).toMatch(/reason/);
    expect(discountRuleProblem('5', 'Repeat customer')).toBe('');
    expect(discountRuleProblem('100', 'free')).toMatch(/less than 100%/);
    expect(discountRuleProblem('7.125', 'deal')).toMatch(/2 decimals/);
    expect(discountRuleProblem('abc', 'deal')).toMatch(/percentage/);
  });
});

describe('the quotation form', () => {
  it('sends only the percent and the reason, and previews the total', async () => {
    wrap(<NewSalesOrderForm />);
    fillCustomer();
    await addLabour('10000');
    fill('Discount %', '5');
    fill(/^Reason/, 'Repeat customer');
    expect(screen.getByText(/5% of ₹10,000/)).toHaveTextContent('−₹500 → customer pays ₹9,500');
    fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0];
    expect(body.discount).toEqual({ percent: 5, reason: 'Repeat customer' });
    expect(body).not.toHaveProperty('totalAmount');
    expect(body).not.toHaveProperty('subtotal');
    expect(body.discount).not.toHaveProperty('amount');
  });

  it('no discount → discount: null', async () => {
    wrap(<NewSalesOrderForm />);
    fillCustomer();
    await addLabour('10000');
    fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].discount).toBeNull();
  });

  it('a discount without a reason is stopped before saving', async () => {
    wrap(<NewSalesOrderForm />);
    fillCustomer();
    await addLabour('10000');
    fill('Discount %', '5');
    // The hint shows as soon as a percent is typed; the reason box is required.
    expect(screen.getByText('Write the reason for the discount.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason/)).toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
  });

  it('editing keeps the saved discount in the boxes', () => {
    wrap(<NewSalesOrderForm quotation={quotation({ discount: { percent: 2.5, amount: 250, reason: 'Diwali', byName: 'Asha', at: null }, totalAmount: 9750 })} />);
    expect(screen.getByLabelText('Discount %')).toHaveValue('2.5');
    expect(screen.getByLabelText(/^Reason/)).toHaveValue('Diwali');
  });
});

describe('editing a quotation the client accepted', () => {
  const accepted = (payDetailsShared: boolean) => quotation({
    status: 'accepted', orderId: 'o1', editAfterAccept: { allowed: true, reason: null, payDetailsShared },
  });

  it('says what will happen and asks before saving', async () => {
    wrap(<NewSalesOrderForm quotation={accepted(false)} />);
    expect(screen.getByRole('note')).toHaveTextContent(/cancels its unpaid order and every payment link/);
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save new version/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/already accepted/));
    expect(put.mock.calls[0][0]).toBe('/staff/sales/quotations/q1');
    expect(put.mock.calls[0][1]).not.toHaveProperty('confirmNotPaid');
  });

  it('with bank / QR details shared, needs the "not paid yet" tick', async () => {
    wrap(<NewSalesOrderForm quotation={accepted(true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Save new version/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm the customer has not paid/);
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /checked with them that they have not paid/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save new version/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1].confirmNotPaid).toBe(true);
  });

  it('nothing is sent when the seller says no to the warning', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    wrap(<NewSalesOrderForm quotation={accepted(false)} />);
    fireEvent.click(screen.getByRole('button', { name: /Save new version/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(put).not.toHaveBeenCalled();
  });
});

describe('the quotation page', () => {
  const discount = { percent: 5, amount: 500, reason: 'Repeat customer', byName: 'Asha', at: '2026-10-29T10:00:00.000Z' };

  it('shows the discount, who gave it and why', () => {
    render(<QuoteDiscountSummary subtotal={10000} discount={discount} total={9500} />);
    expect(screen.getByText('Discount 5%')).toBeInTheDocument();
    expect(screen.getByText('−₹500')).toBeInTheDocument();
    expect(screen.getByTestId('discount-giver')).toHaveTextContent('Given by Asha');
    expect(screen.getByText('Reason: Repeat customer')).toBeInTheDocument();
    expect(screen.getByText('₹9,500')).toBeInTheDocument();
  });

  it('without a discount it is just the total', () => {
    render(<QuoteDiscountSummary subtotal={10000} discount={null} total={10000} />);
    expect(screen.queryByText(/Subtotal/)).toBeNull();
    expect(screen.getByText('₹10,000')).toBeInTheDocument();
  });

  it('an accepted, unpaid quotation offers Edit; versions say who changed them', async () => {
    get.mockResolvedValue({
      quotation: quotation({
        status: 'accepted', orderId: 'o1', version: 2, number: 'QT-AB12CD34-v2', discount, subtotal: 10000, totalAmount: 9500,
        editAfterAccept: { allowed: true, reason: null, payDetailsShared: false },
        revisions: [{ version: 1, totalAmount: 12000, discount: null, savedAt: '2026-10-29T09:00:00.000Z', savedByName: 'Vikram', wasAccepted: true }],
      }),
    });
    wrap(<QuotationDetail id="q1" />);
    expect(await screen.findByRole('link', { name: /Edit quotation/ })).toHaveAttribute('href', '/team/sales/quotations/q1/edit');
    expect(screen.getByText(/had been accepted — its unpaid order was cancelled/)).toHaveTextContent(/by Vikram/);
    expect(screen.getByText('Reason: Repeat customer')).toBeInTheDocument();
  });

  it('an accepted quotation with money in says why it cannot be edited', async () => {
    get.mockResolvedValue({
      quotation: quotation({
        status: 'accepted', orderId: 'o1',
        editAfterAccept: { allowed: false, reason: 'Part of this order is already paid, so its quotation can no longer be changed.', payDetailsShared: false },
      }),
    });
    wrap(<QuotationDetail id="q1" />);
    expect(await screen.findByText(/already paid, so its quotation can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit quotation/ })).toBeNull();
  });
});
