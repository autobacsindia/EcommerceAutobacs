/**
 * The home page testimonial slider.
 *
 * jsdom has no layout: every element reports a height of 0, so the "is this
 * quote actually cut off?" measurement has to be faked here. That is the point
 * of the first block — the button must appear for a clipped quote and NOT for a
 * short one, because a "View full review" link that opens the same two lines
 * already on screen is worse than no link.
 *
 * The rest pins the behaviour that is easy to delete by accident: every flagged
 * testimonial is rendered (the old grid silently showed three), and the
 * auto-advance stops when someone is reading.
 */
import { render, screen, act, fireEvent } from '@testing-library/react';
import ReviewStrip from './ReviewStrip';
import type { StoreReview } from './storeData';

const review = (over: Partial<StoreReview> = {}): StoreReview => ({
  quote: 'Great kit, solid fitment.',
  name: 'Anil',
  rating: 5,
  verified: true,
  ...over,
});

/** Make every quote report as overflowing (or not), since jsdom lays out nothing. */
function setQuoteOverflow(overflowing: boolean) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return this.hasAttribute('data-quote') && overflowing ? 200 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return 0; },
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }) as unknown as typeof window.matchMedia;
  Element.prototype.scrollTo = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ReviewStrip', () => {
  it('renders nothing when no review has been flagged as a testimonial', () => {
    const { container } = render(<ReviewStrip reviews={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every testimonial, not just the first three', () => {
    setQuoteOverflow(false);
    const many = Array.from({ length: 7 }, (_, i) => review({ name: `Person ${i}` }));
    render(<ReviewStrip reviews={many} />);
    expect(screen.getAllByText(/^Person \d$/)).toHaveLength(7);
  });

  it('offers the full text only when the quote is actually cut off', () => {
    setQuoteOverflow(true);
    const { unmount } = render(<ReviewStrip reviews={[review({ quote: 'x'.repeat(900) })]} />);
    expect(screen.getByRole('button', { name: /view full review/i })).toBeInTheDocument();
    unmount();

    setQuoteOverflow(false);
    render(<ReviewStrip reviews={[review({ quote: 'Short one.' })]} />);
    expect(screen.queryByRole('button', { name: /view full review/i })).not.toBeInTheDocument();
  });

  it('opens the whole review in a dialog, and closes again', () => {
    setQuoteOverflow(true);
    const long = 'The fitment was clean and factory like. '.repeat(12);
    render(<ReviewStrip reviews={[review({ quote: long, name: 'KP' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /view full review/i }));
    const dialog = screen.getByRole('dialog', { name: /review by kp/i });
    expect(dialog).toHaveTextContent('The fitment was clean and factory like.');

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('advances on its own, and stops while someone is reading', () => {
    setQuoteOverflow(false);
    render(<ReviewStrip reviews={[review({ name: 'A' }), review({ name: 'B' })]} />);
    const track = screen.getByRole('group', { name: /2 customer reviews/i });

    act(() => { jest.advanceTimersByTime(6000); });
    expect(track.scrollTo).toHaveBeenCalled();

    (track.scrollTo as jest.Mock).mockClear();
    fireEvent.mouseEnter(track);
    act(() => { jest.advanceTimersByTime(12000); });
    expect(track.scrollTo).not.toHaveBeenCalled();

    fireEvent.mouseLeave(track);
    act(() => { jest.advanceTimersByTime(6000); });
    expect(track.scrollTo).toHaveBeenCalled();
  });

  it('never moves on its own for a visitor who asked for reduced motion', () => {
    setQuoteOverflow(false);
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;

    render(<ReviewStrip reviews={[review({ name: 'A' }), review({ name: 'B' })]} />);
    const track = screen.getByRole('group', { name: /2 customer reviews/i });
    act(() => { jest.advanceTimersByTime(30000); });
    expect(track.scrollTo).not.toHaveBeenCalled();
  });
});
