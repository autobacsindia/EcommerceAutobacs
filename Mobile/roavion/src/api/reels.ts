/**
 * Shoppable reels — the client side of the shared contract in the reels plan
 * (all paths under /api/v1).
 *
 * MONEY RULE: a reel never carries a price into the cart. Add to cart / Buy now
 * call `attributeReel` (which sends nothing but the reel id) and then the normal
 * cart API with a product id and quantity. Every amount on screen is what the
 * server put in the reel's live product block.
 *
 * MOCK MODE: `EXPO_PUBLIC_REELS_MOCK=1` swaps in `reelsMock.ts`, which answers
 * with the same wrapped JSON the server sends; both paths go through the same
 * unwrapping below, so the mock exercises it too. The real API is the
 * default; the flag only changes where reels come from, never the cart.
 */
import { api } from './client';
import * as mock from './reelsMock';
import { reelVideoType, UNSUPPORTED_VIDEO_MESSAGE, type ReelVideoType } from '../reels/videoType';

export type ReelStatus = 'pending' | 'approved' | 'rejected' | 'removed';
/** `backorder` is buyable (ships when restocked); only `out` blocks the cart. */
export type Availability = 'in' | 'low' | 'out' | 'backorder';

export interface ReelProduct {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  /** Rupees, from the live product at read time. For a product with variants, the cheapest. */
  price: number;
  /** Live festival offer price — display only, never sent anywhere. */
  festivalPrice: number | null;
  /** Slashed "was" price when on sale; equal to `price` otherwise. */
  mrp: number | null;
  discountPercent: number;
  averageRating: number;
  ratingCount: number;
  availability: Availability;
  /** Variable product: the customer must pick an option on the product page. */
  hasVariants: boolean;
}

export interface Reel {
  id: string;
  status: ReelStatus;
  hlsUrl: string | null;
  mp4Url: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  caption: string;
  createdAt: string;
  /** id is null for a team upload with no named creator. */
  creator: { id: string | null; name: string; avatarUrl: string | null };
  product: ReelProduct | null;
  likeCount: number;
  viewerLiked: boolean;
  /** The product page URL; null if the server has no site URL configured. */
  shareUrl: string | null;
  /** Only on /reels/mine, for a rejected reel. */
  rejectReason?: string | null;
}

export interface ReelPage {
  reels: Reel[];
  nextCursor: string | null;
}

/** Every API response is wrapped: `{ success, ...payload }` (contract 2026-11-18). */
type Wrapped<T> = { success?: boolean } & T;

/**
 * Where to send one reel video (POST /reels/upload-signature, 2026-11-22 R2
 * contract). A presigned PUT to Cloudflare R2: the raw file bytes, with exactly
 * these headers. The byte size is signed into the URL, so it must match.
 */
export interface UploadTarget {
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  /** The storage key — sent back as `publicId` in POST /reels. */
  publicId: string;
  contentType: string;
  maxBytes: number;
  maxDurationSec: number;
}

/** Accepted video types live in ../reels/videoType (pure, unit-tested). */
export { reelVideoType, UNSUPPORTED_VIDEO_MESSAGE, type ReelVideoType };

export const REELS_MOCK = process.env.EXPO_PUBLIC_REELS_MOCK === '1';

/** Max reels per page, per the contract (limit <= 20). */
export const PAGE_SIZE = 8;

const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ── reads ───────────────────────────────────────────────────────────────────

export function fetchReels(cursor: string | null, signal?: AbortSignal): Promise<ReelPage> {
  const res: Promise<Wrapped<Partial<ReelPage>>> = REELS_MOCK
    ? mock.fetchReels(cursor, PAGE_SIZE)
    : api.get(`/reels${qs({ cursor, limit: PAGE_SIZE })}`, signal);
  return res.then(normalisePage);
}

export function fetchMyReels(cursor: string | null, signal?: AbortSignal): Promise<ReelPage> {
  const res: Promise<Wrapped<Partial<ReelPage>>> = REELS_MOCK
    ? mock.fetchMyReels(cursor, PAGE_SIZE)
    : api.get(`/reels/mine${qs({ cursor, limit: 20 })}`, signal);
  // A creator's own reels are listed whatever their state (a rejected one may
  // have no playable URL), so only the id is required here.
  return res.then((p) => ({ reels: (p?.reels ?? []).filter((r) => !!r?.id), nextCursor: p?.nextCursor ?? null }));
}

// ── engagement ──────────────────────────────────────────────────────────────

/** Idempotent; the server answers with the authoritative state and count. */
export function likeReel(id: string, liked: boolean): Promise<{ liked?: boolean; likeCount?: number }> {
  type LikeRes = Wrapped<{ liked?: boolean; likeCount?: number }>;
  const path = `/reels/${encodeURIComponent(id)}/like`;
  const res: Promise<LikeRes> = REELS_MOCK ? mock.likeReel(id, liked) : liked ? api.post<LikeRes>(path) : api.del<LikeRes>(path);
  return res.then((r) => ({ liked: r?.liked, likeCount: r?.likeCount }));
}

/** Fire-and-forget: a view count must never interrupt playback. */
export function recordView(id: string): void {
  if (REELS_MOCK) return;
  api.post(`/reels/${encodeURIComponent(id)}/view`).catch(() => {});
}

