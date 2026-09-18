/**
 * Two contracts live here.
 *
 * 1. WHERE the chips point. They are the storefront's most prominent taxonomy
 *    control, and they used to be buttons that rewrote `?category=<ObjectId>` in
 *    place — an un-indexable URL with a Mongo id in it, on a control with no
 *    anchor semantics. Every assertion about `href` is guarding that.
 *
 * 2. The row's job BEFORE its data arrives. It sits in a STICKY bar directly
 *    above the product grid, so its height is load-bearing: while it rendered
 *    nothing, the bar painted short and then grew when the taxonomy resolved,
 *    pushing the whole grid down. Measured on a production build, that single
 *    jump was the entirety of `/products`'s CLS (0.0273 → 0), and none of it came
 *    from the cards. jsdom cannot measure that; what it CAN pin is the render
 *    that reserves the height, which is what those tests do.
 *
 * The real `useCategories` query runs here (under a test QueryClient) rather than
 * a stubbed hook, so the wiring between the two is covered too.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { categoryKeys } from '@/hooks/queries/keys';
import '@testing-library/jest-dom';
import CategoryChips from './CategoryChips';

let pathname = '/products';
let search = '';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

let resolveCategories: (v: unknown) => void;
const getMock = jest.fn(
  () =>
    new Promise((resolve) => {
      resolveCategories = resolve;
    })
);

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => getMock(...(args as [])) },
}));

const HUBS = [
  { _id: 'cat-audio', name: 'Audio', slug: 'audio' },
  { _id: 'cat-lighting', name: 'Lighting', slug: 'lighting' },
  // Children are the sidebar's job; the strip is hubs only — but it still needs
  // them in the data to resolve a level-2 page back to its hub.
  { _id: 'cat-sub', name: 'Subwoofers', slug: 'subwoofers', parent: 'cat-audio' },
  { _id: 'cat-tail', name: 'Tail Light', slug: 'tail-light', parent: { _id: 'cat-lighting' } },
];

let client: QueryClient;

function renderChips() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CategoryChips />
    </QueryClientProvider>
  );
}

/**
 * Renders and waits for the taxonomy query to actually reach the DOM.
 *
 * Deliberately NOT a fixed number of microtask flushes: the query promise
 * settling and React Query committing that state to the component are separate
 * steps, so any hand-counted flush is a race — one cost ~2 failures in 5 runs.
 */
async function mount(categories: unknown = HUBS) {
  renderChips();
  resolveCategories({ categories });

  const hubs = Array.isArray(categories)
    ? (categories as Array<{ name: string; slug?: string; parent?: unknown }>)
        .filter((c) => c.slug && !c.parent)
    : [];

  if (hubs.length > 0) {
    // A rendered chip is the observable end-state.
    await screen.findByRole('link', { name: hubs[0].name });
  } else {
    // Nothing new will appear, so settle on the query instead.
    await waitFor(() =>
      expect(client.getQueryState(categoryKeys.list())?.status).not.toBe('pending')
    );
  }
}

const link = (name: string | RegExp) => screen.getByRole('link', { name });

beforeEach(() => {
  getMock.mockClear();
  pathname = '/products';
  search = '';
});

describe('where the chips point', () => {
  it('links each hub to its canonical /categories/<slug> page, not ?category=<id>', async () => {
    await mount();

    expect(link('Audio')).toHaveAttribute('href', '/categories/audio');
    expect(link('Lighting')).toHaveAttribute('href', '/categories/lighting');
  });

  it('never emits the ObjectId filter URL these chips used to produce', async () => {
    await mount();

    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('href')).not.toMatch(/[?&]category=/);
    }
  });

  it('sends "All categories" back to the global listing', async () => {
    await mount();

    expect(link(/All categories/)).toHaveAttribute('href', '/products');
  });

  it('renders hubs only — children belong to the sidebar', async () => {
    await mount();

    expect(screen.queryByRole('link', { name: 'Subwoofers' })).not.toBeInTheDocument();
  });

  it('drops a hub with no slug rather than linking to /categories/undefined', async () => {
    await mount([
      { _id: 'cat-audio', name: 'Audio', slug: 'audio' },
      { _id: 'cat-orphan', name: 'Orphan' },
    ]);

    expect(screen.queryByRole('link', { name: 'Orphan' })).not.toBeInTheDocument();
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('href')).not.toContain('undefined');
    }
  });
});

