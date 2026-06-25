import elasticsearchService from '../../../services/elasticsearchService.js';

// normalizeImages is a pure static helper; reach it via the singleton's class.
const ElasticsearchService = elasticsearchService.constructor;

describe('ElasticsearchService.normalizeImages', () => {
  it('maps the Mongoose array shape, preserving alt and isPrimary', () => {
    const result = ElasticsearchService.normalizeImages(
      [
        { url: 'https://cdn/a.jpg', alt: 'A', isPrimary: false },
        { url: 'https://cdn/b.jpg', isPrimary: true },
      ],
      'Foam Cell Kit'
    );

    expect(result).toEqual([
      { url: 'https://cdn/a.jpg', alt: 'A', isPrimary: false },
      { url: 'https://cdn/b.jpg', alt: 'Foam Cell Kit', isPrimary: true },
    ]);
  });

  it('coerces a legacy single-string URL into a primary image', () => {
    expect(
      ElasticsearchService.normalizeImages('https://cdn/x.jpg', 'Bumper')
    ).toEqual([{ url: 'https://cdn/x.jpg', alt: 'Bumper', isPrimary: true }]);
  });

  it('drops entries without a usable url', () => {
    const result = ElasticsearchService.normalizeImages(
      [{ alt: 'no url' }, null, { url: '' }, { url: 'https://cdn/ok.jpg' }],
      'Part'
    );
    expect(result).toEqual([
      { url: 'https://cdn/ok.jpg', alt: 'Part', isPrimary: false },
    ]);
  });

  it('returns [] for null, undefined, empty string, and empty array', () => {
    expect(ElasticsearchService.normalizeImages(null)).toEqual([]);
    expect(ElasticsearchService.normalizeImages(undefined)).toEqual([]);
    expect(ElasticsearchService.normalizeImages('   ')).toEqual([]);
    expect(ElasticsearchService.normalizeImages([])).toEqual([]);
  });
});
