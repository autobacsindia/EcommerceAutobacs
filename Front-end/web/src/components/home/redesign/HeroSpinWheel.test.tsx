import { act, render, screen } from '@testing-library/react';
import HeroSpinWheel, { SPIN_DURATION_MS } from './HeroSpinWheel';
import { SLIDE_DWELL_MS } from './useHeroCarousel';
import type { SpinTeaserPrize } from './homeData';

/**
 * The decorative hero wheel.
 *
 * ⚠ Not the reward wheel. components/spin/SpinGauge.tsx is the one bound to a
 * server-committed `winningIndex`; this one is theatre and must stay that way. The
 * tests below pin the two properties that keep it honest: it announces a possibility
 * rather than a win, and it is hidden from assistive tech entirely (the slide's own
 * text carries the prize list).
 */

function mockMatchMedia(reducedMotion = false) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

const prizes: SpinTeaserPrize[] = [
  { name: 'Dash Cam', shortLabel: 'Dash Cam', imageUrl: null, kind: 'goodie' },
  { name: 'Steel Mug', shortLabel: 'Steel Mug', imageUrl: null, kind: 'goodie' },
  { name: 'Fuel Cap', shortLabel: 'Fuel Cap', imageUrl: null, kind: 'goodie' },
  { name: '₹500 Off', shortLabel: '₹500 Off', imageUrl: null, kind: 'coupon' },
];

describe('HeroSpinWheel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('draws one wedge label per prize', () => {
    render(<HeroSpinWheel prizes={prizes} active={false} />);
    for (const p of prizes) {
      expect(screen.getByText(p.shortLabel)).toBeInTheDocument();
    }
  });

  it('renders nothing below three prizes — two wedges is not a dial', () => {
    const { container } = render(<HeroSpinWheel prizes={prizes.slice(0, 2)} active />);
    expect(container).toBeEmptyDOMElement();
  });

  it('spins when the slide becomes active and settles on a possibility, not a win', () => {
    const { rerender } = render(<HeroSpinWheel prizes={prizes} active={false} />);
    expect(screen.queryByText(/Spinning/)).not.toBeInTheDocument();

    rerender(<HeroSpinWheel prizes={prizes} active />);
    expect(screen.getByText('Spinning…')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(SPIN_DURATION_MS); });

    // "Could land on", never "you won" — nothing has been awarded and no stock moved.
    const status = screen.getByText(/Could land on —/);
    expect(status).toBeInTheDocument();
    expect(status.textContent).not.toMatch(/you /i);
  });

  it('settles inside the slide dwell, so the result is readable before the slide leaves', () => {
    /*
      Read against SLIDE_DWELL_MS, never a literal. Hard-coding the number here is how
      this guard would keep passing after someone changes the dwell out from under it.

      Both directions matter. Lengthen the spin past the dwell and the wheel is cut off
      mid-rotation every time; shorten the dwell to the spin and the "Could land on — X"
      line — the entire point of the animation — is gone before it can be read. Hence a
      margin, not just "less than".
    */
    expect(SPIN_DURATION_MS).toBeLessThan(SLIDE_DWELL_MS);
    // At least a second of the landed result on screen before the slide moves on.
    expect(SLIDE_DWELL_MS - SPIN_DURATION_MS).toBeGreaterThanOrEqual(1000);
  });

  it('under reduced motion it neither animates nor claims a result', () => {
    mockMatchMedia(true);
    render(<HeroSpinWheel prizes={prizes} active />);

    act(() => { jest.advanceTimersByTime(SPIN_DURATION_MS * 2); });

    // A result appearing with no visible spin reads as a claim rather than a demo.
    expect(screen.queryByText(/Could land on/)).not.toBeInTheDocument();
    expect(screen.queryByText('Spinning…')).not.toBeInTheDocument();
  });

  it('always advances the needle forwards across repeat activations', () => {
    const { container, rerender } = render(<HeroSpinWheel prizes={prizes} active />);
    const needle = () => container.querySelector('g[transform^="rotate("]')!;
    const angleOf = (el: Element) =>
      Number(/rotate\(([-\d.]+)/.exec(el.getAttribute('transform') ?? '')?.[1] ?? '0');

    act(() => { jest.advanceTimersByTime(SPIN_DURATION_MS); });
    const first = angleOf(needle());
    expect(first).toBeGreaterThan(0);

    rerender(<HeroSpinWheel prizes={prizes} active={false} />);
    rerender(<HeroSpinWheel prizes={prizes} active />);
    act(() => { jest.advanceTimersByTime(SPIN_DURATION_MS); });

    // Rewinding to an absolute angle would spin the needle backwards whenever the new
    // target sat behind the old one.
    expect(angleOf(needle())).toBeGreaterThan(first);
  });

  it('is hidden from assistive tech — the slide text carries the prizes instead', () => {
    const { container } = render(<HeroSpinWheel prizes={prizes} active={false} />);
    expect(container.querySelector('.hero-spin-dial')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.hero-spin-status')).toHaveAttribute('aria-hidden', 'true');
  });

  it('requests prize art at icon size, never the full-resolution original', () => {
    render(
      <HeroSpinWheel
        prizes={prizes.map((p) => ({
          ...p,
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/prize.png',
        }))}
        active={false}
      />,
    );
    // The raw secure_url carries no delivery transform, so Cloudinary would serve a
    // multi-megabyte original to paint a 40px disc — the trap SpinGauge documents.
    const img = document.querySelector('.hero-spin-icon img')!;
    expect(img.getAttribute('src')).toMatch(/w_120/);
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});
