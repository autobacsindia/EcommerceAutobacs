/**
 * Atlas synonym mappings — the precision guard.
 *
 * SYNONYM_GROUPS was built for the old query-time expansion, which was applied
 * ONLY to single-token queries because expanding it bidirectionally over-recalled
 * ("spoiler" pulled in every bumper — 151 results). Atlas applies synonyms to every
 * query, so a mechanical copy of those groups would reintroduce that bug on a much
 * wider surface. These tests pin the properties that stop that happening.
 */

import { ATLAS_SYNONYM_MAPPINGS } from '../../../config/searchSynonyms.js';
import { diffSynonyms, ATLAS_SEARCH_INDEX_DEFINITION, ATLAS_SYNONYM_MAPPING_NAME } from '../../../config/atlasSearchIndex.js';

describe('ATLAS_SYNONYM_MAPPINGS shape', () => {
  it('declares only mapping types Atlas understands', () => {
    for (const m of ATLAS_SYNONYM_MAPPINGS) {
      expect(['equivalent', 'explicit']).toContain(m.mappingType);
    }
  });

  it('gives every equivalent mapping at least two terms', () => {
    // A one-term equivalent group is a no-op that reads like a working rule.
    for (const m of ATLAS_SYNONYM_MAPPINGS.filter((x) => x.mappingType === 'equivalent')) {
      expect(m.synonyms.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every explicit mapping both an input and an output', () => {
    for (const m of ATLAS_SYNONYM_MAPPINGS.filter((x) => x.mappingType === 'explicit')) {
      expect(m.input?.length).toBeGreaterThan(0);
      expect(m.synonyms?.length).toBeGreaterThan(0);
    }
  });

  it('keeps every term lowercase — the analyzer lowercases, the data must match', () => {
    for (const m of ATLAS_SYNONYM_MAPPINGS) {
      for (const term of [...(m.input || []), ...m.synonyms]) {
        expect(term).toBe(term.toLowerCase());
      }
    }
  });

  it('does NOT make distinct part types equivalent', () => {
    // The regression that produced "151 results for spoiler". These are different
    // products, not synonyms; recall for each is carried by its own name/category
    // match. Category INTENT is handled by the taxonomy lane, not by this file.
    const forbiddenTogether = [
      ['spoiler', 'bumper'],
      ['exhaust', 'turbo'],
      ['dashboard', 'floor mat'],
    ];
    for (const m of ATLAS_SYNONYM_MAPPINGS.filter((x) => x.mappingType === 'equivalent')) {
      const terms = new Set(m.synonyms);
      for (const [a, b] of forbiddenTogether) {
        expect(terms.has(a) && terms.has(b)).toBe(false);
      }
    }
  });

  it('keeps broad category terms ONE-WAY so a specific term cannot widen', () => {
    // "lights" may reach headlights; "headlight" must not expand back into every
    // lamp, fog light and ambient strip. That direction is the over-recall.
    const broad = ['lights', 'audio', 'suspension'];
    for (const term of broad) {
      const equivalentGroups = ATLAS_SYNONYM_MAPPINGS
        .filter((m) => m.mappingType === 'equivalent')
        .filter((m) => m.synonyms.includes(term));
      expect(equivalentGroups).toEqual([]);
    }
  });
});

describe('diffSynonyms — the audit blindness that hid this whole class', () => {
  it('reports a declared mapping that is missing from the live index', () => {
    // diffDefinition walks mappings.fields ONLY, so before diffSynonyms existed the
    // audit reported a clean index while synonyms silently never deployed — exactly
    // how the Elasticsearch brand-mapping fix sat unshipped for weeks.
    const { ok, drift } = diffSynonyms(ATLAS_SEARCH_INDEX_DEFINITION.synonyms, []);
    expect(ok).toBe(false);
    expect(drift[0]).toMatchObject({ issue: 'missing', path: `synonyms.${ATLAS_SYNONYM_MAPPING_NAME}` });
  });

  it('passes when the live index matches the declaration', () => {
    const { ok } = diffSynonyms(ATLAS_SEARCH_INDEX_DEFINITION.synonyms, ATLAS_SEARCH_INDEX_DEFINITION.synonyms);
    expect(ok).toBe(true);
  });

  it('reports a mapping pointed at the wrong source collection', () => {
    // Same name, different collection: the query resolves but expands against the
    // wrong data, which is worse than not resolving at all.
    const live = [{ ...ATLAS_SEARCH_INDEX_DEFINITION.synonyms[0], source: { collection: 'wrong' } }];
    const { ok, drift } = diffSynonyms(ATLAS_SEARCH_INDEX_DEFINITION.synonyms, live);
    expect(ok).toBe(false);
    expect(drift[0].issue).toBe('mismatch');
  });

  it('tolerates an extra live mapping without failing the audit', () => {
    // A mapping can legitimately linger between a declaration change and a redeploy.
    const live = [...ATLAS_SEARCH_INDEX_DEFINITION.synonyms, { name: 'legacy', source: { collection: 'old' } }];
    expect(diffSynonyms(ATLAS_SEARCH_INDEX_DEFINITION.synonyms, live).ok).toBe(true);
  });

  it('survives an index that declares no synonyms at all', () => {
    expect(diffSynonyms([], []).ok).toBe(true);
    expect(diffSynonyms([], undefined).ok).toBe(true);
  });
});
