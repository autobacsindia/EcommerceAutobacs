import { planLegacyImport } from '../../../utils/legacyRedirectImport.js';

const live = {
  products: new Set(['audi-steering-wheel']),
  categories: new Set(['body-kits', 'roll-bar']),
  vehicles: new Set(['toyota-innova-hycross', 'mahindra-thar']),
};
const row = (old, approved, extra = {}) => ({
  old_url: `https://www.autobacsindia.com/model/${old}`,
  today: '404 today',
  suggested_target: '/categories/body-kits',
  approved_target: approved,
  ...extra,
});

describe('planLegacyImport', () => {
  it('keep → the suggestion; a path → that page; GONE → 410', () => {
    const plan = planLegacyImport([
      row('car-body-kit', 'keep'),
      row('audi-wheel', '/products/audi-steering-wheel'),
      row('warrior-plus', 'GONE'),
      row('dmax-2', 'GONE (410)'),
      row('toyota-hycross/', ' /model/toyota-innova-hycross '),
    ], live);
    expect(plan.errors).toEqual([]);
    expect(plan.writes).toEqual([
      { fromPath: '/model/car-body-kit', toPath: '/categories/body-kits', previous: undefined },
      { fromPath: '/model/audi-wheel', toPath: '/products/audi-steering-wheel', previous: undefined },
      { fromPath: '/model/warrior-plus', toPath: null, previous: undefined },
      { fromPath: '/model/dmax-2', toPath: null, previous: undefined },
      { fromPath: '/model/toyota-hycross', toPath: '/model/toyota-innova-hycross', previous: undefined },
    ]);
  });

  it('skips unreviewed rows, rows that already redirect, and live vehicle pages', () => {
    const plan = planLegacyImport([
      row('not-looked-at', ''),
      row('thar-roof', 'keep', { today: 'already redirects', suggested_target: '/model/mahindra-thar' }),
      row('mahindra-thar', 'GONE'),
    ], live);
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'not reviewed',
      'already redirects today; nothing to store',
      'a live vehicle page now',
    ]);
  });

  it('rejects targets that are not live pages of ours — never a redirect into a 404 or off-site', () => {
    const plan = planLegacyImport([
      row('a', '/products/deleted-thing'),
      row('b', 'https://evil.example/x'),
      row('c', '/blog/some-post'),
      row('d', '/categories/body-kits/extra'),
      row('e', 'javascript:alert(1)'),
      row('f', '/model/f'),
    ], live);
    expect(plan.writes).toEqual([]);
    expect(plan.errors).toHaveLength(6);
  });

  it('rejects an old_url that is not a /model/<keyword> page', () => {
    const plan = planLegacyImport([row('x', 'GONE', { old_url: '/products/x' }), row('y', 'GONE', { old_url: '/model/a/b' })], live);
    expect(plan.errors).toHaveLength(2);
  });

  it('an odd URL that already redirects and was left as keep never blocks the import', () => {
    const plan = planLegacyImport([
      row('x', 'keep', { old_url: '/model/defender-accessories/page/1', today: 'already redirects' }),
      row('y', '', { old_url: '/model/a/b' }),
    ], live);
    expect(plan.errors).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  it('is idempotent and never overwrites an admin-set row', () => {
    const existing = new Map([
      ['/model/car-body-kit', { toPath: '/categories/body-kits', source: 'legacy' }],
      ['/model/roll', { toPath: '/categories/body-kits', source: 'legacy' }],
      ['/model/admin-set', { toPath: null, source: 'manual' }],
    ]);
    const plan = planLegacyImport([
      row('car-body-kit', 'keep'),
      row('roll', '/categories/roll-bar'),
      row('admin-set', 'keep'),
    ], live, existing);
    expect(plan.unchanged.map((u) => u.fromPath)).toEqual(['/model/car-body-kit']);
    expect(plan.writes).toEqual([{ fromPath: '/model/roll', toPath: '/categories/roll-bar', previous: '/categories/body-kits' }]);
    expect(plan.skipped[0].reason).toMatch(/admin/);
  });

  it('a path listed twice with different answers is an error and is not written at all', () => {
    const plan = planLegacyImport([row('dup', 'GONE'), row('DUP/', '/categories/roll-bar'), row('dup', 'GONE')], live);
    expect(plan.writes).toEqual([]);
    expect(plan.errors.map((e) => e.reason)).toEqual(['listed twice with different targets']);
  });
});
