/**
 * Mock reels source — ONLY used when EXPO_PUBLIC_REELS_MOCK=1. It answers with
 * the server's exact JSON (contract 2026-11-18: wrapped `{ success, ... }`,
 * cursor pagination, limit), so switching the flag off changes nothing on screen.
 *
 * Demo content for presentations: each reel pairs a car clip with a REAL live
 * catalogue product that matches it, read by slug from the live API at runtime,
 * so price, sale price, stock and variants are exactly what the shop shows. The
 * edge cases come from the real products themselves (out of stock, backorder,
 * variants, a live sale), plus a team upload and one null shareUrl. There is no
 * festival price: none is live, and the demo does not invent one.
 *
 * Videos stream from Pexels (free licence, commercial use, no attribution
 * needed) at 720x1280 or smaller; nothing is bundled in the app. Add to cart /
 * Buy now use the genuine guest cart; nothing here creates an order or payment.
 */
import { fetchProduct, type Product } from './catalogue';
import type { Reel, ReelPage, ReelProduct, UploadTarget } from './reels';

type Ok<T> = { success: true } & T;

const pexels = (videoId: number, file: string, poster: string) => ({
  mp4Url: `https://videos.pexels.com/video-files/${videoId}/${file}`,
  posterUrl: `https://images.pexels.com/videos/${videoId}/${poster}?auto=compress&cs=tinysrgb&w=720`,
});

const TEAM: Reel['creator'] = { id: null, name: 'Autobacs India', avatarUrl: null };
const creator = (id: string, name: string): Reel['creator'] => ({ id, name, avatarUrl: null });

interface DemoReel {
  clip: { mp4Url: string; posterUrl: string };
  durationSec: number;
  /** Live catalogue slug; looked up at runtime so money and stock are real. */
  productSlug: string;
  creator: Reel['creator'];
  caption: string;
}

/** Clip → product pairs. Each clip was checked by eye to show what the product is for. */
const DEMO: DemoReel[] = [
  {
    // Cabin glowing red and blue at night.
    clip: pexels(10385805, '10385805-hd_720_1366_25fps.mp4', 'pexels-photo-10385805.jpeg'),
    durationSec: 32,
    productSlug: 'ambient-lights-for-xuv-700',
    creator: creator('c1', 'Arjun Drives'),
    caption: 'Night drives hit different now 🌌 Ambient lights in, mood set.',
  },
  {
    // A modern dashboard with a wide touch screen.
    clip: pexels(36202861, '15352315_720_1280_30fps.mp4', 'pexels-photo-36202861.jpeg'),
    durationSec: 5,
    productSlug: 'diamond-2k-android-with-360-camera-kit', // has variants
    creator: creator('c2', 'Meera on Wheels'),
    caption: 'Big screen, 360 camera, no more guessing in tight parking 📱',
  },
  {
    // Black alloy wheel, low angle.
    clip: pexels(33596417, '14281088_720_1280_24fps.mp4', 'pexels-photo-33596417.jpeg'),
    durationSec: 13,
    productSlug: 'thar-roxx-wheel-spacer', // out of stock
    creator: creator('c3', 'Stance by Rohan'),
    caption: 'Wheels flush with the arches. That stance though 😮‍💨',
  },
  {
    // A Thar ROXX climbing out of a muddy pit.
    clip: pexels(40486505, '17301272_720_1280_50fps.mp4', 'pexels-photo-40486505.jpeg'),
    durationSec: 9,
    productSlug: 'ironman-nitrogas-suspension-kit-for-mahindra-thar-roxx',
    creator: creator('c4', 'Thar Tribe Chennai'),
    caption: 'Sunday at the off-road track with the ROXX 🏁 Who is coming next week?',
  },
  {
    // Red Jeep on a trail through puddles.
    clip: pexels(40414356, '17267785_720_1280_30fps.mp4', 'pexels-photo-40414356.jpeg'),
    durationSec: 13,
    productSlug: 'jeep-wrangler-functional-snorkel',
    creator: creator('c5', 'Kerala Overlanders'),
    caption: 'Monsoon trails are calling 🌧️ Water crossings, sorted.',
  },
  {
    // Headlights on a dark country road.
    clip: pexels(34738405, '14726106_720_1280_32fps.mp4', 'pexels-photo-34738405.jpeg'),
    durationSec: 9,
    productSlug: 'lightforce-genesis-professional-edition-led-driving-light', // live sale
    creator: TEAM,
    caption: 'Highway nights need proper light. Lightforce Genesis, now in store.',
  },
  {
    // Classic Defender parked by a barn.
    clip: pexels(31943164, '13607996_720_1280_100fps.mp4', 'pexels-photo-31943164.jpeg'),
    durationSec: 15,
    productSlug: 'land-rover-defender-2023-heavy-duty-rooflight', // live sale
    creator: creator('c6', 'Defender Diaries'),
    caption: 'Some cars you just walk up to slowly 🖤',
  },
  {
    // Small 4x4s on a snowy hillside trail.
    clip: pexels(8737890, '8737890-hd_720_1280_60fps.mp4', 'pexels-photo-8737890.jpeg'),
    durationSec: 15,
    productSlug: 'hamer-rear-bumper-for-suzuki-jimni',
    creator: creator('c7', 'Himachal Off-Road Club'),
    caption: 'Snow, slush and a small 4x4 that refuses to quit ❄️',
  },
  {
    // SUV on a green hillside, drone shot.
    clip: pexels(38499146, '16349993_720_1280_60fps.mp4', 'pexels-photo-38499146.jpeg'),
    durationSec: 15,
    productSlug: 'profender-titan-series-suspension-bundle-kit-toyota-hilux-travo', // backorder
    creator: creator('c8', 'Overland with Kabir'),
    caption: 'Long weekend, no plan, good suspension ⛰️',
  },
  {
    // Driver's view: phone navigation on the dash, city traffic ahead.
    clip: pexels(36067574, '15295724_720_1280_24fps.mp4', 'pexels-photo-36067574.jpeg'),
    durationSec: 15,
    productSlug: '70mai-omni-4k-dash-cam',
    creator: TEAM,
    caption: 'Every city drive, on record. The 70mai Omni 4K dash cam.',
  },
];

