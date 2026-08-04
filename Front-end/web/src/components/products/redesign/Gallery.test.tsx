import { fireEvent, render, screen, within } from '@testing-library/react';
import Gallery, { type GalleryImage } from './Gallery';

// next/image is replaced with a plain <img> so assertions can read `src`/`alt`
// directly; the real component's srcset machinery is not what these tests are
// about. `fill`/`priority` are stripped because React warns about unknown
// boolean attributes on a DOM node.
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src as string}
      alt={alt as string}
      data-priority={priority ? 'true' : undefined}
      {...(rest as Record<string, unknown>)}
    />
  ),
}));

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/autobacs/products';

const makeImages = (count: number): GalleryImage[] =>
  Array.from({ length: count }, (_, i) => ({
    src: `${CLOUDINARY}/img-${i}.jpg`,
    alt: `Roav bumper image ${i + 1}`,
  }));

// jsdom paints nothing, so BOTH breakpoint subtrees are queryable at once
// (a real browser exposes only one — `display: none` drops the other from the
// accessibility tree). Scope by test id to address the intended variant.
const zoomFrame = () => screen.getByTestId('gallery-zoom');
const carousel = () => within(screen.getByTestId('gallery-carousel'));
const dialog = () => screen.getByRole('dialog');

/** Thumbnail rail on the page, excluding the copy inside the viewer. */
const pageThumbnails = () =>
  screen
    .getAllByRole('button', { name: /^show image \d+ of \d+$/i })
    .filter((el) => el.closest('dialog') === null);

const setMatchMedia = (matcher: (query: string) => boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: matcher(query),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
};

beforeEach(() => {
  setMatchMedia(() => false);
});

