import { resolveNavCategories } from './navCategories';

describe('resolveNavCategories', () => {
  it('links each curated item to the live category real slug', () => {
    const live = [
      { _id: '1', name: 'Accessories', slug: 'accessories', isActive: true },
      { _id: '2', name: 'Body Kits', slug: 'body-kits', isActive: true },
      { _id: '3', name: 'Speaker', slug: 'speaker', isActive: true },
      { _id: '4', name: 'Lighting', slug: 'lighting', isActive: true },
    ];

    const nav = resolveNavCategories(live);
    const byLabel = Object.fromEntries(nav.map((n) => [n.label, n.href]));

    // Real slugs are used — no legacy bodykit/audio/lights hacks.
    expect(byLabel['Accessories']).toBe('/categories/accessories');
    expect(byLabel['Body Kits']).toBe('/categories/body-kits');
    expect(byLabel['Audio']).toBe('/categories/speaker');   // matched via alias
    expect(byLabel['Lights']).toBe('/categories/lighting'); // matched via alias
  });

  it('drops curated items with no matching live category (no broken links)', () => {
    const live = [{ _id: '1', name: 'Accessories', slug: 'accessories', isActive: true }];
    const nav = resolveNavCategories(live);
    expect(nav).toHaveLength(1);
    expect(nav[0]).toEqual({ label: 'Accessories', href: '/categories/accessories' });
  });

  it('ignores inactive categories', () => {
    const live = [{ _id: '1', name: 'Accessories', slug: 'accessories', isActive: false }];
    expect(resolveNavCategories(live)).toHaveLength(0);
  });

  it('matches by name when the slug differs, and preserves curated order', () => {
    const live = [
      { _id: '1', name: 'Suspension', slug: 'suspension-systems', isActive: true },
      { _id: '2', name: 'Exterior', slug: 'exterior', isActive: true },
    ];
    const nav = resolveNavCategories(live);
    // Curated order is Exterior before Suspension.
    expect(nav.map((n) => n.label)).toEqual(['Exterior', 'Suspension']);
    expect(nav.find((n) => n.label === 'Suspension')?.href).toBe('/categories/suspension-systems');
  });

  it('handles empty / nullish input safely', () => {
    expect(resolveNavCategories([])).toEqual([]);
    // @ts-expect-error testing defensive nullish handling
    expect(resolveNavCategories(null)).toEqual([]);
  });
});
