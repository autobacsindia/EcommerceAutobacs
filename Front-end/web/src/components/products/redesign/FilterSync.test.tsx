/**
 * The chip strip, the sidebar and the active-filter chips are three controls
 * over ONE piece of state: the query string. These tests mount all three
 * against a shared fake URL, because every bug they cover was a desync — a
 * control rendering, or writing back, a selection the URL no longer held.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── fake router: one URL, shared by every control under test ──
let currentUrl = '/products';
const subscribers = new Set<() => void>();
const replace = jest.fn((url: string) => {
  currentUrl = url;
  subscribers.forEach((fn) => fn());
});

// Cached per URL on purpose: the real useSearchParams returns a referentially
// stable object per navigation, and effects here key off it. Handing back a
// fresh instance every render would spin the facet fetch forever.
const cache = new Map<string, URLSearchParams>();
const searchParamsOf = (url: string) => {
  let sp = cache.get(url);
  if (!sp) {
    sp = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    cache.set(url, sp);
  }
  return sp;
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => currentUrl.split('?')[0],
  useSearchParams: () => searchParamsOf(currentUrl),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n}` }),
}));

const CATEGORIES = [
  { _id: 'cat-audio', name: 'Audio', slug: 'audio' },
  { _id: 'cat-lighting', name: 'Lighting', slug: 'lighting' },
  { _id: 'cat-brakes', name: 'Brakes', slug: 'brakes' },
];

/**
 * The panel is now driven ENTIRELY by /products/facets — it no longer fetches
 * /categories, /brands or /vehicles for its values. That is the point of the
 * change: values assembled from global reference lists rendered options with zero
 * results in the current context, each one a clickable dead end.
 *
 * So this mock supplies a full facet response rather than stalling it.
 */
const FACETS = {
  total: 12,
  brands: [
    { name: 'Bosch', value: 'Bosch', label: 'Bosch', count: 4, selected: false },
    { name: 'Auxbeam', value: 'Auxbeam', label: 'Auxbeam', count: 2, selected: false },
  ],
  categories: CATEGORIES.map((c) => ({
    categoryId: c._id, label: c.name, parentId: null, count: 3, selected: false,
  })),
  vehicleMakes: [],
  vehicleModels: [],
  price: { min: 100, max: 10000, selectedMin: null, selectedMax: null, histogram: [] },
  ratings: [],
  availability: [{ value: 'in', label: 'In stock', count: 9, selected: false }],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (path: string) => {
      if (path.startsWith('/products/facets')) return { facets: FACETS };
      // CategoryChips and ActiveFilters still read the taxonomy directly; only
      // the sidebar migrated to the facet response.
      if (path.startsWith('/categories')) return { categories: CATEGORIES };
      if (path.startsWith('/vehicles')) return { vehicles: [] };
      return {};
    }),
  },
}));

// The slider itself is not under test; expose a button that reports a drag.
jest.mock('@/components/ui/PriceHistogram', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (v: [number, number]) => void }) => (
    <button onClick={() => onChange([500, 9000])}>drag-price</button>
  ),
}));

import Filters from './Filters';
import CategoryChips from './CategoryChips';
import ActiveFilters from './ActiveFilters';

/** Mounts the three controls together and re-renders them on every URL write. */
function Listing() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    subscribers.add(force);
    return () => { subscribers.delete(force); };
  }, []);
  return (
    <>
      <div data-testid="chips"><CategoryChips /></div>
      <div data-testid="sidebar"><Filters /></div>
      <div data-testid="active"><ActiveFilters /></div>
    </>
  );
}

const params = () => searchParamsOf(currentUrl);
const lastUrl = () => replace.mock.calls[replace.mock.calls.length - 1][0];
const inChips = () => within(screen.getByTestId('chips'));
const inSidebar = () => within(screen.getByTestId('sidebar'));
const inActive = () => within(screen.getByTestId('active'));

const chip = (name: RegExp) => inChips().getByRole('button', { name });
const checkbox = (name: RegExp) => inSidebar().getByRole('checkbox', { name });

