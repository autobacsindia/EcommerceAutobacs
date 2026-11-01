/**
 * The search / filter / sort bars of the three admin affiliate lists — affiliates,
 * payouts and the payout queue: what they ask the server for, that they live in the
 * page address, and the count line. The money actions are covered server-side.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { addressBar } from '@/test-utils/addressBarMock';
import AdminAffiliatesPage from './page';
import AdminAffiliatePayoutsPage from './payouts/page';
import AdminAffiliatePayoutQueuePage from './payout-queue/page';

jest.mock('@/lib/api');
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const get = apiClient.get as jest.Mock;
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const lastQuery = (prefix: string) => {
  const urls = get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix) && !u.includes('stale'));
  const url = urls[urls.length - 1];
  return Object.fromEntries(new URLSearchParams(url.includes('?') ? url.split('?')[1] : ''));
};

beforeEach(() => { get.mockReset(); });

describe('affiliates', () => {
  const AFF = '/affiliates/admin?';
  beforeEach(() => {
    addressBar.reset('/admin/affiliates');
    get.mockImplementation((url: string) => Promise.resolve(url.includes('stale')
      ? { commissions: [] }
      : { affiliates: [{ _id: 'a1', code: 'RAHUL10', name: 'Rahul', email: 'r@x.in', status: 'active', commissionPercent: 10, discountPercent: 5, payableBalancePaise: 0, createdAt: '2026-10-01T00:00:00Z' }], nextCursor: null, summary: { count: 1, capped: false } }));
  });

  it('search, status and sort go to the server and the address; the count shows', async () => {
    wrap(<AdminAffiliatesPage />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 affiliate found');
    fireEvent.change(screen.getByLabelText('Search affiliates'), { target: { value: 'rah' } });
    fireEvent.click(screen.getByRole('button', { name: 'active' }));
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    await waitFor(() => expect(lastQuery(AFF)).toEqual({ limit: '25', status: 'active', search: 'rah', sort: 'name' }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/affiliates?status=active&sort=name&search=rah', { scroll: false });
  });

  it('a shared link opens filtered; Clear all keeps the sort; Next sends the cursor', async () => {
    addressBar.search = 'status=pending&search=zz&sort=oldest';
    get.mockImplementation((url: string) => Promise.resolve(url.includes('stale') ? { commissions: [] }
      : { affiliates: [], nextCursor: 'NEXT', summary: { count: 0, capped: false } }));
    wrap(<AdminAffiliatesPage />);
    expect(await screen.findByText(/No affiliates match/)).toBeInTheDocument();
    expect(lastQuery(AFF)).toEqual({ limit: '25', status: 'pending', search: 'zz', sort: 'oldest' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastQuery(AFF).cursor).toBe('NEXT'));
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/affiliates?sort=oldest', { scroll: false });
  });
});

describe('payouts', () => {
  const PAY = '/affiliates/admin/payouts?';
  beforeEach(() => {
    addressBar.reset('/admin/affiliates/payouts');
    get.mockResolvedValue({ payouts: [], nextCursor: null, summary: { count: 2, total: 240000, capped: false } });
  });

  it('says how many and the net total; tabs, search, dates and sort go to the server and the address', async () => {
    wrap(<AdminAffiliatePayoutsPage />);
    expect(await screen.findByRole('status')).toHaveTextContent('2 payouts found · total ₹2,400.00');
    fireEvent.click(screen.getByRole('tab', { name: 'To pay' }));
    fireEvent.change(screen.getByLabelText('Search payouts'), { target: { value: 'UTR77' } });
    fireEvent.change(screen.getByLabelText('Made on: from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'amount_desc' } });
    await waitFor(() => expect(lastQuery(PAY)).toEqual({ limit: '25', status: 'draft', q: 'UTR77', from: '2026-09-01', sort: 'amount_desc' }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/affiliates/payouts?status=draft&from=2026-09-01&sort=amount_desc&q=UTR77', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/affiliates/payouts?sort=amount_desc', { scroll: false });
  });

  it('an old slow answer never paints over the newest one', async () => {
    let releaseOld: (v: unknown) => void = () => {};
    get.mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }));
    get.mockResolvedValue({ payouts: [], nextCursor: null, summary: { count: 0, total: 0, capped: false } });
    wrap(<AdminAffiliatePayoutsPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paid' }));
    expect(await screen.findByText(/No payouts match/)).toBeInTheDocument();
    await act(async () => {
      releaseOld({ payouts: [{ _id: 'old', affiliate: null, status: 'draft', grossPaise: 1, tdsPercent: 0, tdsPaise: 0, netPaise: 1, commissionCount: 1, createdAt: '2026-10-01T00:00:00Z' }], nextCursor: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole('button', { name: 'Record paid' })).toBeNull();
  });
});

describe('payout queue', () => {
  const Q = '/affiliates/admin/payout-queue';
  beforeEach(() => {
    addressBar.reset('/admin/affiliates/payout-queue');
    get.mockResolvedValue({
      queue: [], minPayoutPaise: 50000, totalPayablePaise: 800000, dueCount: 2, found: 0, sort: 'priority', hasMore: false,
      suspendedHeld: { heldPaise: 0, count: 0 },
    });
  });

  it('search and sort go to the server; the totals stay every due affiliate', async () => {
    wrap(<AdminAffiliatePayoutQueuePage />);
    expect(await screen.findByText(/2 affiliates due/)).toHaveTextContent('₹8,000.00 total');
    fireEvent.change(screen.getByLabelText('Search the payout queue'), { target: { value: 'priya' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    await waitFor(() => expect(lastQuery(Q)).toEqual({ q: 'priya', sort: 'oldest' }));
    expect(await screen.findByRole('status')).toHaveTextContent('0 of 2 due affiliates match');
    expect(screen.getByText(/Nobody due matches/)).toBeInTheDocument();
    expect(addressBar.replace).toHaveBeenLastCalledWith('/admin/affiliates/payout-queue?sort=oldest&q=priya', { scroll: false });
  });
});
