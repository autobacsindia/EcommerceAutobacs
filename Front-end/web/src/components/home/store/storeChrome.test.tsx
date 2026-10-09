/**
 * The light store header/footer/finder now dress every customer page, so the
 * behaviours a customer relies on to reach products are pinned here.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import StoreHeader from './StoreHeader';
import StoreFooter from './StoreFooter';
import ShopByVehicleCard from './ShopByVehicleCard';
import ConditionalHeader from '@/components/layout/ConditionalHeader';
import HelpWidget from '@/components/layout/HelpWidget';

const push = jest.fn();
let pathname = '/products';
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ itemCount: 0 }) }));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useVehicleMakes: () => ({ data: [{ _id: 'Toyota', name: 'Toyota' }, { _id: 'Kia', name: 'Kia' }] }),
  useVehicleModels: (make: string) => ({ data: make ? ['Hilux', 'Fortuner'] : [], isFetching: false }),
}));
jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

const cats = [{ name: 'Lighting', href: '/categories/lighting' }];

beforeAll(() => {
  // jsdom has no pointer capture; the Need-help tab calls it on drag.
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  push.mockReset();
  pathname = '/products';
  localStorage.clear();
});

describe('StoreHeader mobile menu', () => {
  it('renders the drawer at <body> level, outside the sticky header', () => {
    const { container } = render(<StoreHeader categories={cats} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    // Inside the header it would be capped by the header's stacking context and
    // sit under the floating contact buttons.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    // Still themed: the drawer's buttons/links read the store tokens.
    expect(dialog).toHaveClass('sh-theme');
    expect(within(dialog).getByRole('link', { name: 'Lighting' })).toHaveAttribute('href', '/categories/lighting');
  });

  it('closes on Escape and on a link tap, and restores page scrolling', () => {
    render(<StoreHeader categories={cats} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Lighting' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('search submits to the search page and ignores blank input', () => {
    render(<StoreHeader categories={cats} />);
    const box = screen.getAllByRole('searchbox')[0] ?? screen.getAllByRole('textbox')[0];
    fireEvent.submit(box.closest('form')!);
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: ' led bar ' } });
    fireEvent.submit(box.closest('form')!);
    expect(push).toHaveBeenCalledWith('/products/search?q=led%20bar');
  });
});

describe('StoreHeader department bar', () => {
  it('underlines the department you are in and links Track Order', () => {
    pathname = '/categories/lighting';
    render(<StoreHeader categories={cats} />);
    const bar = screen.getByRole('navigation', { name: 'Shop departments' });
    expect(within(bar).getByRole('link', { name: 'Lighting' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: "Today's Deals" })).not.toHaveAttribute('aria-current');
    expect(within(bar).getByRole('link', { name: /Track Order/ })).toHaveAttribute('href', '/track');
  });

  it('the Go button submits the search', () => {
    render(<StoreHeader categories={cats} />);
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'winch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(push).toHaveBeenCalledWith('/products/search?q=winch');
  });
});

describe('Back to top', () => {
  it('the global header carries the #top anchor the footer links to', () => {
    const { container } = render(<><ConditionalHeader navCategories={[]} /><StoreFooter /></>);
    expect(screen.getByRole('link', { name: 'Back to top' })).toHaveAttribute('href', '#top');
    expect(container.querySelector('#top')).not.toBeNull();
    expect(container.querySelectorAll('#top')).toHaveLength(1);
    // A sticky element is "already in view", so jumping to it would not scroll.
    expect(container.querySelector('#top')).not.toHaveClass('sh-chrome');
  });
});

describe('Finder card ("Parts that fit your car")', () => {
  it('Show parts stays disabled until a make is picked, then filters by make + model', () => {
    render(<ShopByVehicleCard />);
    const go = screen.getByRole('button', { name: 'Show parts' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Car make'), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText('Car model'), { target: { value: 'Hilux' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    expect(push).toHaveBeenCalledWith('/products?vehicleMake=Toyota&vehicleModel=Hilux');
  });

  it('make-only search leaves the model out of the URL', () => {
    render(<ShopByVehicleCard />);
    fireEvent.change(screen.getByLabelText('Car make'), { target: { value: 'Kia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show parts' }));
    expect(push).toHaveBeenCalledWith('/products?vehicleMake=Kia');
  });

  it('one-tap make chips link only to makes we stock', () => {
    render(<ShopByVehicleCard />);
    expect(screen.getByRole('link', { name: 'Toyota' })).toHaveAttribute('href', '/products?vehicleMake=Toyota');
    expect(screen.queryByRole('link', { name: 'Mahindra' })).toBeNull();
  });
});

describe('Need-help tab never covers the sticky header on desktop', () => {
  const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  const topOf = () => parseFloat(screen.getByRole('button', { name: /Need help/ }).style.top);

  it('a saved position at the very top is pushed below the header on desktop', () => {
    setWidth(1440);
    localStorage.setItem('help-widget-top-ratio', '0');
    render(<HelpWidget />);
    expect(topOf()).toBeGreaterThanOrEqual(134);
  });

  it('dragging up stops below the header', () => {
    setWidth(1440);
    render(<HelpWidget />);
    const tab = screen.getByRole('button', { name: /Need help/ });
    const start = topOf();
    act(() => {
      fireEvent.pointerDown(tab, { clientY: start + 10, pointerId: 1 });
      fireEvent.pointerMove(tab, { clientY: -500, pointerId: 1 });
      fireEvent.pointerUp(tab, { clientY: -500, pointerId: 1 });
    });
    expect(topOf()).toBeGreaterThanOrEqual(134);
  });

  it('on phones (header not sticky) it may still sit near the top edge', () => {
    setWidth(375);
    localStorage.setItem('help-widget-top-ratio', '0');
    render(<HelpWidget />);
    expect(topOf()).toBeLessThan(134);
  });
});
