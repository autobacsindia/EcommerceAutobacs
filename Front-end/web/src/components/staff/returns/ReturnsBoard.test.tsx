/**
 * The search / filter / sort bars of the team Returns board and "Suppliers owe us":
 * what they ask the server for, that they live in the page address (the bell's
 * ?tab= links keep working), and the count line. The return panel itself is in
 * returns.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReturnsBoard, { ReturnList } from './ReturnsBoard';
import type { ReturnRow } from './types';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const calls = (prefix: string) => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));
const lastQuery = (prefix: string) => {
  const list = calls(prefix);
  const url = list[list.length - 1];
  return Object.fromEntries(new URLSearchParams(url.includes('?') ? url.split('?')[1] : ''));
};

const ROW: ReturnRow = {
  id: 'r1', ref: 'AB12CD34', orderId: 'o1', orderNumber: '#48213', customer: 'Anil Thomas',
  items: [{ name: 'Wiper blade', quantity: 1, reason: 'wrong_item', reasonLabel: 'Wrong item shipped', fault: 'ours' }],
  status: 'pending', stage: 'Check 1 — evidence', origin: 'customer', destination: 'warehouse', supplierName: null, pickupMode: null,
  pickupAttempts: 0, refund: { status: 'pending', amount: 0 }, claims: [], createdAt: '2026-10-30T05:00:00Z', ageDays: 1,
};
const OPS = { team: 'operations', isHead: false, canSell: false, isAdmin: false };
const LIST = '/staff/returns?';
const OWED = '/staff/returns/suppliers-owe-us';

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve(url.startsWith(OWED)
    ? {
      items: [{ returnId: 'r1', returnRef: 'AB12CD34', claimId: 'c1', supplierName: 'Ram Traders', kind: 'credit_note', amount: 7000, reference: 'CN-1', paymentRequestRef: null, promisedAt: '2026-09-01T00:00:00Z', ageDays: 60 }],
      totals: [{ supplierName: 'Ram Traders', amount: 7000, claims: 1 }, { supplierName: 'Bosch', amount: 3000, claims: 1 }],
      nextCursor: null, sort: 'oldest', summary: { count: 1, total: 7000, capped: false },
    }
    : { returns: [ROW], nextCursor: null, sort: 'newest', summary: { count: 1, capped: false } }));
});

describe('a returns queue', () => {
  beforeEach(() => addressBar.reset('/team/returns'));

  it("opens on the person's first tab, newest first, and says how many", async () => {
    wrap(<ReturnsBoard {...OPS} />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 return found');
    expect(lastQuery(LIST)).toEqual({ queue: 'review' });
  });

  it('search, each filter and the sort go to the server and into the address', async () => {
    wrap(<ReturnsBoard {...OPS} />);
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Search returns'), { target: { value: 'anil wiper' } });
    await waitFor(() => expect(lastQuery(LIST).q).toBe('anil wiper'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'transit_damage' } });
    fireEvent.change(screen.getByLabelText('Came from'), { target: { value: 'staff' } });
    fireEvent.change(screen.getByLabelText('Raised on: from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    await waitFor(() => expect(lastQuery(LIST)).toEqual({
      queue: 'review', q: 'anil wiper', reason: 'transit_damage', origin: 'staff', from: '2026-10-01', sort: 'oldest',
    }));
    expect(addressBar.replace).toHaveBeenLastCalledWith(
      '/team/returns?q=anil+wiper&reason=transit_damage&origin=staff&from=2026-10-01&sort=oldest', { scroll: false },
    );
  });

  it("the bell's link opens that tab; a shared link opens filtered; Clear all keeps tab and sort", async () => {
    addressBar.search = 'tab=inspect&q=zzz&sort=oldest';
    get.mockResolvedValue({ returns: [], nextCursor: null, sort: 'oldest', summary: { count: 0, capped: false } });
    wrap(<ReturnsBoard {...OPS} />);
    expect(await screen.findByText(/No returns match/)).toBeInTheDocument();
    expect(lastQuery(LIST)).toEqual({ queue: 'inspect', q: 'zzz', sort: 'oldest' });
    expect(screen.getByRole('tab', { name: 'To inspect' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/team/returns?tab=inspect&sort=oldest', { scroll: false });
  });

  it("another tab starts clean; another team's tab in a link opens the person's first", async () => {
    addressBar.search = 'tab=supplier&q=anil&reason=wrong_item';
    wrap(<ReturnsBoard {...OPS} />);
    await screen.findByRole('status');
    expect(lastQuery(LIST)).toEqual({ queue: 'review', q: 'anil', reason: 'wrong_item' });
    fireEvent.click(screen.getByRole('tab', { name: 'Pickups' }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/team/returns?tab=pickup', { scroll: false });
  });

  it('Show more asks for the next page with the same filters', async () => {
    addressBar.search = 'q=anil';
    get.mockResolvedValue({ returns: [ROW], nextCursor: 'NEXT', sort: 'newest', summary: { count: 40, capped: false } });
    wrap(<ReturnList queue="refund" showRefund />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(lastQuery(LIST)).toEqual({ queue: 'refund', q: 'anil', cursor: 'NEXT' }));
  });
});

describe('Suppliers owe us', () => {
  beforeEach(() => addressBar.reset('/team/returns', 'tab=owed'));
  const ACCOUNTS = { team: 'accounts', isHead: false, canSell: false, isAdmin: false };

  it('opens oldest first with the total of what matches', async () => {
    wrap(<ReturnsBoard {...ACCOUNTS} />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 claim found · total ₹7,000');
    expect(calls(OWED)[0]).toBe(OWED);
  });

  it("pressing a supplier's total shows only theirs; search, kind and sort go to the server", async () => {
    wrap(<ReturnsBoard {...ACCOUNTS} />);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /Bosch/ }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'refund' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'amount_desc' } });
    fireEvent.change(screen.getByLabelText('Search what suppliers owe'), { target: { value: 'CN-1' } });
    await waitFor(() => expect(lastQuery(OWED)).toEqual({ q: 'CN-1', supplier: 'Bosch', kind: 'refund', sort: 'amount_desc' }));
    expect(screen.getByRole('button', { name: /Bosch/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/team/returns?tab=owed&sort=amount_desc', { scroll: false });
  });
});
