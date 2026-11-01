/**
 * The search / filter / sort bars of the two supplier lists — "Supplier
 * payments, by supplier" (admin) and the supplier directory: what they ask the
 * server for, that they live in the page address, and the count line.
 * Paying and editing are in suppliers.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SupplierPayQueue from './SupplierPayQueue';
import SupplierDirectory from './SupplierDirectory';
import type { PayGroup, Supplier } from './suppliers';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() } }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const calls = (prefix: string) => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));
const lastQuery = (prefix: string) => {
  const list = calls(prefix);
  const url = list[list.length - 1];
  return Object.fromEntries(new URLSearchParams(url.includes('?') ? url.split('?')[1] : ''));
};

const GROUP: PayGroup = { id: 'g1', name: 'Bosch Distributor', method: 'bank', destination: 'HDFC Bank XXXX7890 · HDFC0001234', count: 2, total: 7500, onHold: 1, bankNotice: false, oldestAt: '' };
const SUPPLIER: Supplier = {
  id: 's1', name: 'Robert Bosch Ltd', contactPerson: 'Joseph', phone: '9800000001', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: 'Bosch', accountNumber: '', accountMasked: 'XXXXXXXX9012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
  active: true, bankChangedAt: null, bankChangedBy: '', updatedAt: '', can: { edit: false },
};

beforeEach(() => { get.mockReset(); });

describe('Supplier payments — by supplier', () => {
  const Q = '/payment-requests/to-pay/suppliers';
  beforeEach(() => {
    addressBar.reset('/admin/payments');
    get.mockResolvedValue({ groups: [GROUP], sort: 'oldest', summary: { count: 1, total: 7500, capped: false }, truncated: false });
  });

  it('opens longest-waiting first with nothing else asked, and says how many and the total', async () => {
    wrap(<SupplierPayQueue canPay />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 supplier found · total ₹7,500');
    expect(calls(Q)[0]).toBe(Q);
  });

  it('search, "Paid to" and sort go to the server and into the address', async () => {
    wrap(<SupplierPayQueue canPay />);
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Search suppliers to pay'), { target: { value: 'PR-0042' } });
    await waitFor(() => expect(lastQuery(Q)).toEqual({ q: 'PR-0042' }));
    fireEvent.change(screen.getByLabelText('Paid to'), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'total_desc' } });
    await waitFor(() => expect(lastQuery(Q)).toEqual({ q: 'PR-0042', method: 'upi', sort: 'total_desc' }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/payments?q=PR-0042&method=upi&sort=total_desc', { scroll: false });
  });

  it('a shared link opens filtered; Clear all keeps the sort; no match says so', async () => {
    addressBar.search = 'view=suppliers&q=zzz&method=bank&sort=name';
    get.mockResolvedValue({ groups: [], sort: 'name', summary: { count: 0, total: 0, capped: false }, truncated: false });
    wrap(<SupplierPayQueue canPay />);
    expect(await screen.findByText(/No supplier to pay matches/)).toBeInTheDocument();
    expect(lastQuery(Q)).toEqual({ q: 'zzz', method: 'bank', sort: 'name' });
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/payments?view=suppliers&sort=name', { scroll: false });
  });
});

describe('the supplier directory', () => {
  const Q = '/suppliers?';
  beforeEach(() => {
    addressBar.reset('/team/suppliers');
    get.mockResolvedValue({ suppliers: [SUPPLIER], nextAfter: null, sort: 'name', summary: { count: 1, capped: false } });
  });

  it('opens on Active by name, and says how many', async () => {
    wrap(<SupplierDirectory canEdit={false} />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 supplier found');
    expect(lastQuery(Q)).toEqual({ status: 'active' });
  });

  it('each control asks the server and is kept in the address', async () => {
    wrap(<SupplierDirectory canEdit />);
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Search suppliers'), { target: { value: 'hdfc 9012' } });
    await waitFor(() => expect(lastQuery(Q).q).toBe('hdfc 9012'));
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Bank details'), { target: { value: 'recent' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(lastQuery(Q)).toEqual({ status: 'all', q: 'hdfc 9012', method: 'bank', changed: 'recent', sort: 'updated' }));
  });

  it('a shared link opens filtered; an unknown tab or sort falls back; Clear all keeps tab and sort', async () => {
    addressBar.search = 'status=gone&sort=random&q=bosch&method=upi';
    wrap(<SupplierDirectory canEdit={false} />);
    await waitFor(() => expect(lastQuery(Q)).toEqual({ status: 'active', q: 'bosch', method: 'upi' }));
    expect(screen.getByLabelText('Search suppliers')).toHaveValue('bosch');
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/team/suppliers?status=gone&sort=random', { scroll: false });
  });

  it('Show more asks for the next page with the same filters', async () => {
    addressBar.search = 'q=bosch&sort=newest';
    get.mockResolvedValue({ suppliers: [SUPPLIER], nextAfter: 'NEXT', sort: 'newest', summary: { count: 80, capped: false } });
    wrap(<SupplierDirectory canEdit={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(lastQuery(Q)).toEqual({ status: 'active', q: 'bosch', sort: 'newest', after: 'NEXT' }));
  });
});