describe('Gallery', () => {
  it('renders a thumbnail for every image, not just the first five', () => {
    // Regression lock: the previous gallery did `images.slice(0, 5)`, silently
    // dropping uploads 6+ with no way for merchandising to notice.
    render(<Gallery images={makeImages(8)} name="Roav bumper" />);

    expect(pageThumbnails()).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show image 8 of 8' })).toBeInTheDocument();
  });

  it('renders the empty state without crashing when a product has no images', () => {
    render(<Gallery images={[]} name="Roav bumper" />);

    expect(screen.getByText('No image')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the rail and the pager chrome for a single-image product', () => {
    render(<Gallery images={makeImages(1)} name="Roav bumper" />);

    expect(screen.queryByRole('button', { name: /^show image/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^go to image/i })).not.toBeInTheDocument();
  });

  it('marks only the first image as the LCP priority candidate', () => {
    render(<Gallery images={makeImages(3)} name="Roav bumper" />);

    const prioritised = document.querySelectorAll('img[data-priority="true"]');
    // One per breakpoint variant (carousel slide 0 + desktop magnifier base),
    // both pointing at the same URL so the preload dedupes.
    expect(prioritised).toHaveLength(2);
    prioritised.forEach((img) => expect(img).toHaveAttribute('src', `${CLOUDINARY}/img-0.jpg`));
  });

  it('does not crop the main image', () => {
    // A PDP must never hide product geometry to fill a square frame.
    render(<Gallery images={makeImages(2)} name="Roav bumper" />);

    expect(within(zoomFrame()).getByAltText('Roav bumper image 1')).toHaveClass('object-contain');
    expect(carousel().getByAltText('Roav bumper image 1')).toHaveClass('object-contain');
  });

  it('selecting a thumbnail swaps the desktop main image', () => {
    render(<Gallery images={makeImages(4)} name="Roav bumper" />);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 3 of 4' }));

    expect(within(zoomFrame()).getByAltText('Roav bumper image 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show image 3 of 4' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  it('clamps a stale index when the image list shrinks', () => {
    const { rerender } = render(<Gallery images={makeImages(4)} name="Roav bumper" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show image 4 of 4' }));

    rerender(<Gallery images={makeImages(2)} name="Roav bumper" />);

    expect(within(zoomFrame()).getByAltText('Roav bumper image 2')).toBeInTheDocument();
  });

  describe('hover zoom', () => {
    it('stays inert on touch devices, where a tap fires synthetic pointer events', () => {
      setMatchMedia(() => false); // no `(hover: hover) and (pointer: fine)`
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      const frame = zoomFrame();
      fireEvent.pointerEnter(frame, { clientX: 10, clientY: 10 });

      expect(frame.querySelector('[style*="scale"]')).toBeNull();
      expect(frame).toHaveClass('cursor-pointer');
    });

    it('magnifies at the pointer on a hover-capable device', () => {
      setMatchMedia((q) => q.includes('hover: hover'));
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      const frame = zoomFrame();
      jest
        .spyOn(frame, 'getBoundingClientRect')
        .mockReturnValue({ left: 0, top: 0, width: 600, height: 600 } as DOMRect);

      fireEvent.pointerEnter(frame, { clientX: 150, clientY: 450 });

      const layer = frame.querySelector<HTMLElement>('[style*="scale"]');
      expect(layer).not.toBeNull();
      expect(layer!.style.transform).toBe('scale(2)');
      // Origin must land on the pointer in the same frame as the scale, or the
      // image visibly swings across from wherever it was left.
      expect(layer!.style.transformOrigin).toBe('25% 75%');

      fireEvent.pointerLeave(frame);
      expect(frame.querySelector('[style*="scale"]')).toBeNull();
    });

    it('tracks pointer movement through a single coalescing frame', async () => {
      setMatchMedia((q) => q.includes('hover: hover'));
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      const frame = zoomFrame();
      jest
        .spyOn(frame, 'getBoundingClientRect')
        .mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);

      fireEvent.pointerEnter(frame, { clientX: 0, clientY: 0 });
      // A burst of moves must collapse into one style write, not one per event.
      fireEvent.pointerMove(frame, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(frame, { clientX: 300, clientY: 200 });

      const layer = frame.querySelector<HTMLElement>('[style*="scale"]')!;
      expect(layer.style.transformOrigin).toBe('0% 0%'); // not yet flushed

      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      expect(layer.style.transformOrigin).toBe('75% 50%'); // last position wins
    });

    it('clamps the origin so a pointer outside the frame cannot expose an edge', () => {
      setMatchMedia((q) => q.includes('hover: hover'));
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      const frame = zoomFrame();
      jest
        .spyOn(frame, 'getBoundingClientRect')
        .mockReturnValue({ left: 0, top: 0, width: 600, height: 600 } as DOMRect);

      fireEvent.pointerEnter(frame, { clientX: -80, clientY: 9000 });

      expect(frame.querySelector<HTMLElement>('[style*="scale"]')!.style.transformOrigin).toBe(
        '0% 100%'
      );
    });

    it('requests the sharp source only once the pointer arrives', () => {
      setMatchMedia((q) => q.includes('hover: hover'));
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      const sharpSources = () =>
        Array.from(document.querySelectorAll('img'))
          .map((img) => img.getAttribute('src') ?? '')
          .filter((src) => src.includes('w_1600'));

      // A visitor who never hovers pays nothing for the zoom resolution.
      expect(sharpSources()).toHaveLength(0);

      fireEvent.pointerEnter(zoomFrame(), { clientX: 10, clientY: 10 });
      expect(sharpSources()[0]).toContain('img-0.jpg');
    });
  });

  describe('lightbox', () => {
    it('is reachable by keyboard, since hover zoom is not', () => {
      render(<Gallery images={makeImages(3)} name="Roav bumper" />);

      // The main frame is a real button: Enter/Space activate it natively.
      const frame = zoomFrame();
      expect(frame.tagName).toBe('BUTTON');

      fireEvent.click(frame);
      expect(screen.getByRole('dialog', { name: 'Roav bumper image viewer' })).toBeInTheDocument();
    });

    it('opens at the image that was tapped, not at the first one', () => {
      render(<Gallery images={makeImages(5)} name="Roav bumper" />);

      fireEvent.click(carousel().getByRole('button', { name: /image 4 in fullscreen/i }));

      expect(within(dialog()).getByText('4 / 5')).toBeInTheDocument();
    });

    it('navigates with arrow keys and wraps around', () => {
      render(<Gallery images={makeImages(3)} name="Roav bumper" />);
      fireEvent.click(zoomFrame());

      expect(within(dialog()).getByText('1 / 3')).toBeInTheDocument();

      fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
      expect(within(dialog()).getByText('2 / 3')).toBeInTheDocument();

      fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
      fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
      expect(within(dialog()).getByText('3 / 3')).toBeInTheDocument();
    });

    it('leaves the page on the image the customer was last viewing', () => {
      render(<Gallery images={makeImages(4)} name="Roav bumper" />);
      fireEvent.click(zoomFrame());

      fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
      fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));

      expect(within(zoomFrame()).getByAltText('Roav bumper image 2')).toBeInTheDocument();
    });

    it('restores background scrolling on close', () => {
      render(<Gallery images={makeImages(2)} name="Roav bumper" />);

      fireEvent.click(zoomFrame());
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));
      expect(document.body.style.overflow).toBe('');
    });

    it('keeps full-size sources out of the DOM until it is opened, then windows them', () => {
      render(<Gallery images={makeImages(4)} name="Roav bumper" />);

      const fullSize = () =>
        Array.from(document.querySelectorAll('dialog img')).filter((img) =>
          (img.getAttribute('src') ?? '').includes('w_1600')
        );

      expect(fullSize()).toHaveLength(0);

      fireEvent.click(zoomFrame());
      // Active slide plus its immediate neighbour — never all four at once.
      expect(fullSize()).toHaveLength(2);
    });

    it('unmounts its contents on close so full-size images are released', () => {
      render(<Gallery images={makeImages(3)} name="Roav bumper" />);

      fireEvent.click(zoomFrame());
      fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));

      expect(document.querySelectorAll('dialog img')).toHaveLength(0);
    });
  });
});
