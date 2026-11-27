import type { ProductImage } from '@/lib/types';

/**
 * next/image THROWS on a src that is neither absolute nor root-relative
 * ("photo.jpg"), and on checkout that throw takes the whole page down.
 * Anything else becomes null, so the caller shows its fallback picture.
 */
const usable = (u: unknown): string | null =>
  typeof u === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(u.trim()) ? u.trim() : null;

/** The first photo of a product, whichever shape `images` arrived in (string, string[] or {url}[]). */
export function firstImageUrl(images: ProductImage[] | string[] | string | null | undefined): string | null {
  if (!images) return null;
  if (typeof images === 'string') return usable(images);
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0] as ProductImage | string | undefined;
  if (typeof first === 'string') return usable(first);
  if (first && typeof first === 'object' && 'url' in first) return usable(first.url);
  return null;
}
