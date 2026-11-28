/**
 * Staff Reels review queue — types and calls for `/admin/reels/*`.
 *
 * The shapes follow the shared contract in the reels plan (backend owns it).
 * Every action here is SERVER-CONFIRMED: the UI waits for the response and then
 * refetches, so a reel never shows as "Live" unless the server says it is.
 */
import apiClient from '@/lib/api-client';

/** `processing` = the server is converting the video to a format every phone plays. */
export type ReelStatus = 'processing' | 'pending' | 'approved' | 'rejected' | 'removed';

export interface ReelProduct {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  price: number;
  /** Live festival offer price — display only; null when no offer. */
  festivalPrice?: number | null;
  /** Variable product: `price` is the cheapest model. */
  hasVariants?: boolean;
  /** Equals `price` when not on sale. */
  mrp: number | null;
  discountPercent: number | null;
  averageRating: number;
  ratingCount: number;
  /** `backorder` is still purchasable; only `out` blocks buying. */
  availability: 'in' | 'low' | 'out' | 'backorder';
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
  /** Team upload with no named creator: `{ id: null, name: 'Autobacs India' }`. */
  creator: { id: string | null; name: string; avatarUrl: string | null } | null;
  /** Null when the tagged product was deleted or deactivated. */
  product: ReelProduct | null;
  likeCount: number;
  viewerLiked: boolean;
  shareUrl: string | null;
  // ── Admin list only (contract change 2026-11-18) ──
  rejectReason?: string | null;
  reportCount?: number;
  viewCount?: number;
  source?: 'customer' | 'team';
  moderatedAt?: string | null;
  /** False when the tagged product is inactive/deleted — the reel is hidden from shoppers. */
  productLive?: boolean;
}

export interface ReelPage {
  reels: Reel[];
  nextCursor: string | null;
}

export const REEL_TABS: { status: ReelStatus; label: string; empty: string }[] = [
  { status: 'pending', label: 'Waiting for review', empty: 'No reels are waiting for review.' },
  { status: 'approved', label: 'Live', empty: 'No reels are live yet.' },
  { status: 'rejected', label: 'Rejected', empty: 'No rejected reels.' },
  { status: 'removed', label: 'Removed', empty: 'No removed reels.' },
  { status: 'processing', label: 'Converting', empty: 'No videos are being converted right now.' },
];

/** Short reasons staff tap most often; free text can replace or add to them. */
export const REJECT_PRESETS = [
  'Video is blurry or too dark',
  'Product is not shown clearly',
  'Wrong product tagged',
  'Inappropriate content',
  'Contains another brand or contact details',
];

export const REJECT_REASON_MAX = 300;
export const CAPTION_MAX = 300;
/** Contract caps `limit` at 20. */
export const PAGE_SIZE = 20;

export async function fetchAdminReels(status: ReelStatus, cursor: string): Promise<ReelPage> {
  const params = new URLSearchParams({ status, limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  // Backend wraps every response: { success, reels, nextCursor }.
  const res = (await apiClient.get(`/admin/reels?${params.toString()}`)) as unknown as Partial<ReelPage>;
  return { reels: Array.isArray(res?.reels) ? res.reels : [], nextCursor: res?.nextCursor ?? null };
}

export const approveReel = (id: string) => apiClient.post(`/admin/reels/${encodeURIComponent(id)}/approve`, {});
export const rejectReel = (id: string, reason: string) =>
  apiClient.post(`/admin/reels/${encodeURIComponent(id)}/reject`, { reason });
export const removeReel = (id: string) => apiClient.post(`/admin/reels/${encodeURIComponent(id)}/remove`, {});

export interface TeamReelInput {
  publicId: string;
  productId: string;
  caption: string;
  creatorUserId?: string;
}
export const createTeamReel = (input: TeamReelInput) => apiClient.post('/admin/reels', input) as unknown as Promise<Reel>;

/** Turn an API error into a sentence staff can act on. */
export function errorText(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    const m = (err as { message: string }).message.trim();
    if (m) return m;
  }
  return fallback;
}
