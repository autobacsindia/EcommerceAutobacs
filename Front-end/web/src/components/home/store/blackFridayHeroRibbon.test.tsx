/**
 * Black Friday hero cards, "corner ribbon" design (owner, 2026-11-20): photo with the red
 * Save tag + green "₹0 DELIVERY" ribbon, full name, price with struck M.R.P., a ₹0-fees
 * checklist and a full-width button.
 *
 * The ₹0 claims follow the server: they appear only when it returned a fee waiver for the
 * product, which it does only for products orderable now. Backorder / sold-out / variable
 * products get an honest link instead of "Add to cart" and no ₹0 claims.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FESTIVAL_THEMES } from '@/lib/festival/themes';
import BlackFridayHero from './BlackFridayHero';
import { heroCardAction } from './BlackFridayHeroCard';
import type { FestiveHeroPhoto } from './FestiveHome';
jest.mock('@/hooks/queries/useDeliveryEstimates', () => ({
  useDeliveryEstimates: () => ({ estimates: null, pending: false }),
}));


jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number, o?: { exact?: boolean }) => require('@/test-utils/formatPriceMock').formatPriceMock(n, o) }),
}));
const mockAddToCart = jest.fn();
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ addToCart: mockAddToCart }) }));
const mockNotify = jest.fn();
jest.mock('@/hooks/useAddedToCartToast', () => ({ useAddedToCartToast: () => mockNotify }));
const mockToastError = jest.fn();
jest.mock('react-hot-toast', () => ({ toast: { error: (m: string) => mockToastError(m) } }));
let mockOfferPrice: { finalPrice: number } | null = null;
jest.mock('@/components/festival/FestivalOfferContext', () => ({ useFestivalOfferPrice: () => mockOfferPrice }));
const waiver = (save: number) => ({ discount: save - 3000, save, shipping: 1024, packing: 500, handling: 28.8, other: 1447.2, total: 3000 });
let mockWaivers: { live: boolean; products: Record<string, ReturnType<typeof waiver>> } | null = null;
let mockPending = false;
jest.mock('@/hooks/queries/useCardFeeWaivers', () => ({
  useCardFeeWaivers: () => ({ waivers: mockWaivers, pending: mockPending }),
}));

const THUNDER: FestiveHeroPhoto = { id: 'thunder', src: '/t.jpg', href: '/products/thunder', name: 'Profender Thunder Series', save: 9000, price: 283000, originalPrice: 292000, stock: 'in' };
const APEX: FestiveHeroPhoto = { id: 'apex', src: '/a.jpg', href: '/products/apex', name: 'Profender APEX', save: 31000, price: 400000, originalPrice: 431000, stock: 'backorder' };
const FORD: FestiveHeroPhoto = { id: 'ford', src: '/f.jpg', href: '/products/ford', name: 'Ford Endeavour F150 V3 kit', save: 0, price: 325000, stock: 'in' };

const renderHero = (photos: FestiveHeroPhoto[] = [THUNDER, APEX, FORD]) => render(
  <BlackFridayHero
    tokens={FESTIVAL_THEMES.blackfriday}
    theme={{ themeKey: 'blackfriday', startsAt: null, endsAt: null, live: true }}
    photos={photos}
    maxOff={40}
    dealsTotal={75}
    categoryCount={10}
  />,
);
const card = (name: string) => screen.getByText(name).closest('article') as HTMLElement;

beforeEach(() => {
  mockWaivers = null;
  mockPending = false;
  mockOfferPrice = null;
  mockAddToCart.mockReset().mockResolvedValue(undefined);
  mockNotify.mockReset();
  mockToastError.mockReset();
});

describe('offer live (server sent waivers)', () => {
  beforeEach(() => { mockWaivers = { live: true, products: { thunder: waiver(12223.5), ford: waiver(3000) } }; });

  it('orderable card: ribbon, "Save ₹X+", full name, price with struck M.R.P., 2×2 checklist, "Add to cart · Nothing extra"', () => {
    renderHero();
    const c = card('Profender Thunder Series');
    expect(within(c).getByTestId('bfh-zero-delivery')).toHaveTextContent(/₹0 Delivery/i);
    expect(c.querySelector('.bfh-card-tag')).toHaveTextContent('Save ₹12,223+');
    expect(within(c).getByTestId('bfh-card-price')).toHaveTextContent('₹2,83,000');
    expect(c.querySelector('.bfh-card-mrp s')).toHaveTextContent('₹2,92,000');
    const checks = c.querySelectorAll('.bfh-card-check');
    expect([...checks].map((x) => x.textContent)).toEqual(['₹0 shipping', '₹0 packing', '₹0 handling', '₹0 other fees']);
    expect(within(c).getByTestId('bfh-card-add')).toHaveTextContent(/Add to cart\s*Nothing extra/i);
  });

  it('no M.R.P. line when the product is not on sale', () => {
    renderHero();
    const c = card('Ford Endeavour F150 V3 kit');
    expect(c.querySelector('.bfh-card-mrp')).toBeNull();
    expect(within(c).getByTestId('bfh-card-price')).toHaveTextContent('₹3,25,000');
  });

  it('backorder card: no ribbon, no ₹0 checklist, discount-only tag, "Enquire" link instead of Add to cart', () => {
    renderHero();
    const c = card('Profender APEX');
    expect(within(c).queryByTestId('bfh-zero-delivery')).toBeNull();
    expect(c.querySelector('.bfh-card-check')).toBeNull();
    expect(c).not.toHaveTextContent('₹0');
    expect(c.querySelector('.bfh-card-tag')).toHaveTextContent('Save ₹31,000');
    expect(within(c).queryByTestId('bfh-card-add')).toBeNull();
    expect(within(c).getByTestId('bfh-card-view')).toHaveAttribute('href', '/consultation?product=Profender%20APEX');
  });

  it('a waiver the server sent for a product the card thinks is sold out is ignored (no ₹0 claim on a sold-out card)', () => {
    mockWaivers = { live: true, products: { thunder: waiver(12223.5) } };
    renderHero([{ ...THUNDER, stock: 'out' }]);
    const c = card('Profender Thunder Series');
    expect(within(c).queryByTestId('bfh-zero-delivery')).toBeNull();
    expect(within(c).getByTestId('bfh-card-view')).toHaveTextContent(/Sold out/i);
  });

  it('shows the festival-offer price the grid tiles show (same hook)', () => {
    mockOfferPrice = { finalPrice: 268850 };
    renderHero([THUNDER]);
    expect(within(card('Profender Thunder Series')).getByTestId('bfh-card-price')).toHaveTextContent('₹2,68,850');
  });
});

describe('add to cart', () => {
  it('adds once with the product id; a second tap while the first is in flight does nothing', async () => {
    let resolve: () => void = () => {};
    mockAddToCart.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    renderHero([THUNDER]);
    const btn = screen.getByTestId('bfh-card-add');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockAddToCart).toHaveBeenCalledTimes(1);
    expect(mockAddToCart).toHaveBeenCalledWith('thunder', 1);
    expect(mockNotify).toHaveBeenCalledWith({ price: 283000, originalPrice: 292000 });
    await act(async () => { resolve(); });
    expect(btn).not.toBeDisabled();
  });

  it('a server rejection shows the error toast and re-enables the button', async () => {
    mockAddToCart.mockRejectedValue(new Error('Out of stock'));
    renderHero([THUNDER]);
    const btn = screen.getByTestId('bfh-card-add');
    await act(async () => { fireEvent.click(btn); });
    expect(mockToastError).toHaveBeenCalledWith('Out of stock');
    expect(btn).not.toBeDisabled();
  });

  it('the button is not inside the product link (no nested interactive elements)', () => {
    renderHero([THUNDER]);
    const btn = screen.getByTestId('bfh-card-add');
    expect(btn.closest('a')).toBeNull();
    expect(card('Profender Thunder Series').querySelector('a.bfh-card-link')).toHaveAttribute('href', '/products/thunder');
  });
});

describe('offer off or loading', () => {
  it('offer off → no ribbon, no checklist, plain "Add to cart" and plain Save tag', () => {
    renderHero();
    expect(screen.queryByTestId('bfh-zero-delivery')).toBeNull();
    expect(document.querySelector('.bfh-card-check')).toBeNull();
    const c = card('Profender Thunder Series');
    expect(c.querySelector('.bfh-card-tag')).toHaveTextContent('Save ₹9,000');
    expect(within(c).getByTestId('bfh-card-add')).not.toHaveTextContent(/Nothing extra/i);
  });

  it('loading → orderable cards reserve the checklist space with a placeholder (no layout shift)', () => {
    mockPending = true;
    renderHero();
    expect(card('Profender Thunder Series').querySelector('.bfh-card-checks-pending')).not.toBeNull();
    expect(card('Profender APEX').querySelector('.bfh-card-checks-pending')).toBeNull();
    // The perks row is always rendered, so its fixed height holds the layout.
    expect(screen.getAllByTestId('bfh-card-perks')).toHaveLength(3);
  });
});

describe('heroCardAction', () => {
  it.each([
    [{ ...THUNDER }, 'add'],
    [{ ...THUNDER, stock: 'low' as const }, 'add'],
    [{ ...THUNDER, stock: 'out' as const }, 'Sold out · View product'],
    [{ ...APEX }, 'Backorder · Enquire'],
    [{ ...THUNDER, variable: true, id: undefined }, 'Choose options'],
    // Banner fallback photo: no catalogue fields at all.
    [{ src: '/b.jpg', href: '/offers', name: 'Banner', save: 0 }, 'View deal'],
  ])('%o → %s', (p, expected) => {
    const a = heroCardAction(p as FestiveHeroPhoto);
    expect(a.kind === 'add' ? 'add' : a.label).toBe(expected);
  });
});