describe('filters survive the jump', () => {
  it('carries the active filters onto the category page', async () => {
    // The category page reads the same brand/price/stock params, so a narrowed
    // listing stays narrowed instead of silently widening on navigation.
    search = 'brand=Bosch&inStock=true';
    await mount();

    const href = link('Audio').getAttribute('href')!;
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('brand')).toBe('Bosch');
    expect(q.get('inStock')).toBe('true');
  });

  it('does NOT forward params the category page ignores', async () => {
    // The grid there ignores `isFeatured`, but the filter sidebar passed it
    // straight to /products/facets — so the page disagreed with itself: every
    // product on screen, counted as if only featured ones existed.
    search = 'isFeatured=true&isFastMoving=true&brand=Bosch';
    await mount();

    const q = new URLSearchParams(link('Audio').getAttribute('href')!.split('?')[1]);
    expect(q.get('isFeatured')).toBeNull();
    expect(q.get('isFastMoving')).toBeNull();
    expect(q.get('brand')).toBe('Bosch');
  });

  it('DOES forward them to /products, which honours them', async () => {
    // "All categories" clears the category, not the listing you are on.
    search = 'isFeatured=true';
    await mount();

    const q = new URLSearchParams(link(/All categories/).getAttribute('href')!.split('?')[1]);
    expect(q.get('isFeatured')).toBe('true');
  });

  it('drops `category` and `page` — the destination IS the category', async () => {
    search = 'category=cat-lighting&page=4&brand=Bosch';
    await mount();

    const href = link('Audio').getAttribute('href')!;
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('category')).toBeNull();
    expect(q.get('page')).toBeNull();
    expect(q.get('brand')).toBe('Bosch');
  });
});

describe('which chip is lit', () => {
  it('lights the hub whose page you are standing on', async () => {
    pathname = '/categories/lighting';
    await mount();

    expect(link('Lighting')).toHaveClass('bg-gold');
    expect(link('Audio')).not.toHaveClass('bg-gold');
    expect(link(/All categories/)).not.toHaveClass('bg-gold');
  });

  it('keeps the hub lit while the sidebar refines inside it', async () => {
    // A child selection must not un-light the hub you are visibly inside.
    pathname = '/categories/audio';
    search = 'category=cat-sub';
    await mount();

    expect(link('Audio')).toHaveClass('bg-gold');
  });

  it('lights the PARENT hub on a level-2 category page', async () => {
    // /categories/tail-light matches no hub. It used to light nothing at all —
    // and because a slug was present it also suppressed "All categories", so the
    // strip showed no current item and emitted no aria-current anywhere.
    pathname = '/categories/tail-light';
    await mount();

    expect(link('Lighting')).toHaveClass('bg-gold');
    expect(link('Lighting')).toHaveAttribute('aria-current', 'page');
    expect(link('Audio')).not.toHaveClass('bg-gold');
  });

  it('still reflects a sidebar multi-select on /products', async () => {
    // The chips no longer WRITE this param, but the sidebar does, and the strip
    // must not disagree with it — the regression behind "highlights EVERY chip
    // in a multi-select, not none of them".
    search = 'category=cat-audio,cat-lighting';
    await mount();

    expect(link('Audio')).toHaveClass('bg-gold');
    expect(link('Lighting')).toHaveClass('bg-gold');
    expect(link(/All categories/)).not.toHaveClass('bg-gold');
  });

  it('lights "All categories" on an unfiltered listing', async () => {
    await mount();

    expect(link(/All categories/)).toHaveClass('bg-gold');
  });
});

describe('before the taxonomy arrives', () => {
  it('renders the row before the query resolves, so the sticky bar cannot grow', () => {
    renderChips();

    // The fetch is deliberately still in flight here.
    expect(getMock).toHaveBeenCalled();
    expect(link(/All categories/)).toBeInTheDocument();
  });

  it('keeps a working control when the taxonomy never arrives', async () => {
    // A failed taxonomy call used to leave an empty bar. "All categories" needs
    // no data — it is a static link to /products — so it stays usable.
    await mount(undefined);

    expect(link(/All categories/)).toHaveAttribute('href', '/products');
  });
});
