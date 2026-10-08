import { render, screen, fireEvent } from '@testing-library/react';
import Showreel from './Showreel';
import { FALLBACK_CAR_HOTSPOTS } from '@/lib/carHotspots';

// useCanRender3D reads matchMedia (absent in jsdom). Force the light path so the
// static renderer (no WebGL) mounts — that's what mobile/SSR gets anyway.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('Showreel — interactive car explorer', () => {
  it('renders the car hub links, chips and required credit when hotspots resolve', () => {
    render(<Showreel hotspots={FALLBACK_CAR_HOTSPOTS} />);

    // Hub links present (crawlable / no-JS path).
    expect(screen.getAllByRole('link', { name: 'Lighting' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Suspension' }).length).toBeGreaterThan(0);
    // Abstract-hub chip.
    expect(screen.getAllByRole('link', { name: 'Portable Fridge' }).length).toBeGreaterThan(0);
    // Required CC-BY attribution is visible.
    expect(screen.getByText(/CC-BY-4\.0/)).toBeInTheDocument();
    // The interactive strip label, not the video placeholder.
    expect(screen.getByText('Interactive Fitment Explorer')).toBeInTheDocument();
    expect(screen.queryByText('Play Showreel')).toBeNull();
  });

  it('every resolved hub link points at /categories/<slug>', () => {
    render(<Showreel hotspots={FALLBACK_CAR_HOTSPOTS} />);
    const links = screen.getAllByRole('link', { name: 'Lighting' });
    expect(links[0]).toHaveAttribute('href', '/categories/lighting');
  });

  it('falls back to the placeholder stage when no hotspots resolve', () => {
    render(<Showreel hotspots={[]} />);
    expect(screen.getByText('Play Showreel')).toBeInTheDocument();
    expect(screen.queryByText('Interactive Fitment Explorer')).toBeNull();
  });
});

describe('Showreel — "Choose an area" panel', () => {
  it('numbers every part and highlights it on the car when hovered', () => {
    const { container } = render(<Showreel hotspots={FALLBACK_CAR_HOTSPOTS} />);
    const panel = screen.getByRole('complementary', { name: /browse by part of the car/i });
    const points = FALLBACK_CAR_HOTSPOTS.filter((h) => !h.chip);
    const items = panel.querySelectorAll('.ce-item');
    expect(items).toHaveLength(points.length);

    fireEvent.mouseEnter(items[0]);
    expect(items[0]).toHaveClass('is-active');
    // The matching numbered marker on the car shows its label pill.
    const marker = container.querySelector(`.anim-stage a[aria-label^="${points[0].label}"]`) as HTMLElement;
    expect(marker.textContent).toContain('1');
    expect(marker.querySelector('.opacity-100')).not.toBeNull();

    fireEvent.mouseLeave(items[0]);
    expect(items[0]).not.toHaveClass('is-active');
  });

  it('tells the shopper how to use it', () => {
    render(<Showreel hotspots={FALLBACK_CAR_HOTSPOTS} />);
    expect(screen.getByText(/drag to rotate · click a point to shop/i)).toBeInTheDocument();
  });
});
