import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DelayList from './DelayList';
import DelayRanking from './DelayRanking';
import { officeDuration, filterParams } from './types';
import type { DelayItem, DelayPage, DelayRanking as Ranking } from './types';

const get = jest.fn();
const put = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a),
    post: jest.fn(),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({}) },
}));
jest.mock('@/components/staff/work/WorkOrderPanel', () => ({ __esModule: true, default: ({ orderId }: { orderId: string }) => <p>work panel {orderId}</p> }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const owner = { id: 'u1', name: 'Aromal', team: 'procurement', via: 'moved' as const };
const base: Omit<DelayItem, 'key' | 'kind' | 'bucket' | 'title'> = {
  subtitle: 'Ravi', stage: 'to_ship', stageLabel: 'In Stock', team: 'procurement', since: null,
  dueAt: '2026-11-20T06:00:00Z', minutesLate: 0, reason: null, control: 'inside', nextFollowUp: null,
  flags: { noEta: false }, owner, order: null, shipmentId: null, etaDay: null, task: null, project: null,
};
const step: DelayItem = { ...base, key: 'order:o1:to_ship:i1', kind: 'order_step', bucket: 'late', title: '#1001 · Seat cover', minutesLate: 600, order: { id: 'o1', number: '#1001' } };
const parcel: DelayItem = {
  ...base, key: 'parcel:o2:s1', kind: 'parcel', bucket: 'late', title: '#1002 · Parcel (DTDC R1)', stage: 'shipped', stageLabel: 'Dispatched',
  minutesLate: 90, order: { id: 'o2', number: '#1002' }, shipmentId: 's1', etaDay: '2026-11-18', team: 'operations',
};
const noEta: DelayItem = { ...parcel, key: 'parcel:o3:s2', bucket: 'pending', minutesLate: 0, etaDay: null, flags: { noEta: true }, shipmentId: 's2', order: { id: 'o3', number: '#1003' } };
const task: DelayItem = { ...base, key: 'task:t1:u1', kind: 'task', bucket: 'today', title: 'T-9 · Call back', stage: 'task', stageLabel: 'Task', task: { id: 't1', number: 9, rev: 3, project: null }, nextFollowUp: '2026-11-23' };
const outside: DelayItem = { ...parcel, key: 'parcel:o4:s3', minutesLate: 30, shipmentId: 's3', reason: { code: 'courier_delay', label: 'Courier delay', note: 'hub', by: 'Ops', at: null, control: 'outside' }, control: 'outside' };

const page = (items: DelayItem[], extra: Partial<DelayPage> = {}): DelayPage => ({
  person: { id: 'u1', name: 'Aromal', team: 'procurement' },
  summary: { late: items.filter((i) => i.bucket === 'late').length, today: items.filter((i) => i.bucket === 'today').length, pending: items.filter((i) => i.bucket === 'pending').length, noReason: 2, noEta: 1, outside: 1, minutesLate: 720 },
  items, nextCursor: null, truncated: false, asOf: '2026-11-23T06:00:00Z', ...extra,
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { get.mockReset(); put.mockReset(); patch.mockReset(); });

describe('helpers', () => {
  it('office durations read in office days of 9 hours', () => {
    expect(officeDuration(45)).toBe('45m');
    expect(officeDuration(200)).toBe('3h 20m');
    expect(officeDuration(540)).toBe('1d');
    expect(officeDuration(600)).toBe('1d 1h');
  });
  it('only set filters become params', () => {
    expect(filterParams({ control: '', from: '2026-11-01', team: undefined })).toEqual({ from: '2026-11-01' });
  });
});

describe('DelayList', () => {
  it('groups late → due today → pending, flags no reason and no ETA, and shows outside reasons', async () => {
    get.mockResolvedValue(page([step, parcel, outside, task, noEta]));
    wrap(<DelayList />);
    const late = await screen.findByRole('region', { name: 'Late' });
    expect(get).toHaveBeenCalledWith('/staff/delays/me');
    const sections = screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'));
    expect(sections).toEqual(['Late', 'Due today', 'Pending']);
    expect(within(late).getByText('#1001 · Seat cover')).toBeInTheDocument();
    expect(within(late).getByText(/1d 1h late/)).toBeInTheDocument();
    expect(within(late).getAllByText('No reason yet')).toHaveLength(2);
    expect(within(late).getByText(/Courier delay — hub · outside our control/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Pending' })).getByText('No expected delivery date')).toBeInTheDocument();
  });

  it('gives a parcel reason through the existing overdue-reason endpoint, with the ETA shown', async () => {
    get.mockResolvedValue(page([parcel]));
    put.mockResolvedValue({});
    wrap(<DelayList />);
    fireEvent.click(await screen.findByRole('button', { name: /Give reason/ }));
    const save = screen.getByRole('button', { name: /Save reason/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    expect(save).toBeDisabled(); // "Other" needs a note
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '  customer travelling ' } });
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/work/orders/o2/parcels/s1/overdue-reason', { code: 'other', note: 'customer travelling', expectedDate: '2026-11-18' }));
  });

  it('marks a task done with its revision, and opens an order in its work panel', async () => {
    get.mockResolvedValue(page([step, task]));
    patch.mockResolvedValue({});
    wrap(<DelayList />);
    fireEvent.click(await screen.findByRole('button', { name: /Mark done/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: /Open order · update/ }));
    expect(screen.getByText('work panel o1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open task/ })).toHaveAttribute('href', '/team/tasks/t1');
  });

  it('says when a step is with the team head only because nobody moved it', async () => {
    get.mockResolvedValue(page([{ ...step, owner: { ...owner, via: 'head' } }]));
    wrap(<DelayList />);
    expect(await screen.findByText(/with the team head/)).toBeInTheDocument();
  });

  it('admin mode links to the admin order page; another person uses their own endpoint', async () => {
    get.mockResolvedValue(page([step]));
    wrap(<DelayList personId="u9" mode="admin" filters={{ control: 'inside' }} />);
    expect(await screen.findByRole('link', { name: /Open order/ })).toHaveAttribute('href', '/admin/orders/o1');
    expect(get).toHaveBeenCalledWith('/staff/delays/people/u9?control=inside');
  });

  it('says all clear when nothing is waiting, and shows a load error', async () => {
    get.mockResolvedValueOnce(page([]));
    const { unmount } = wrap(<DelayList />);
    expect(await screen.findByText(/All clear/)).toBeInTheDocument();
    unmount();
    get.mockRejectedValueOnce(new Error('Only a team head or an admin can see someone else’s delays.'));
    wrap(<DelayList personId="u2" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('loads the next keyset page on "Show more"', async () => {
    get.mockResolvedValueOnce(page([step], { nextCursor: 'c1' })).mockResolvedValueOnce(page([parcel]));
    wrap(<DelayList />);
    fireEvent.click(await screen.findByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/staff/delays/me?cursor=c1'));
    expect(await screen.findByText('#1002 · Parcel (DTDC R1)')).toBeInTheDocument();
  });
});

describe('DelayRanking', () => {
  const ranking: Ranking = {
    scope: { team: null },
    totals: { late: 5, today: 1, pending: 2, noReason: 4, noEta: 1, outside: 1, minutesLate: 2000 },
    people: [
      { key: 'u1', id: 'u1', name: 'Aromal', team: 'procurement', teamLabel: 'Procurement', late: 4, today: 0, pending: 1, noReason: 3, noEta: 0, outside: 1, minutesLate: 1500, },
      { key: 'none:accounts', id: null, name: 'Admins (no team head)', team: 'accounts', teamLabel: 'Accounts', late: 1, today: 1, pending: 1, noReason: 1, noEta: 1, outside: 0, minutesLate: 500 },
    ],
    nextCursor: null, truncated: false, asOf: '2026-11-23T06:00:00Z',
  };

  it('ranks people, filters by team (admin), and opens a person', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/staff/delays/people/') ? page([step]) : ranking));
    wrap(<DelayRanking mode="admin" />);
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByText('Aromal')).toBeInTheDocument();
    expect(within(rows[0]).getByText('2d 7h')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button')).toBeDisabled(); // nobody to open

    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'operations' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/delays?team=operations'));

    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'));
    expect(await screen.findByText('#1001 · Seat cover')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/delays/people/u1');
    fireEvent.click(screen.getByRole('button', { name: /Back to everyone/ }));
    expect(await screen.findByLabelText('Team')).toBeInTheDocument();
  });

  it('a head gets no team picker (the server scopes them to their team)', async () => {
    get.mockResolvedValue(ranking);
    wrap(<DelayRanking mode="team" />);
    await screen.findAllByRole('listitem');
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/delays');
  });
});
