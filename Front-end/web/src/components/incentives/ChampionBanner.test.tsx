import { fireEvent, render, screen } from '@testing-library/react';
import ChampionBanner from './ChampionBanner';
import { describeRow, shiftMonth, currentMonthIST, monthLabel } from '@/lib/incentives';

let champion: unknown = null;
jest.mock('@/hooks/queries/useIncentives', () => ({ useIncentiveChampion: () => ({ data: champion }) }));

const base = { month: '2026-10', name: 'Asha', finalPoints: 70210, payout: 49147, slab: 'Nitro', ratingAvg: 4.8, showBanner: true };

describe('ChampionBanner', () => {
  beforeEach(() => { localStorage.clear(); });

  test('shows name, points and incentive', () => {
    champion = base;
    render(<ChampionBanner />);
    expect(screen.getByText(/October 2026 Incentive Champion: Asha/)).toBeInTheDocument();
    expect(screen.getByText(/70,210 pts/)).toBeInTheDocument();
    expect(screen.getByText(/₹49,147.00/)).toBeInTheDocument();
  });

  test('hidden after the banner days, or with no champion', () => {
    champion = { ...base, showBanner: false };
    const { container, rerender } = render(<ChampionBanner />);
    expect(container).toBeEmptyDOMElement();
    champion = null;
    rerender(<ChampionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('can be dismissed for the month', () => {
    champion = base;
    const { container } = render(<ChampionBanner />);
    fireEvent.click(screen.getByLabelText('Hide'));
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem('roav-champion-dismissed:2026-10')).toBe('1');
  });
});

describe('incentive helpers', () => {
  test('IST month boundary', () => {
    expect(currentMonthIST(new Date('2026-10-31T18:29:59Z'))).toBe('2026-10');
    expect(currentMonthIST(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-11')).toBe('November 2026');
  });
  test('describes ledger rows in plain words', () => {
    const r = { _id: '1', orderNumber: '#A', points: -5, eventAt: '', component: 'core', type: 'reverse' as const, reason: 'return' };
    expect(describeRow(r)).toBe('Order value — returned');
    expect(describeRow({ ...r, type: 'earn', component: 'order', reason: null })).toBe('Paid order bonus');
  });
});
