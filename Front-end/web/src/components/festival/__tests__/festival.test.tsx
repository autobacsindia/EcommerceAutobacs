import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { FestivalThemeProvider } from '../FestivalThemeContext';
import FestiveToran from '../FestiveToran';
import FestivalCountdown, { formatCountdown } from '../FestivalCountdown';
import FestivalDealBadge from '../FestivalDealBadge';
import OrderCelebration, { isConfirmedOrder } from '../OrderCelebration';
import FestivalEffects from '../FestivalEffects';
import { resetEngineForTests } from '../loadEngine';
import { emitCartAddIntent } from '@/lib/festival/events';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const mockGet = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));

const engine = { burst: jest.fn(), sparkle: jest.fn(), flyToCart: jest.fn(() => Promise.resolve()), popBadge: jest.fn(), fireworks: jest.fn(), destroy: jest.fn() };
const mockCreateEngine = jest.fn(() => engine);
jest.mock('../effects/engine', () => ({
  createEngine: (...a: unknown[]) => mockCreateEngine(...(a as [])),
  computeQuality: () => 1,
}));

function setReducedMotion(on: boolean) {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: on && q.includes('reduce'), media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
  }));
}

const HOUR = 3600_000;
const liveTheme = (p: Partial<PublicFestivalTheme> = {}): PublicFestivalTheme => ({
  themeKey: 'diwali', startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString(), live: true, ...p,
});

const withTheme = (ui: React.ReactNode, theme: PublicFestivalTheme | null = liveTheme(), initialLive = true) =>
  render(<FestivalThemeProvider theme={theme} initialLive={initialLive}>{ui}</FestivalThemeProvider>);

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  mockPath = '/';
  sessionStorage.clear();
  jest.clearAllMocks();
  resetEngineForTests();
  setReducedMotion(false);
});

