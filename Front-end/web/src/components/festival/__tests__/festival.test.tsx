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
import { isStaffPanelRoute, type PublicFestivalTheme } from '@/lib/festival/festivalTheme';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const mockGet = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));

const engine = { burst: jest.fn(), sparkle: jest.fn(), trail: jest.fn(), flyToCart: jest.fn(() => Promise.resolve()), popBadge: jest.fn(), fireworks: jest.fn(), destroy: jest.fn() };
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

describe('cursor sparkle trail', () => {
  /** matchMedia for a desktop mouse (fine + hover), optionally asking for less motion. */
  const setMouse = (fine: boolean, reduce = false) => {
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: (q.includes('reduce') && reduce) || (q.includes('pointer: fine') && fine),
      media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
    }));
  };
  const move = (x: number, y: number, pointerType = 'mouse', timeStamp = 0) => {
    const ev = new Event('pointermove', { bubbles: true }) as PointerEvent;
    Object.defineProperties(ev, {
      clientX: { value: x }, clientY: { value: y }, pointerType: { value: pointerType }, timeStamp: { value: timeStamp },
    });
    document.body.dispatchEvent(ev);
  };
  /** Let the idle warm-up load the (mocked) engine chunk. */
  const warm = async () => {
    await act(async () => { jest.advanceTimersByTime(2100); });
    await flush();
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sheds sparks behind a moving mouse once the engine is warm', async () => {
    setMouse(true);
    withTheme(<FestivalEffects />);
    move(10, 10, 'mouse', 1000); // before warm-up: nothing, and no waiting on the chunk
    expect(engine.trail).not.toHaveBeenCalled();
    await warm();
    move(50, 60, 'mouse', 2000);
    expect(engine.trail).toHaveBeenCalledWith(50, 60);
  });

  it('is throttled: tiny or too-quick moves shed nothing extra', async () => {
    setMouse(true);
    withTheme(<FestivalEffects />);
    await warm();
    move(100, 100, 'mouse', 3000);
    move(103, 102, 'mouse', 3100); // 3.6px: too short
    move(160, 100, 'mouse', 3105); // 5ms later: too soon
    move(160, 100, 'mouse', 3200); // far enough from (100,100) and late enough
    expect(engine.trail).toHaveBeenCalledTimes(2);
  });

  it('never runs for touch or pen, nor on devices without a fine pointer', async () => {
    setMouse(true);
    const view = withTheme(<FestivalEffects />);
    await warm();
    move(50, 50, 'touch', 2000);
    move(90, 90, 'pen', 2100);
    expect(engine.trail).not.toHaveBeenCalled();
    view.unmount();

    setMouse(false);
    withTheme(<FestivalEffects />);
    await warm();
    move(50, 50, 'mouse', 3000);
    expect(engine.trail).not.toHaveBeenCalled();
  });

  it('reduced motion: no trail and no animation code', async () => {
    setMouse(true, true);
    withTheme(<FestivalEffects />);
    await warm();
    move(50, 50, 'mouse', 2000);
    expect(mockCreateEngine).not.toHaveBeenCalled();
    expect(engine.trail).not.toHaveBeenCalled();
  });

  it('stops when the festival is off and on checkout', async () => {
    setMouse(true);
    withTheme(<FestivalEffects />, null, false);
    await warm();
    move(50, 50, 'mouse', 2000);
    expect(engine.trail).not.toHaveBeenCalled();

    mockPath = '/checkout';
    withTheme(<FestivalEffects />);
    await warm();
    move(80, 80, 'mouse', 3000);
    expect(engine.trail).not.toHaveBeenCalled();
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

describe('staff panels: normal mouse, gentle sparkles, nothing else', () => {
  const setMouse = (reduce = false) => {
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: q.includes('hover') || (reduce && q.includes('reduce')), media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
    }));
  };
  const warm = async () => {
    await act(async () => { jest.advanceTimersByTime(2100); });
    await flush();
  };
  const moveAt = (x: number, t: number, buttons = 0, target: EventTarget = document.body) => {
    const ev = new Event('pointermove', { bubbles: true });
    Object.defineProperties(ev, {
      clientX: { value: x }, clientY: { value: x }, pointerType: { value: 'mouse' }, timeStamp: { value: t }, buttons: { value: buttons },
    });
    target.dispatchEvent(ev);
  };

  beforeEach(() => { jest.useFakeTimers(); setMouse(); });
  afterEach(() => jest.useRealTimers());

  it.each(['/admin', '/admin/orders', '/team', '/team/tasks'])('%s: no diya cursor tag, no decoration', (p) => {
    mockPath = p;
    withTheme(<span />);
    expect(document.documentElement.dataset.festival).toBeUndefined();
  });

  it('a look-alike route is not a panel', () => {
    expect(isStaffPanelRoute('/teams')).toBe(false);
    expect(isStaffPanelRoute('/administrator')).toBe(false);
    expect(isStaffPanelRoute('/team/')).toBe(true);
  });

  it('the panel asks for the gentle trail; the storefront keeps its full trail', async () => {
    mockPath = '/admin/products';
    const panel = withTheme(<FestivalEffects />);
    await warm();
    moveAt(50, 1000);
    expect(engine.trail).toHaveBeenCalledWith(50, 50, { gentle: true });
    panel.unmount();
    engine.trail.mockClear();

    mockPath = '/';
    resetEngineForTests();
    withTheme(<FestivalEffects />);
    await warm();
    moveAt(50, 1000);
    expect(engine.trail).toHaveBeenCalledWith(50, 50);
  });

  it('sheds sparks far less often than the storefront', async () => {
    mockPath = '/team';
    withTheme(<FestivalEffects />);
    await warm();
    moveAt(0, 1000);
    moveAt(100, 1050); // far enough, but too soon
    moveAt(30, 1200); // late enough, but too short a move
    expect(engine.trail).toHaveBeenCalledTimes(1);
    moveAt(100, 1300);
    expect(engine.trail).toHaveBeenCalledTimes(2);
  });

  it('no sparks while a button is held (dragging, selecting text)', async () => {
    mockPath = '/team/tasks';
    withTheme(<FestivalEffects />);
    await warm();
    moveAt(50, 1000, 1);
    expect(engine.trail).not.toHaveBeenCalled();
  });

  it.each([['input'], ['textarea'], ['select']])('no sparks over a %s', async (tag) => {
    mockPath = '/admin';
    withTheme(<FestivalEffects />);
    await warm();
    const field = document.createElement(tag);
    document.body.appendChild(field);
    moveAt(50, 1000, 0, field);
    field.remove();
    expect(engine.trail).not.toHaveBeenCalled();
  });

  it('never tags page elements for the diya in a panel', () => {
    mockPath = '/admin';
    withTheme(<FestivalEffects />);
    const div = document.createElement('div');
    div.style.cursor = 'pointer';
    document.body.appendChild(div);
    const ev = new Event('pointerover', { bubbles: true });
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    div.dispatchEvent(ev);
    expect(div.dataset.fxCursor).toBeUndefined();
    div.remove();
  });

  it('tap sparkles and cart effects stay off in the panel', async () => {
    mockPath = '/admin/products';
    withTheme(<FestivalEffects />);
    await warm();
    const link = document.createElement('a');
    link.href = '/products/x';
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    emitCartAddIntent();
    await flush();
    link.remove();
    expect(engine.sparkle).not.toHaveBeenCalled();
    expect(engine.burst).not.toHaveBeenCalled();
    expect(engine.flyToCart).not.toHaveBeenCalled();
  });

  it('no trail in the panel when the theme is off', async () => {
    mockPath = '/team';
    withTheme(<FestivalEffects />, null, false);
    await warm();
    moveAt(50, 1000);
    expect(engine.trail).not.toHaveBeenCalled();
  });

  it('no trail in the panel under reduced motion', async () => {
    setMouse(true);
    mockPath = '/team';
    withTheme(<FestivalEffects />);
    await warm();
    moveAt(50, 1000);
    expect(engine.trail).not.toHaveBeenCalled();
  });
});

