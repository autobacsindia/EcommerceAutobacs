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

  /**
   * Prize artwork. The wheel is configured per campaign, so a half-filled `images`
   * array is the normal state, not an error — these pin that a missing picture costs
   * you an icon and nothing else.
   */
  describe('prize artwork', () => {
    const withArt = ['https://cdn.test/tshirt.png', 'https://cdn.test/cup.png'];

    /*
      THE REGRESSION THIS GUARDS.

      Prize artwork is stored as Cloudinary's raw secure_url, which carries no delivery
      transform — so Cloudinary served the full-resolution original to paint a 26px icon.
      The wheel drew immediately with blank slices while megabytes were still downloading,
      and the artwork only showed up once the browser had it cached, i.e. after a refresh.
      It presented as a caching bug and was the exact opposite: nothing was cached yet.
    */
    it('requests a small, format-optimised rendition of a Cloudinary image', () => {
      const stored = 'https://res.cloudinary.com/demo/image/upload/v1783950357/autobacs/spin/tshirt.jpg';
      const { container } = render(
        <SpinGauge labels={[LABELS[0]]} images={[stored]} winningIndex={null} spinning={false} />,
      );
      const href = container.querySelector('image')?.getAttribute('href') ?? '';

      expect(href).not.toBe(stored);          // the original must never be shipped
      expect(href).toContain('/image/upload/');
      expect(href).toContain('f_auto');       // AVIF/WebP where supported
      expect(href).toContain('c_limit');      // downscale only — never upscaled
      expect(href).toMatch(/w_\d+/);          // bounded to the icon's real size
      expect(href).toContain('autobacs/spin/tshirt.jpg'); // same asset, not a new upload
    });

    // A prize picture hosted anywhere else must still render — the transform is an
    // optimisation, never a requirement.
    it('leaves a non-Cloudinary image URL untouched', () => {
      const { container } = render(
        <SpinGauge labels={[LABELS[0]]} images={['https://cdn.test/tshirt.png']} winningIndex={null} spinning={false} />,
      );
      expect(container.querySelector('image')).toHaveAttribute('href', 'https://cdn.test/tshirt.png');
    });

    it('draws one icon per slice that has a picture', () => {
      const { container } = render(
        <SpinGauge labels={LABELS} images={withArt} winningIndex={null} spinning={false} />,
      );
      const images = container.querySelectorAll('image');
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute('href', withArt[0]);
    });

    it('keeps the text label even when a slice has a picture', () => {
      // The icon supplements the name, never replaces it: a dead image URL paints
      // nothing on an SVG <image> and there is no onError to catch it, so a wheel
      // relying on art alone would show blank wedges.
      render(<SpinGauge labels={LABELS} images={withArt} winningIndex={null} spinning={false} />);
      expect(screen.getByText(LABELS[0])).toBeInTheDocument();
    });

    it('renders slices with no picture as plain labels', () => {
      const { container } = render(
        <SpinGauge labels={LABELS} images={[withArt[0], null]} winningIndex={null} spinning={false} />,
      );
      expect(container.querySelectorAll('image')).toHaveLength(1);
      expect(screen.getByText(LABELS[1])).toBeInTheDocument();
    });

    it('renders unchanged when images is omitted entirely (legacy results)', () => {
      const { container } = render(
        <SpinGauge labels={LABELS} winningIndex={null} spinning={false} />,
      );
      expect(container.querySelectorAll('image')).toHaveLength(0);
      expect(screen.getByText(LABELS[0])).toBeInTheDocument();
    });

    it('stacks the icon ABOVE the label, not beside it', () => {
      // The label reads radially, so an icon offset along the radius lands next to the
      // words instead of over them. Both must therefore sit in ONE rotated frame with a
      // perpendicular offset — this asserts exactly that, because the obvious
      // "simplification" back to two separately-rotated elements reintroduces the bug.
      const { container } = render(
        <SpinGauge labels={[LABELS[0]]} images={[withArt[0]]} winningIndex={null} spinning={false} />,
      );
      const img = container.querySelector('image')!;
      const text = container.querySelector('text')!;

      // Same parent = same rotation = the stack survives on every wedge of the dial.
      expect(img.parentElement).toBe(text.parentElement);
      expect(img.parentElement?.getAttribute('transform')).toMatch(/^rotate\(/);

      // Pre-rotation coords: the icon's lower edge must clear the label's baseline.
      const imgBottom = Number(img.getAttribute('y')) + Number(img.getAttribute('height'));
      expect(imgBottom).toBeLessThan(Number(text.getAttribute('y')));
    });

    it('leaves the label centred in its wedge when there is no icon', () => {
      // A slice with no art must not inherit the offset that makes room for one.
      const { container } = render(
        <SpinGauge labels={[LABELS[0]]} winningIndex={null} spinning={false} />,
      );
      const text = container.querySelector('text')!;
      const withIcon = render(
        <SpinGauge labels={[LABELS[0]]} images={[withArt[0]]} winningIndex={null} spinning={false} />,
      ).container.querySelector('text')!;
      expect(Number(text.getAttribute('y'))).toBeLessThan(Number(withIcon.getAttribute('y')));
    });

    it('ignores an images array longer than the label list', () => {
      const { container } = render(
        <SpinGauge labels={[LABELS[0]]} images={withArt} winningIndex={null} spinning={false} />,
      );
      expect(container.querySelectorAll('image')).toHaveLength(1);
    });
  });
});
