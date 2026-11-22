/**
 * The real supplier API (`/api/v1/partner/*`, routes/partner.js on branch
 * claude/partner-supplier-api-353d96; contract in that session's hand-over
 * note `partner-supplier-api.md`).
 *
 * EVERY path and response shape lives in this file. Bodies are strict
 * allow-lists on the server (unknown key → 400 UNKNOWN_FIELDS), so we send only
 * input fields — never view fields like id/status/images (except `rev`).
 */
import { ApiError, fileForm, http } from './client';
import type {
  Availability,
  AuthResult,
  DocumentKind,
  Listing,
  ListingInput,
  ListingStatus,
  LocalFile,
  Page,
  PartnerApi,
  ProfileInput,
  SignUpInput,
  SupplierAccount,
} from './types';

type Envelope = Record<string, unknown> & { data?: Record<string, unknown> };

function pick<T>(res: Envelope, ...names: string[]): T {
  const scopes = [res, res.data ?? {}];
  for (const scope of scopes) {
    for (const n of names) {
      const v = (scope as Record<string, unknown>)[n];
      if (v !== undefined && v !== null) return v as T;
    }
  }
  throw new ApiError('The server sent an unexpected reply. Please update the app or try again.', 200, 'BAD_SHAPE');
}

const account = (r: Envelope) => pick<SupplierAccount>(r, 'account', 'supplier', 'me');
const listing = (r: Envelope) => pick<Listing>(r, 'listing');
const auth = (r: Envelope): AuthResult => ({ token: pick<string>(r, 'token', 'accessToken'), account: account(r) });

const P = '/partner';

/** Last segment of an image key ("…/photo-abc.jpg" → "photo-abc.jpg") — the API's photoId. */
export const photoIdOf = (key: string) => key.split('/').pop() ?? key;

export const partnerApi: PartnerApi = {
  async signUp(input: SignUpInput) {
    return auth(await http.post<Envelope>(`${P}/auth/signup`, input));
  },
  async verifyEmail(code) {
    return account(await http.post<Envelope>(`${P}/auth/verify-email`, { code }));
  },
  async resendCode() {
    await http.post(`${P}/auth/resend-code`, {});
  },
  async signIn(email, password) {
    return auth(await http.post<Envelope>(`${P}/auth/login`, { email, password }));
  },
  async forgotPassword(email) {
    await http.post(`${P}/auth/forgot`, { email });
  },
  async resetPassword(email, code, password) {
    return auth(await http.post<Envelope>(`${P}/auth/reset`, { email, code, password }));
  },
  async signOutEverywhere() {
    await http.post(`${P}/auth/logout-all`, {});
  },

  async me() {
    return account(await http.get<Envelope>(`${P}/me`));
  },
  async updateMe(input: ProfileInput) {
    return account(await http.patch<Envelope>(`${P}/me`, input));
  },
  async uploadDocument(kind: DocumentKind, file: LocalFile) {
    return account(await http.upload<Envelope>(`${P}/me/documents/${kind}`, await fileForm('file', file)));
  },
  async submitForReview() {
    return account(await http.post<Envelope>(`${P}/me/submit`, {}));
  },

  async listListings({ status, cursor, limit = 20 }: { status?: ListingStatus; cursor?: string | null; limit?: number }) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set('status', status);
    if (cursor) q.set('cursor', cursor);
    const r = await http.get<Envelope>(`${P}/listings?${q.toString()}`);
    return {
      items: pick<Listing[]>(r, 'listings', 'items'),
      nextCursor: ((r.nextCursor ?? r.data?.nextCursor) as string | null | undefined) ?? null,
    } satisfies Page<Listing>;
  },
  async getListing(id) {
    return listing(await http.get<Envelope>(`${P}/listings/${encodeURIComponent(id)}`));
  },
  async createListing(input: ListingInput) {
    return listing(await http.post<Envelope>(`${P}/listings`, input));
  },
  async updateListing(id, rev, input: ListingInput) {
    return listing(await http.patch<Envelope>(`${P}/listings/${encodeURIComponent(id)}`, { ...input, rev }));
  },
  async uploadListingPhoto(id, file: LocalFile) {
    return listing(await http.upload<Envelope>(`${P}/listings/${encodeURIComponent(id)}/photos`, await fileForm('photo', file)));
  },
  async deleteListingPhoto(id, key) {
    return listing(await http.del<Envelope>(`${P}/listings/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoIdOf(key))}`));
  },
  async submitListing(id) {
    return listing(await http.post<Envelope>(`${P}/listings/${encodeURIComponent(id)}/submit`, {}));
  },
  async withdrawListing(id) {
    return listing(await http.post<Envelope>(`${P}/listings/${encodeURIComponent(id)}/withdraw`, {}));
  },
  async setAvailability(id, availability: Availability) {
    return listing(await http.patch<Envelope>(`${P}/listings/${encodeURIComponent(id)}/availability`, { availability }));
  },
};