export function reportReel(id: string, reason: string): Promise<unknown> {
  if (REELS_MOCK) return mock.delay(400);
  return api.post(`/reels/${encodeURIComponent(id)}/report`, { reason });
}

/**
 * Tell the server this cart action came from a reel, so an eligible creator is
 * credited. Sends NO price or amount — the server decides eligibility. Never
 * blocks the purchase: a failure here only loses attribution.
 */
export async function attributeReel(id: string): Promise<void> {
  if (REELS_MOCK) return;
  try {
    // No body by contract. The response sets the referral cookie, which the
    // cart/checkout calls then carry (credentials: 'include').
    await api.post(`/reels/${encodeURIComponent(id)}/attribute`);
  } catch {
    /* attribution is best-effort; the customer's cart comes first */
  }
}

// ── posting ─────────────────────────────────────────────────────────────────

export interface PickedVideo {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

export function getUploadTarget(input: { contentType: ReelVideoType; size: number }): Promise<UploadTarget> {
  const res: Promise<Wrapped<Partial<UploadTarget>>> = REELS_MOCK
    ? mock.getUploadTarget(input)
    : api.post<Wrapped<Partial<UploadTarget>>>('/reels/upload-signature', input);
  return res.then((r) => {
    if (!r?.uploadUrl || !r.publicId) throw new Error('Could not prepare the upload. Please try again.');
    return {
      method: 'PUT',
      uploadUrl: r.uploadUrl,
      headers: r.headers ?? { 'Content-Type': input.contentType },
      publicId: r.publicId,
      contentType: r.contentType ?? input.contentType,
      maxBytes: r.maxBytes ?? 100 * 1024 * 1024,
      maxDurationSec: r.maxDurationSec ?? 60,
    };
  });
}

export function createReel(input: { publicId: string; productId: string; caption: string }): Promise<Reel> {
  const res: Promise<Wrapped<{ reel?: Reel }>> = REELS_MOCK ? mock.createReel(input) : api.post('/reels', input);
  // Re-posting the same publicId returns the same reel, so this is safe to retry.
  return res.then((r) => {
    if (!r?.reel?.id) throw new Error('Your reel could not be saved. Please try again.');
    return r.reel;
  });
}

/**
 * Upload one video and return its key for POST /reels. Steps:
 *   1. read the file to learn its exact byte size (the picker's fileSize is
 *      missing on some Android phones, and the size is signed into the URL);
 *   2. ask our API for a presigned R2 PUT for that type + size;
 *   3. PUT the raw bytes straight to R2 (never through our API), with progress.
 * XHR rather than fetch because fetch in React Native exposes no upload progress.
 */
export function uploadReelVideo(
  video: PickedVideo,
  onProgress: (fraction: number) => void,
): { promise: Promise<{ publicId: string }>; cancel: () => void } {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  // Mock upload's own cancel hook (set once it starts).
  let cancelOne: (() => void) | null = null;
  const cancelledError = () => new Error('Upload cancelled.');

  const promise = (async () => {
    const contentType = reelVideoType(video);
    if (!contentType) throw new Error(UNSUPPORTED_VIDEO_MESSAGE);

    if (REELS_MOCK) {
      const target = await getUploadTarget({ contentType, size: 1 });
      if (cancelled) throw cancelledError();
      return mock.fakeUpload(target.publicId, onProgress, (c) => (cancelOne = c));
    }

    let blob: Blob;
    try {
      blob = await (await fetch(video.uri)).blob();
    } catch {
      throw new Error('We could not read this video. Please pick it again.');
    }
    if (!blob.size) throw new Error('We could not read this video. Please pick it again.');
    if (cancelled) throw cancelledError();

    const target = await getUploadTarget({ contentType, size: blob.size });
    if (blob.size > target.maxBytes) {
      throw new Error(`Please choose a video under ${Math.floor(target.maxBytes / (1024 * 1024))} MB.`);
    }
    if (cancelled) throw cancelledError();

    await new Promise<void>((resolve, reject) => {
      const req = new XMLHttpRequest();
      xhr = req;
      req.open('PUT', target.uploadUrl);
      for (const [k, v] of Object.entries(target.headers)) req.setRequestHeader(k, v);
      req.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(0.99, e.loaded / e.total));
      };
      req.onload = () => {
        if (req.status >= 200 && req.status < 300) resolve();
        else reject(new Error(`Upload failed (${req.status}). Please try again.`));
      };
      req.onerror = () => reject(new Error('Upload failed — check your internet and try again.'));
      req.onabort = () => reject(cancelledError());
      req.send(blob);
    });
    onProgress(1);
    return { publicId: target.publicId };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      cancelOne?.();
      (xhr as XMLHttpRequest | null)?.abort();
    },
  };
}

// ── shape guard ─────────────────────────────────────────────────────────────

/**
 * Defensive defaults so one malformed reel can't crash the feed. Reels whose
 * product is missing (deleted/hidden) are dropped from the public feed: a
 * shoppable reel with nothing to buy is just noise.
 */
function normalisePage(page: Partial<ReelPage> | null | undefined): ReelPage {
  const reels = (page?.reels ?? []).filter((r): r is Reel => !!r && !!r.id && !!r.product && !!(r.hlsUrl || r.mp4Url));
  return { reels, nextCursor: page?.nextCursor ?? null };
}
