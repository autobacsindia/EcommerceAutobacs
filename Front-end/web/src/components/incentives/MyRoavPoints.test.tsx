import { fireEvent, render, screen, within } from '@testing-library/react';
import MyRoavPoints from './MyRoavPoints';
import { ratingStatus, describeMyLine } from '@/lib/incentives';

type Q = { data?: unknown; isLoading?: boolean; error?: unknown };
let me: Q = {};
let orders: Q = {};
let ratings: Q = {};
jest.mock('@/hooks/queries/useIncentives', () => ({
  useMyIncentives: () => me,
  useMyIncentiveOrders: () => orders,
  useMyIncentiveRatings: () => ratings,
}));

const policy = {
  rating: { minCount: 3, highAvg: 4.5, highMultiplier: 1.05, lowAvg: 3.5, lowMultiplier: 0.9 },
  returnRateThresholdPercent: 10, returnPenaltyMultiplier: 0.95, perOrderBonus: 200, perOrderBonusMinValue: 1000,
};
const slabs = [{ name: 'Crank', minPoints: 11500, ratePerPoint: 0.28 }, { name: 'Piston', minPoints: 20000, ratePerPoint: 0.35 }];
const statement = {
  earnerKey: 'u:1', name: 'Asha', orders: 4, returnedOrders: 1, ratingCount: 2, ratingAvg: 4.5, ledgerPoints: 15000,
  returnRate: 25, returnFactor: 0.95, ratingFactor: 1, finalPoints: 14250, slab: 'Crank', ratePerPoint: 0.28, payoutPaise: 399000, payout: 3990,
};
const myMonth = {
  month: '2026-11', status: 'open', rulesVersion: 1, statement, points: 14250, slab: 'Crank', payout: 3990,
  next: { name: 'Piston', minPoints: 20000, pointsToGo: 5750 }, slabs, policy, bonusOrders: 3, ratingsExcluded: 1,
};
const order = {
  order: 'o1', orderNumber: '#1234', date: '2026-11-05T06:00:00Z', customerName: 'Ravi Kumar', valueExGst: 100000,
  discountPercent: 5, discountKeep: 0.85, portions: [{ from: 0, to: 100000, multiplier: 1 }], specialSourcing: false,
  sourcingKeep: 1, isB2B: false, basePoints: 1960, bonusPoints: 200, points: 2160, status: 'counted', rating: null,
  lines: [
    { _id: 'l1', type: 'earn', component: 'core', points: 1960, reason: null, eventAt: '2026-11-05T06:00:00Z' },
    { _id: 'l2', type: 'earn', component: 'order', points: 200, reason: null, eventAt: '2026-11-05T06:00:00Z' },
  ],
};
const reversed = {
  ...order, order: 'o2', orderNumber: '#5678', customerName: 'Meena S', points: 0, basePoints: -200, status: 'reversed',
  lines: [{ _id: 'l3', type: 'reverse', component: 'core', points: -980, reason: 'return', eventAt: '2026-11-09T06:00:00Z' }],
};

