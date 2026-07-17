import { extractPackageContents, isPackageTab, parseTabToPointers } from '../../../utils/wcCustomTabs.js';

describe('isPackageTab', () => {
  test.each([
    ['Package', true],
    ['Package Includes', true],
    ['PACKAGE INCLUDES', true],
    ['Package details', true],
    ['kit ', true],
    ['Compatibility', false],
    ['Important', false],
    ['Performance Specifications', false],
    ['Accessories', false],
  ])('%s → %s', (title, expected) => {
    expect(isPackageTab(title)).toBe(expected);
  });
});

describe('parseTabToPointers', () => {
  test('extracts leaf <li> items, skipping a heading', () => {
    const html = '<h2>Package Includes</h2><ul><li>Front Bumper Assembly</li><li>Mounting Brackets</li></ul>';
    expect(parseTabToPointers(html)).toEqual(['Front Bumper Assembly', 'Mounting Brackets']);
  });

  test('flattens a nested <ul> to leaf items only (no wrapper blob)', () => {
    const html = '<h2>Package Includes:</h2><ul><li style="list-style:none"><ul>' +
      '<li>1 Pair of Headlights (Left + Right)</li><li>LED DRL modules</li></ul></li></ul>';
    expect(parseTabToPointers(html)).toEqual(['1 Pair of Headlights (Left + Right)', 'LED DRL modules']);
  });

  test('strips inner tags + decodes entities', () => {
    const html = '<ul><li><p>1 &times; <strong>Front</strong> Bumper &amp; Grille</p></li></ul>';
    expect(parseTabToPointers(html)).toEqual(['1 × Front Bumper & Grille']);
  });

  test('falls back to <br>/newline split when there is no list', () => {
    const html = 'Front Bumper<br>Rear Bumper<br>Hardware Kit';
    expect(parseTabToPointers(html)).toEqual(['Front Bumper', 'Rear Bumper', 'Hardware Kit']);
  });

  test('drops a heading-only "Package Includes:" line', () => {
    expect(parseTabToPointers('<p>Package Includes:</p>')).toEqual([]);
  });
});

describe('extractPackageContents', () => {
  const meta = (tabs) => [{ key: 'yikes_woo_products_tabs', value: tabs }];

  test('keeps only package tabs and de-dupes across them', () => {
    const md = meta([
      { title: 'Compatibility', content: '<ul><li>Toyota Hilux</li></ul>' },
      { title: 'Package', content: '<ul><li>Bumper</li><li>Bracket</li></ul>' },
      { title: 'Package Includes', content: '<ul><li>Bracket</li><li>Bolts</li></ul>' },
    ]);
    expect(extractPackageContents(md)).toEqual(['Bumper', 'Bracket', 'Bolts']);
  });

  test('returns [] when there is no package tab', () => {
    expect(extractPackageContents(meta([{ title: 'Compatibility', content: '<ul><li>X</li></ul>' }]))).toEqual([]);
  });

  test('handles missing/empty meta safely', () => {
    expect(extractPackageContents([])).toEqual([]);
    expect(extractPackageContents(undefined)).toEqual([]);
  });
});
