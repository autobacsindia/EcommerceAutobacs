import { expand } from '../../../config/searchSynonyms.js';

describe('searchSynonyms.expand', () => {
  it('expands a colloquial term into its synonym group', () => {
    const result = expand('lights');
    expect(result).toContain('lights');
    expect(result).toContain('lighting');
    expect(result).toContain('lamp');
    expect(result).toContain('led');
  });

  it('is case-insensitive and trims whitespace', () => {
    const result = expand('  LIGHTS ');
    expect(result).toContain('lights');
    expect(result).toContain('lighting');
  });

  it('matches per-word so multi-word phrases still trigger groups', () => {
    const result = expand('ambient lights');
    // whole phrase plus the "lights" word both pull in the lighting group
    expect(result).toContain('ambient lights');
    expect(result).toContain('lighting');
  });

  it('passes unknown terms through unchanged (original always included)', () => {
    const result = expand('brakepadxyz');
    expect(result).toEqual(['brakepadxyz']);
  });

  it('returns an empty array for empty/invalid input', () => {
    expect(expand('')).toEqual([]);
    expect(expand('   ')).toEqual([]);
    expect(expand(null)).toEqual([]);
    expect(expand(undefined)).toEqual([]);
  });

  it('does not duplicate the original term', () => {
    const result = expand('audio');
    const occurrences = result.filter(t => t === 'audio').length;
    expect(occurrences).toBe(1);
  });
});