const TOTAL = DEMO.length;

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toReelProduct(p: Product): ReelProduct {
  const variable = p.productType === 'variable';
  const price = variable ? p.priceFrom : p.price;
  return {
    id: p.id,
    slug: p.slug,
    title: p.name,
    image: p.image || null,
    price,
    festivalPrice: null,
    mrp: p.mrp ?? price,
    discountPercent: p.discountPercent,
    averageRating: p.rating,
    ratingCount: p.reviews,
    // The live API also sends 'backorder', which the catalogue type does not list.
    availability: p.stock as ReelProduct['availability'],
    hasVariants: variable,
  };
}

/** One entry per DEMO reel; null when that product could not be read (offline, or delisted). */
let productsPromise: Promise<(ReelProduct | null)[]> | null = null;

function loadProducts(): Promise<(ReelProduct | null)[]> {
  productsPromise ??= Promise.all(
    DEMO.map((d) => fetchProduct(d.productSlug).then(toReelProduct, () => null)),
  ).then((list) => {
    if (list.every((p) => p === null)) productsPromise = null; // offline: try again next time
    return list;
  });
  return productsPromise;
}

const likes = new Map<string, boolean>();

function buildReel(i: number, products: (ReelProduct | null)[], status: Reel['status'] = 'approved'): Reel {
  const demo = DEMO[i % TOTAL];
  const product = products[i % TOTAL];
  const id = `mock-reel-${i + 1}`;
  return {
    id,
    status,
    hlsUrl: null,
    mp4Url: demo.clip.mp4Url,
    posterUrl: demo.clip.posterUrl,
    durationSec: demo.durationSec,
    caption: demo.caption,
    createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    creator: demo.creator,
    product,
    likeCount: 120 + ((i * 97) % 900) + (likes.get(id) ? 1 : 0),
    viewerLiked: likes.get(id) ?? false,
    // null = server has no site URL configured; the app falls back itself.
    shareUrl: i === 2 || !product ? null : `https://www.autobacsindia.com/products/${product.slug}`,
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
  const product = products.find((p) => p?.id === input.productId) ?? products.find((p) => p !== null) ?? null;
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