describe('festive cursor on page-styled clickables (careers role cards, filter labels)', () => {
  const setPointer = (fine: boolean, reduce = false) => {
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: (q.includes('reduce') && reduce) || (q.includes('pointer: fine') && fine),
      media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
    }));
  };
  const over = (el: Element, pointerType = 'mouse') => {
    const ev = new Event('pointerover', { bubbles: true }) as PointerEvent;
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  };
  /** A page's own markup: a div styled `cursor: pointer`, one `cursor: default`, one inheriting. */
  const page = () => {
    const root = document.createElement('div');
    root.innerHTML = '<div id="card" style="cursor: pointer"><span id="child">Role</span></div><div id="arrow" style="cursor: default"></div><p id="plain">Text</p>';
    document.body.appendChild(root);
    return {
      root,
      card: root.querySelector<HTMLElement>('#card')!,
      child: root.querySelector<HTMLElement>('#child')!,
      arrow: root.querySelector<HTMLElement>('#arrow')!,
      plain: root.querySelector<HTMLElement>('#plain')!,
    };
  };
  let dom: ReturnType<typeof page>;
  beforeEach(() => { mockPath = '/careers'; dom = page(); });
  afterEach(() => { dom.root.remove(); mockPath = '/'; });

  it('marks a plain hand as "hand" and a plain arrow as "base"; leaves the rest alone', () => {
    setPointer(true);
    withTheme(<FestivalEffects />);
    over(dom.card); over(dom.arrow); over(dom.plain);
    expect(dom.card.dataset.fxCursor).toBe('hand');
    // (A child inheriting the hand is covered in the browser check: jsdom does not inherit `cursor`.)
    expect(dom.arrow.dataset.fxCursor).toBe('base');
    expect(dom.plain.dataset.fxCursor).toBeUndefined();
  });

  it('is still shown with reduced motion (a still cursor is not motion)', () => {
    setPointer(true, true);
    withTheme(<FestivalEffects />);
    over(dom.card);
    expect(dom.card.dataset.fxCursor).toBe('hand');
  });

  it('never runs for touch/pen, on phones (no fine pointer), when the festival is off, or on checkout', () => {
    setPointer(true);
    const a = withTheme(<FestivalEffects />);
    over(dom.card, 'touch'); over(dom.card, 'pen');
    expect(dom.card.dataset.fxCursor).toBeUndefined();
    a.unmount();

    setPointer(false);
    const b = withTheme(<FestivalEffects />);
    over(dom.card);
    expect(dom.card.dataset.fxCursor).toBeUndefined();
    b.unmount();

    setPointer(true);
    const c = withTheme(<FestivalEffects />, null, false);
    over(dom.card);
    expect(dom.card.dataset.fxCursor).toBeUndefined();
    c.unmount();

    mockPath = '/checkout';
    withTheme(<FestivalEffects />);
    over(dom.card);
    expect(dom.card.dataset.fxCursor).toBeUndefined();
  });

  it('stops listening once unmounted', () => {
    setPointer(true);
    const view = withTheme(<FestivalEffects />);
    view.unmount();
    over(dom.card);
    expect(dom.card.dataset.fxCursor).toBeUndefined();
  });
});