describe('My Roav Points', () => {
  beforeEach(() => {
    me = { data: myMonth };
    orders = { data: { orders: [order, reversed], nextCursor: null, pending: [{ order: 'p1', orderNumber: '#9001', date: '2026-11-10T06:00:00Z', customerName: 'Kiran', status: 'pending' }], ratingDetails: false } };
    ratings = { data: { visible: false, ratings: [] } };
  });

  test('loading', () => {
    me = { isLoading: true };
    orders = { isLoading: true };
    render(<MyRoavPoints />);
    expect(screen.getByLabelText('Loading your points')).toBeInTheDocument();
    expect(screen.getByText('Loading orders…')).toBeInTheDocument();
  });

  test('error', () => {
    me = { error: { rawData: { message: 'Not authorized' } } };
    render(<MyRoavPoints />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorized');
  });

  test('empty month', () => {
    me = { data: { ...myMonth, statement: null, points: 0, slab: null, payout: 0, next: { name: 'Crank', minPoints: 11500, pointsToGo: 11500 }, bonusOrders: 0, ratingsExcluded: 0 } };
    orders = { data: { orders: [], nextCursor: null, pending: [], ratingDetails: false } };
    render(<MyRoavPoints />);
    expect(screen.getByText('No orders with points this month yet.')).toBeInTheDocument();
    expect(screen.getByText('Below first slab')).toBeInTheDocument();
    expect(screen.getByText('11,500 pts to Crank')).toBeInTheDocument();
    expect(screen.getByText('No ratings counted yet.')).toBeInTheDocument();
  });

  test('data: summary, multipliers, orders and expandable lines', () => {
    render(<MyRoavPoints />);
    expect(screen.getByText('14,250')).toBeInTheDocument();
    expect(screen.getByText('₹0.28 per point')).toBeInTheDocument();
    expect(screen.getByText('Estimate until month-end')).toBeInTheDocument();
    expect(screen.getByText('5,750 pts to Piston')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '32');
    expect(screen.getByText('×0.95')).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 orders returned \(25%\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 ratings needed/)).toBeInTheDocument();
    expect(screen.getByText(/1 more not counted/)).toBeInTheDocument();
    expect(screen.getByText('3 orders')).toBeInTheDocument();

    // Phone cards and the wide-screen table both render (CSS picks one).
    expect(screen.getAllByText('Waiting for payment check')).toHaveLength(2);
    expect(screen.getAllByText('Reversed')).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: 'Rating' })).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    const row = within(table).getByText('#5678').closest('tr') as HTMLElement;
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(within(row.nextElementSibling as HTMLElement).getByText(/Order value — returned/)).toBeInTheDocument();
    expect(within(row.nextElementSibling as HTMLElement).getByText('-980')).toBeInTheDocument();
    // The card for the same order opens with it.
    const cards = screen.getByRole('list', { name: 'Orders' });
    expect(within(cards).getAllByRole('button', { expanded: true })).toHaveLength(1);
  });

  test('a closed month says so and drops "estimate"', () => {
    me = { data: { ...myMonth, status: 'approved' } };
    render(<MyRoavPoints />);
    expect(screen.getByText(/these are your final figures/)).toBeInTheDocument();
    expect(screen.queryByText('Estimate until month-end')).not.toBeInTheDocument();
  });

  test('stars and comments only when the server sends them', () => {
    orders = { data: { orders: [{ ...order, rating: { stars: 4, comment: '', counted: false } }], nextCursor: 'c1', pending: [], ratingDetails: true } };
    ratings = { data: { visible: true, ratings: [{ orderNumber: '#1234', customerName: 'Ravi Kumar', stars: 4, comment: 'Quick help', at: '2026-11-06T00:00:00Z', counted: true }] } };
    render(<MyRoavPoints />);
    expect(screen.getByRole('columnheader', { name: 'Rating' })).toBeInTheDocument();
    expect(screen.getByText('“Quick help”')).toBeInTheDocument();
    expect(screen.getAllByLabelText('4 out of 5 stars').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
  });
});

describe('helpers', () => {
  const rule = { minCount: 3, highAvg: 4.5, highMultiplier: 1.05, lowAvg: 3.5, lowMultiplier: 0.9 };
  test('rating status words', () => {
    expect(ratingStatus(2, 5, rule).factor).toBe(1);
    expect(ratingStatus(3, 4.6, rule)).toEqual({ label: 'Average 4.6★ — bonus ×1.05', factor: 1.05 });
    expect(ratingStatus(3, 3.2, rule).factor).toBe(0.9);
    expect(ratingStatus(3, 4, rule).factor).toBe(1);
  });
  test('line words', () => {
    expect(describeMyLine({ _id: 'x', type: 'reverse', component: 'order', points: -200, reason: 'cancel', eventAt: '', earnMonth: '2026-10' }))
      .toBe('Paid order bonus — cancelled — from October 2026');
  });
});