/** Renders and waits out the reference-data fetches so the lists are populated. */
async function mount(url = '/products') {
  currentUrl = url;
  replace.mockClear();
  const view = render(<Listing />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

beforeEach(() => { jest.useRealTimers(); });

describe('chip strip ↔ sidebar sync', () => {
  it('ticks the sidebar box when a chip selects that category', async () => {
    await mount();
    expect(checkbox(/Audio/)).not.toBeChecked();

    fireEvent.click(chip(/^Audio$/i));

    expect(params().get('category')).toBe('cat-audio');
    expect(checkbox(/Audio/)).toBeChecked();
  });

  it('unticks the sidebar box when the active-filter chip is dismissed', async () => {
    await mount('/products?category=cat-audio');
    expect(checkbox(/Audio/)).toBeChecked();

    fireEvent.click(inActive().getByRole('button', { name: /^Audio$/ }));

    expect(params().get('category')).toBeNull();
    expect(checkbox(/Audio/)).not.toBeChecked();
  });

  it('highlights the chip for a category selected from the sidebar', async () => {
    await mount();
    fireEvent.click(checkbox(/Lighting/));

    expect(params().get('category')).toBe('cat-lighting');
    expect(chip(/^Lighting$/i)).toHaveClass('bg-gold');
  });

  it('highlights EVERY chip in a multi-select, not none of them', async () => {
    await mount();
    fireEvent.click(checkbox(/Lighting/));
    fireEvent.click(checkbox(/Brakes/));

    expect(params().get('category')).toBe('cat-lighting,cat-brakes');
    expect(chip(/^Lighting$/i)).toHaveClass('bg-gold');
    expect(chip(/^Brakes$/i)).toHaveClass('bg-gold');
    expect(chip(/All categories/i)).not.toHaveClass('bg-gold');
  });

  it('reflects an externally changed URL (back/forward) in the sidebar', async () => {
    const { rerender } = await mount('/products?category=cat-audio');
    expect(checkbox(/Audio/)).toBeChecked();

    currentUrl = '/products?category=cat-brakes'; // e.g. a popstate
    rerender(<Listing />);

    expect(checkbox(/Audio/)).not.toBeChecked();
    expect(checkbox(/Brakes/)).toBeChecked();
  });
});

describe('a sidebar change never clobbers another control’s param', () => {
  it('keeps the chip-selected category when an unrelated filter is toggled', async () => {
    await mount();
    fireEvent.click(chip(/^Audio$/i));          // chip strip sets the category
    fireEvent.click(checkbox(/In stock only/)); // sidebar touches something else

    expect(params().get('inStock')).toBe('true');
    expect(params().get('category')).toBe('cat-audio'); // survived
  });

  it('keeps the category when a brand is picked', async () => {
    await mount();
    fireEvent.click(chip(/^Audio$/i));
    fireEvent.click(checkbox(/Bosch/));

    expect(params().get('brand')).toBe('Bosch');
    expect(params().get('category')).toBe('cat-audio');
  });

  it('keeps the category when the price slider commits', async () => {
    jest.useFakeTimers();
    await mount();
    fireEvent.click(chip(/^Audio$/i));
    fireEvent.click(inSidebar().getByRole('button', { name: 'drag-price' }));
    act(() => { jest.advanceTimersByTime(400); });

    expect(params().get('minPrice')).toBe('500');
    expect(params().get('category')).toBe('cat-audio');
  });

  it('debounced price uses the URL as of commit time, not drag time', async () => {
    jest.useFakeTimers();
    await mount();
    fireEvent.click(inSidebar().getByRole('button', { name: 'drag-price' })); // drag starts
    fireEvent.click(chip(/^Brakes$/i));                                  // URL moves on
    act(() => { jest.advanceTimersByTime(400); });                       // debounce fires

    expect(params().get('minPrice')).toBe('500');
    expect(params().get('category')).toBe('cat-brakes'); // not reverted
  });

  it('preserves params it does not own, like sort', async () => {
    await mount('/products?sort=price_asc&category=cat-audio');
    fireEvent.click(checkbox(/In stock only/));

    expect(params().get('sort')).toBe('price_asc');
    expect(params().get('category')).toBe('cat-audio');
  });
});

describe('chip strip semantics', () => {
  it('narrows a multi-select to the clicked hub', async () => {
    await mount('/products?category=cat-lighting,cat-brakes');
    fireEvent.click(chip(/^Brakes$/i));

    expect(params().get('category')).toBe('cat-brakes');
  });

  it('clears when the sole active chip is clicked again', async () => {
    await mount('/products?category=cat-brakes');
    fireEvent.click(chip(/^Brakes$/i));

    expect(params().get('category')).toBeNull();
  });

  it('resets pagination on selection', async () => {
    await mount('/products?page=4');
    fireEvent.click(chip(/^Audio$/i));

    expect(params().get('page')).toBeNull();
  });
});

describe('active-filter chips stay on the current route', () => {
  it('does not bounce a category page back to /products', async () => {
    await mount('/categories/brakes?category=cat-audio&inStock=true');
    fireEvent.click(inActive().getByRole('button', { name: /Clear all/i }));

    expect(lastUrl()).toBe('/categories/brakes');
  });
});
