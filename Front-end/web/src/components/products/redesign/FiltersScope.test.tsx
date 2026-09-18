/**
 * The Category group on a category page.
 *
 * It used to be hidden outright (`hideCategories`), which quietly removed
 * subcategory drill-down from every `/categories/<slug>` page — you could narrow
 * Audio to Subwoofers on the global listing but not on the Audio page itself.
 * Un-hiding it naively is worse, not better: the facet response computes category
 * counts with the category filter EXCLUDED, so it always carries the WHOLE
 * taxonomy, and the group would offer "Brakes" to a shopper standing on Audio.
 *
 * `scopeCategoryId` is what makes it safe — the group renders one hub's children
 * and nothing else.
 */
import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

let currentUrl = '/categories/audio';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => currentUrl.split('?')[0],
  useSearchParams: () => new URLSearchParams(currentUrl.split('?')[1] ?? ''),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n}` }),
}));

// The whole taxonomy, exactly as the facet endpoint returns it on a category page.
const FACETS = {
  total: 12,
  brands: [],
  categories: [
    { categoryId: 'hub-audio', label: 'Audio', parentId: null, count: 8, selected: false },
    { categoryId: 'hub-brakes', label: 'Brakes', parentId: null, count: 5, selected: false },
    { categoryId: 'sub-subwoofers', label: 'Subwoofers', parentId: 'hub-audio', count: 3, selected: false },
    { categoryId: 'sub-speakers', label: 'Speakers', parentId: 'hub-audio', count: 4, selected: false },
    { categoryId: 'sub-pads', label: 'Brake Pads', parentId: 'hub-brakes', count: 2, selected: false },
  ],
  vehicleMakes: [],
  vehicleModels: [],
  price: { min: 100, max: 10000, selectedMin: null, selectedMax: null, histogram: [] },
  ratings: [],
  availability: [],
};

const facetPaths: string[] = [];

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (path: string) => {
      if (path.startsWith('/products/facets')) {
        facetPaths.push(path);
        return { facets: FACETS };
      }
      return {};
    }),
  },
}));

jest.mock('@/components/ui/PriceHistogram', () => ({
  __esModule: true,
  default: () => <div />,
}));

import Filters from './Filters';

async function mount(props: React.ComponentProps<typeof Filters> = {}) {
  const view = render(<Filters {...props} />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

// A row's accessible name is "<label> <count>" (the facet count is rendered
// inside the same <label>), so an end-anchored /^Audio$/ matches NOTHING and
// every negative assertion using one would pass for the wrong reason.
const box = (name: RegExp) => screen.queryByRole('checkbox', { name });

beforeEach(() => {
  currentUrl = '/categories/audio';
  facetPaths.length = 0;
});

const lastFacetQuery = () => new URLSearchParams(facetPaths.at(-1)!.split('?')[1] ?? '');

describe('the facet request knows which category it is inside', () => {
  it('seeds the scope, so brands/price/ratings are counted inside the hub', async () => {
    // The hub lives in the PATH, so this request used to carry no category at
    // all. Measured on prod: /categories/lighting offered 37 brands and a
    // ₹814,200 ceiling from the whole catalogue, against the category's real 9
    // brands and ₹167,000.
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(lastFacetQuery().get('category')).toBe('hub-audio');
  });

  it('lets an explicit refinement win over the seeded hub', async () => {
    currentUrl = '/categories/audio?category=sub-speakers';
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(lastFacetQuery().get('category')).toBe('sub-speakers');
  });

  it('seeds nothing on the global listing', async () => {
    currentUrl = '/products';
    await mount();

    expect(lastFacetQuery().get('category')).toBeNull();
  });
});

describe('scoped to one hub', () => {
  it('offers this hub’s children', async () => {
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(box(/Subwoofers/)).toBeInTheDocument();
    expect(box(/Speakers/)).toBeInTheDocument();
  });

  it('does NOT offer a sibling hub — you are standing inside one', async () => {
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(box(/^Brakes\b/)).not.toBeInTheDocument();
    expect(box(/Brake Pads/)).not.toBeInTheDocument();
  });

  it('does not offer the hub itself, which would be a no-op', async () => {
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(box(/^Audio\b/)).not.toBeInTheDocument();
  });

  it('reflects a child already selected in the URL', async () => {
    currentUrl = '/categories/audio?category=sub-speakers';
    await mount({ scopeCategoryId: 'hub-audio' });

    expect(box(/Speakers/)).toBeChecked();
    expect(box(/Subwoofers/)).not.toBeChecked();
  });

  it('hides the group entirely for a hub with no children', async () => {
    // Better an absent group than a heading over nothing.
    currentUrl = '/categories/brakes';
    await mount({ scopeCategoryId: 'hub-no-kids' });

    expect(screen.queryByText('Refine')).not.toBeInTheDocument();
    expect(screen.queryByText('Category')).not.toBeInTheDocument();
  });
});

describe('unscoped (the global listing) is unchanged', () => {
  it('still renders every hub with its children nested', async () => {
    currentUrl = '/products';
    await mount();

    expect(box(/^Audio\b/)).toBeInTheDocument();
    expect(box(/^Brakes\b/)).toBeInTheDocument();
    expect(box(/Subwoofers/)).toBeInTheDocument();
    expect(box(/Brake Pads/)).toBeInTheDocument();
  });

  it('still honours hideCategories', async () => {
    currentUrl = '/products';
    await mount({ hideCategories: true });

    expect(box(/^Audio\b/)).not.toBeInTheDocument();
  });
});
