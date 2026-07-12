import { resolveCarHotspots, CAR_HOTSPOTS, CarHotspotDef } from './carHotspots';

describe('resolveCarHotspots', () => {
  it('links each hotspot to the live category real slug via its primary alias', () => {
    const live = [
      { _id: '1', name: 'Headlight', slug: 'headlight', isActive: true },
      { _id: '2', name: 'Tail Light', slug: 'tail-light', isActive: true },
    ];
    const defs: CarHotspotDef[] = [
      { id: 'headlight', label: 'Headlights', region: 'front', slugAliases: ['headlight'], position: { x: 1, y: 2 } },
      { id: 'tail-light', label: 'Tail Lights', region: 'rear', slugAliases: ['tail-light'], position: { x: 3, y: 4 } },
    ];
    const out = resolveCarHotspots(live, defs);
    const byId = Object.fromEntries(out.map((h) => [h.id, h.href]));
    expect(byId['headlight']).toBe('/categories/headlight');
    expect(byId['tail-light']).toBe('/categories/tail-light');
  });

  it('falls back to a later alias when the primary slug is missing', () => {
    const live = [{ _id: '1', name: 'Speaker', slug: 'speaker', isActive: true }];
    const defs: CarHotspotDef[] = [
      { id: 'infotainment', label: 'Infotainment', region: 'interior', slugAliases: ['infotainment-system', 'speaker'], position: { x: 0, y: 0 } },
    ];
    const out = resolveCarHotspots(live, defs);
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe('/categories/speaker');
  });

  it('drops hotspots with no matching live category (no broken links)', () => {
    const live = [{ _id: '1', name: 'Headlight', slug: 'headlight', isActive: true }];
    const defs: CarHotspotDef[] = [
      { id: 'headlight', label: 'Headlights', region: 'front', slugAliases: ['headlight'], position: { x: 0, y: 0 } },
      { id: 'unicorn', label: 'Nope', region: 'rear', slugAliases: ['does-not-exist'], position: { x: 0, y: 0 } },
    ];
    const out = resolveCarHotspots(live, defs);
    expect(out.map((h) => h.id)).toEqual(['headlight']);
  });

  it('ignores inactive categories', () => {
    const live = [{ _id: '1', name: 'Headlight', slug: 'headlight', isActive: false }];
    const defs: CarHotspotDef[] = [
      { id: 'headlight', label: 'Headlights', region: 'front', slugAliases: ['headlight'], position: { x: 0, y: 0 } },
    ];
    expect(resolveCarHotspots(live, defs)).toHaveLength(0);
  });

  it('matches by name when slug differs but normalizes equal', () => {
    const live = [{ _id: '1', name: 'Fog Lamp', slug: 'fog-lamp-india', isActive: true }];
    const defs: CarHotspotDef[] = [
      { id: 'fog', label: 'Fog Lamps', region: 'front', slugAliases: ['Fog Lamp'], position: { x: 0, y: 0 } },
    ];
    const out = resolveCarHotspots(live, defs);
    expect(out[0].href).toBe('/categories/fog-lamp-india');
  });

  it('preserves id, label, region and position on the resolved hotspot', () => {
    const live = [{ _id: '1', name: 'Headlight', slug: 'headlight', isActive: true }];
    const defs: CarHotspotDef[] = [
      { id: 'headlight', label: 'Headlights', region: 'front', slugAliases: ['headlight'], position: { x: 24, y: 47 } },
    ];
    expect(resolveCarHotspots(live, defs)[0]).toEqual({
      id: 'headlight',
      label: 'Headlights',
      region: 'front',
      href: '/categories/headlight',
      position: { x: 24, y: 47 },
    });
  });

  it('every shipped hub hotspot resolves against the live hubs (drift guard)', () => {
    // Live production HUB slugs (verified 2026-06-29). If this fails, the hub
    // taxonomy moved and CAR_HOTSPOTS slugAliases must be updated.
    const liveHubs = [
      'lighting', 'exterior', 'interior', 'suspension', 'roof-top', 'protection-kit',
      'body-kits', 'performance', 'accessories', 'audio', 'brakes', 'portable-fridge',
    ].map((slug) => ({ _id: slug, name: slug, slug, isActive: true }));

    const out = resolveCarHotspots(liveHubs);
    expect(out).toHaveLength(CAR_HOTSPOTS.length);
  });

  it('carries chip + anchor3d through resolution', () => {
    const live = [{ _id: '1', name: 'Accessories', slug: 'accessories', isActive: true }];
    const defs = [
      { id: 'accessories', label: 'Accessories', region: 'rear' as const, chip: true,
        anchor3d: { x: 1, y: 2, z: 3 }, slugAliases: ['accessories'], position: { x: 0, y: 0 } },
    ];
    const out = resolveCarHotspots(live, defs);
    expect(out[0].chip).toBe(true);
    expect(out[0].anchor3d).toEqual({ x: 1, y: 2, z: 3 });
  });
});