describe('theme hidden when off or expired', () => {
  it('shows the toran, badge and countdown while live', () => {
    withTheme(<><FestiveToran /><FestivalDealBadge /><FestivalCountdown /></>);
    expect(screen.getByTestId('festive-toran')).toBeInTheDocument();
    expect(screen.getByTestId('festival-deal-badge')).toHaveTextContent('🪔Diwali Deal');
    expect(screen.getByTestId('festival-countdown')).toHaveTextContent('Diwali offers end in');
  });

  it('renders nothing when switched off (null theme)', () => {
    const { container } = withTheme(<><FestiveToran /><FestivalDealBadge /><FestivalCountdown /></>, null, false);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides itself on the client when the end date has passed, even if the server said live', async () => {
    const expired = liveTheme({ endsAt: new Date(Date.now() - 1000).toISOString(), live: true });
    const { container } = withTheme(<FestiveToran />, expired, true);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('switches off at the end time while the page is open', () => {
    jest.useFakeTimers();
    try {
      withTheme(<FestiveToran />, liveTheme({ endsAt: new Date(Date.now() + 5000).toISOString() }));
      expect(screen.getByTestId('festive-toran')).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(5100); });
      expect(screen.queryByTestId('festive-toran')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['/admin/orders', '/team/marketing', '/checkout', '/login'])('never shows on %s', (p) => {
    mockPath = p;
    const { container } = withTheme(<><FestiveToran /><FestivalDealBadge /><FestivalCountdown /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no countdown when there is no end date', () => {
    withTheme(<FestivalCountdown />, liveTheme({ endsAt: null }));
    expect(screen.queryByTestId('festival-countdown')).toBeNull();
  });

  it('toran is decorative only (hidden from screen readers)', () => {
    withTheme(<FestiveToran />);
    expect(screen.getByTestId('festive-toran')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('formatCountdown', () => {
  it('formats HH:MM:SS and adds days past 24h', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown((4 * 3600 + 10 * 60 + 3) * 1000)).toBe('04:10:03');
    expect(formatCountdown((2 * 86400 + 3600) * 1000)).toBe('2d 01:00:00');
  });
});

describe('order celebration', () => {
  it('only counts a server-PAID order as confirmed', () => {
    expect(isConfirmedOrder('paid', 'processing')).toBe(true);
    expect(isConfirmedOrder('pending', 'awaiting_payment')).toBe(false);
    expect(isConfirmedOrder('paid', 'cancelled')).toBe(false);
    expect(isConfirmedOrder(undefined, undefined)).toBe(false);
  });

  it('fires fireworks + greeting once for a paid order', async () => {
    withTheme(<OrderCelebration orderId="o1" paymentStatus="paid" orderStatus="processing" />);
    expect(await screen.findByTestId('order-celebration')).toHaveTextContent('Happy Diwali! Your order is confirmed 🪔');
    await waitFor(() => expect(engine.fireworks).toHaveBeenCalledWith(3000));
    expect(screen.getByTestId('order-celebration')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('does not replay on refresh (same order, second mount)', async () => {
    const first = withTheme(<OrderCelebration orderId="o2" paymentStatus="paid" orderStatus="processing" />);
    await waitFor(() => expect(engine.fireworks).toHaveBeenCalledTimes(1));
    first.unmount();

    withTheme(<OrderCelebration orderId="o2" paymentStatus="paid" orderStatus="processing" />);
    await flush();
    expect(screen.queryByTestId('order-celebration')).toBeNull();
    expect(engine.fireworks).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unpaid order', async () => {
    withTheme(<OrderCelebration orderId="o3" paymentStatus="pending" orderStatus="awaiting_payment" />);
    await flush();
    expect(screen.queryByTestId('order-celebration')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('waits for the webhook: polls only when this tab just paid, fires when the server says paid', async () => {
    jest.useFakeTimers();
    try {
      sessionStorage.setItem('awaitingPaymentConfirmation:o4', '1');
      mockGet
        .mockResolvedValueOnce({ order: { paymentStatus: 'pending', status: 'awaiting_payment' } })
        .mockResolvedValueOnce({ order: { paymentStatus: 'paid', status: 'processing' } });
      withTheme(<OrderCelebration orderId="o4" paymentStatus="pending" orderStatus="awaiting_payment" />);
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(screen.queryByTestId('order-celebration')).toBeNull();
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('order-celebration')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing when no festival is live', async () => {
    withTheme(<OrderCelebration orderId="o5" paymentStatus="paid" orderStatus="processing" />, null, false);
    await flush();
    expect(screen.queryByTestId('order-celebration')).toBeNull();
    expect(sessionStorage.getItem('festival_celebrated_o5')).toBeNull();
  });

  it('reduced motion: shows the greeting but loads no animation', async () => {
    setReducedMotion(true);
    withTheme(<OrderCelebration orderId="o6" paymentStatus="paid" orderStatus="processing" />);
    expect(await screen.findByTestId('order-celebration')).toBeInTheDocument();
    await flush();
    expect(mockCreateEngine).not.toHaveBeenCalled();
    expect(engine.fireworks).not.toHaveBeenCalled();
  });
});

describe('add-to-cart effects', () => {
  const tapThenAdd = () => {
    act(() => {
      const ev = new Event('pointerdown', { bubbles: true }) as PointerEvent;
      Object.assign(ev, { clientX: 100, clientY: 200 });
      document.body.dispatchEvent(ev);
      emitCartAddIntent();
    });
  };

  it('bursts sparks at the tap and flies the lamp to the cart', async () => {
    withTheme(<FestivalEffects />);
    tapThenAdd();
    await waitFor(() => expect(engine.burst).toHaveBeenCalledWith(100, 200));
    expect(engine.flyToCart).toHaveBeenCalledWith(100, 200);
  });

  it('reduced motion: no animation code is loaded at all', async () => {
    setReducedMotion(true);
    withTheme(<FestivalEffects />);
    tapThenAdd();
    await flush();
    expect(mockCreateEngine).not.toHaveBeenCalled();
  });

  it('no effects when the festival is off', async () => {
    withTheme(<FestivalEffects />, null, false);
    tapThenAdd();
    await flush();
    expect(mockCreateEngine).not.toHaveBeenCalled();
  });

  it('never animates over the payment sheet', async () => {
    const rzp = document.createElement('div');
    rzp.className = 'razorpay-container';
    document.body.appendChild(rzp);
    withTheme(<FestivalEffects />);
    tapThenAdd();
    await flush();
    expect(engine.burst).not.toHaveBeenCalled();
    rzp.remove();
  });

  it('stops everything when the visitor moves to checkout', async () => {
    const view = withTheme(<FestivalEffects />);
    tapThenAdd();
    await waitFor(() => expect(engine.burst).toHaveBeenCalled());
    mockPath = '/checkout';
    view.rerender(<FestivalThemeProvider theme={liveTheme()} initialLive><FestivalEffects /></FestivalThemeProvider>);
    await waitFor(() => expect(engine.destroy).toHaveBeenCalled());
  });
});

describe('page-wide accents', () => {
  it('tags <html> while live and removes the tag when off', () => {
    const view = withTheme(<span />);
    expect(document.documentElement.dataset.festival).toBe('diwali');
    view.rerender(<FestivalThemeProvider theme={null} initialLive={false}><span /></FestivalThemeProvider>);
    expect(document.documentElement.dataset.festival).toBeUndefined();
  });

  it('never tags <html> on admin', () => {
    mockPath = '/admin';
    withTheme(<span />);
    expect(document.documentElement.dataset.festival).toBeUndefined();
  });
});
