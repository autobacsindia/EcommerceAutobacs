import { firstImageUrl } from './firstImageUrl';

describe('firstImageUrl', () => {
  it('reads every shape the cart API sends', () => {
    expect(firstImageUrl([{ url: 'https://cdn/a.webp' } as any, { url: 'https://cdn/b.webp' } as any])).toBe('https://cdn/a.webp');
    expect(firstImageUrl(['https://cdn/a.webp'])).toBe('https://cdn/a.webp');
    expect(firstImageUrl('https://cdn/a.webp')).toBe('https://cdn/a.webp');
  });
  it('returns null (→ fallback picture) when there is no photo', () => {
    expect(firstImageUrl(undefined)).toBeNull();
    expect(firstImageUrl([])).toBeNull();
    expect(firstImageUrl('')).toBeNull();
    expect(firstImageUrl([{} as any])).toBeNull();
  });
  it('drops a URL next/image would throw on (it would crash checkout), keeps root-relative ones', () => {
    expect(firstImageUrl([{ url: 'photo.jpg' } as any])).toBeNull();
    expect(firstImageUrl('//cdn/a.webp')).toBeNull();
    expect(firstImageUrl(['/images/fallback-product.webp'])).toBe('/images/fallback-product.webp');
  });
});
