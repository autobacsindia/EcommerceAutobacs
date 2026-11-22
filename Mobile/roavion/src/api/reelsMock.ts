/**
 * Mock reels source — ONLY used when EXPO_PUBLIC_REELS_MOCK=1. It answers with
 * the server's exact JSON (contract 2026-11-18: wrapped `{ success, ... }`,
 * cursor pagination, limit), so switching the flag off changes nothing on screen.
 * A few reels show each edge case by eye: festival price, backorder, out of
 * stock, a product with variants, a team upload, and a null shareUrl.
 *
 * Videos are Cloudinary's public demo clips cropped to 9:16 — the same CDN and
 * URL style the real backend will return. Products are REAL catalogue products
 * read from the live API, so Add to cart / Buy now exercise the genuine cart
 * (a guest cart only; nothing here creates an order or payment).
 */
import { fetchProducts } from './catalogue';
import type { Reel, ReelPage, ReelProduct, UploadTarget } from './reels';

type Ok<T> = { success: true } & T;

const CLIP = (name: string) => ({
  mp4Url: `https://res.cloudinary.com/demo/video/upload/c_fill,h_1280,w_720,q_auto/${name}.mp4`,
  posterUrl: `https://res.cloudinary.com/demo/video/upload/c_fill,h_1280,w_720,q_auto,so_0/${name}.jpg`,
});

const CLIPS = ['ski_jump', 'dog', 'kitten_fighting', 'sea_turtle', 'elephants', 'snow_horses'].map(CLIP);

const CREATORS: Reel['creator'][] = [
  { id: 'c1', name: 'Arjun Drives', avatarUrl: null },
  { id: 'c2', name: 'Meera on Wheels', avatarUrl: null },
  { id: null, name: 'Autobacs India', avatarUrl: null }, // team upload
  { id: 'c4', name: 'Kerala Overlanders', avatarUrl: null },
];

const CAPTIONS = [
  'Fitted this in 20 minutes — the difference on the highway is unreal 🔥',
  'Weekend road trip essential. Honest review after 3,000 km.',
  'Before vs after. My Thar finally feels finished.',
  'Monsoon-proof setup for Kerala roads 🌧️',
  'Unboxing + first impressions. Build quality is premium.',
  'This one surprised me. Worth every rupee.',
];

const TOTAL = 18;

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Offline fallback so the feed still renders (cart adds would then fail cleanly). */
const FALLBACK: ReelProduct = {
  id: 'mock-product',
  slug: 'mock-product',
  title: 'Autobacs sample product',
  image: 'https://res.cloudinary.com/demo/image/upload/c_fill,h_400,w_400/sample.jpg',
  price: 4999,
  festivalPrice: null,
  mrp: 6999,
  discountPercent: 29,
  averageRating: 4.5,
  ratingCount: 780,
  availability: 'in',
  hasVariants: false,
};

let productsPromise: Promise<ReelProduct[]> | null = null;

function loadProducts(): Promise<ReelProduct[]> {
  productsPromise ??= fetchProducts({ limit: 12, sort: '-salesScore' })
    .then(({ products }) =>
      products
        .map<ReelProduct>((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.name,
          image: p.image,
          price: p.productType === 'variable' ? p.priceFrom : p.price,
          festivalPrice: null,
          mrp: p.mrp ?? p.price,
          discountPercent: p.discountPercent,
          averageRating: p.rating,
          ratingCount: p.reviews,
          availability: p.stock,
          hasVariants: p.productType === 'variable',
        })),
    )
    .then((list) => (list.length ? list : [FALLBACK]))
    .catch(() => {
      productsPromise = null; // try again next time
      return [FALLBACK];
    });
  return productsPromise;
}

const likes = new Map<string, boolean>();

