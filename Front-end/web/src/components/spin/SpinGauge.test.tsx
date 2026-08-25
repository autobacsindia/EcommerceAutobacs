/**
 * Speedometer — the property that matters is that it NEVER decides anything.
 *
 * The needle must land on the segment the SERVER chose. If this component ever picked its
 * own outcome, the client would become authoritative over real physical stock, which is
 * the one failure this whole feature is built to prevent.
 */
import { render, screen } from '@testing-library/react';
import SpinGauge from './SpinGauge';

const LABELS = ['Cloth', 'Keychain', 'Dashcam', '10% OFF'];

describe('SpinGauge', () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the component reads prefers-reduced-motion.
    // Reporting `reduce` makes the animation resolve synchronously, so the settled
    // state is assertable without fake timers.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('reduce'),
        media: query, onchange: null,
        addListener: jest.fn(), removeListener: jest.fn(),
        addEventListener: jest.fn(), removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }),
    });
  });

  it('renders one wedge per label', () => {
    const { container } = render(<SpinGauge labels={LABELS} winningIndex={null} spinning={false} />);
    LABELS.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    // 4 wedges + tick marks; assert the wedge paths specifically.
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(LABELS.length);
  });

  it('announces the SERVER-chosen prize, not one of its own choosing', () => {
    render(<SpinGauge labels={LABELS} winningIndex={2} spinning={false} />);
    // Index 2 = Dashcam. The component must reflect that exact index.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'You won Dashcam');
  });

  it('is idle and announces no winner before a spin', () => {
    render(<SpinGauge labels={LABELS} winningIndex={null} spinning={false} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Prize speedometer');
  });

  it('calls onSettled once the needle has come to rest', () => {
    const onSettled = jest.fn();
    render(<SpinGauge labels={LABELS} winningIndex={1} spinning={false} onSettled={onSettled} />);
    // Reduced motion resolves immediately rather than after the 2.5s animation.
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('truncates a long label so it cannot overflow its wedge', () => {
    render(<SpinGauge labels={['An Extremely Long Prize Name']} winningIndex={null} spinning={false} />);
    expect(screen.getByText(/…$/)).toBeInTheDocument();
  });

  it('survives an empty label list without dividing by zero', () => {
    expect(() => render(<SpinGauge labels={[]} winningIndex={null} spinning={false} />)).not.toThrow();
  });
});