function buildReel(i: number, products: ReelProduct[], status: Reel['status'] = 'approved'): Reel {
  const clip = CLIPS[i % CLIPS.length];
  const base = products[i % products.length];
  // Edge cases, one per reel, so each can be checked by eye.
  let product: ReelProduct = base;
  if (i === 1) product = { ...base, festivalPrice: Math.round(base.price * 0.9) };
  if (i === 3) product = { ...base, availability: 'backorder' };
  if (i === 4) product = { ...base, availability: 'out' };
  if (i === 5) product = { ...base, hasVariants: true };
  const id = `mock-reel-${i + 1}`;
  return {
    id,
    status,
    hlsUrl: null,
    mp4Url: clip.mp4Url,
    posterUrl: clip.posterUrl,
    durationSec: 15,
    caption: CAPTIONS[i % CAPTIONS.length],
    createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    creator: CREATORS[i % CREATORS.length],
    product,
    likeCount: 120 + ((i * 97) % 900) + (likes.get(id) ? 1 : 0),
    viewerLiked: likes.get(id) ?? false,
    // null = server has no site URL configured; the app falls back itself.
    shareUrl: i === 2 ? null : `https://www.autobacsindia.com/products/${product.slug}`,
  };
}

export async function fetchReels(cursor: string | null, limit: number): Promise<Ok<ReelPage>> {
  await delay(500);
  const products = await loadProducts();
  const start = cursor ? Number(cursor) : 0;
  const end = Math.min(start + limit, TOTAL);
  const reels = Array.from({ length: Math.max(0, end - start) }, (_, k) => buildReel(start + k, products));
  return { success: true, reels, nextCursor: end < TOTAL ? String(end) : null };
}

const mine: Reel[] = [];
let seededMine = false;

export async function fetchMyReels(_cursor: string | null, _limit: number): Promise<Ok<ReelPage>> {
  await delay(400);
  const products = await loadProducts();
  if (!seededMine) {
    seededMine = true;
    mine.push(
      { ...buildReel(0, products, 'approved'), id: 'mine-1' },
      {
        ...buildReel(2, products, 'rejected'),
        id: 'mine-2',
        rejectReason: 'The product is not clearly shown in the video. Please film it in good light and try again.',
      },
    );
  }
  return { success: true, reels: [...mine], nextCursor: null };
}

export async function likeReel(id: string, liked: boolean): Promise<Ok<{ liked: boolean; likeCount: number }>> {
  await delay(250);
  likes.set(id, liked);
  const i = Number(id.replace('mock-reel-', '')) - 1;
  const base = Number.isFinite(i) ? 120 + ((i * 97) % 900) : 0;
  return { success: true, liked, likeCount: base + (liked ? 1 : 0) };
}

/** Same shape as the server's presigned R2 PUT. Nothing is ever sent to it. */
export async function getUploadTarget(input: { contentType: string; size: number }): Promise<Ok<UploadTarget>> {
  await delay(300);
  const ext = input.contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const key = `autobacs/reels/u_mock/${Date.now().toString(16)}/video-mock.${ext}`;
  return {
    success: true,
    method: 'PUT',
    uploadUrl: 'https://mock.r2.invalid/upload',
    headers: { 'Content-Type': input.contentType },
    publicId: key,
    contentType: input.contentType,
    maxBytes: 100 * 1024 * 1024,
    maxDurationSec: 60,
  };
}

/** Pretends to upload: progress climbs over ~3s. Nothing leaves the phone. */
export function fakeUpload(
  publicId: string,
  onProgress: (f: number) => void,
  setCancel: (cancel: () => void) => void,
): Promise<{ publicId: string }> {
  return new Promise((resolve, reject) => {
    let f = 0;
    const timer = setInterval(() => {
      f = Math.min(1, f + 0.07);
      onProgress(f);
      if (f >= 1) {
        clearInterval(timer);
        resolve({ publicId });
      }
    }, 200);
    setCancel(() => {
      clearInterval(timer);
      reject(new Error('Upload cancelled.'));
    });
  });
}

export async function createReel(input: { publicId: string; productId: string; caption: string }): Promise<Ok<{ reel: Reel }>> {
  await delay(500);
  const products = await loadProducts();
  const product = products.find((p) => p.id === input.productId) ?? products[0];
  const reel: Reel = {
    ...buildReel(1, products, 'pending'),
    id: `mine-${Date.now()}`,
    caption: input.caption,
    product,
    likeCount: 0,
    createdAt: new Date().toISOString(),
  };
  mine.unshift(reel);
  return { success: true, reel };
}
