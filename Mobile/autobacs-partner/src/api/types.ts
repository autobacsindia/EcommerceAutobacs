/**
 * The supplier API contract, as the app sees it. Mirrors the allow-lists in
 * Back-end/server/utils/supplierPortalView.js (toSupplierAccountView /
 * toSupplierListingView). If a field is not here, the app does not use it —
 * and there is deliberately NO price, margin, productId or slug.
 */

export type AccountStatus =
  | 'email_unverified'
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type SupplierAccount = {
  id: string;
  email: string;
  emailVerified: boolean;
  companyName: string;
  contactName: string;
  phone: string;
  city: string;
  address: string;
  gstin: string;
  pan: string;
  hasGstCertificate: boolean;
  hasCancelledCheque: boolean;
  bank: { accountName: string; accountLast4: string; ifsc: string; upiId: string };
  status: AccountStatus;
  reviewNote: string;
  submittedAt: string | null;
};

export type ListingStatus = 'draft' | 'submitted' | 'changes_requested' | 'live' | 'rejected' | 'withdrawn';
export type Availability = 'in' | 'low' | 'out';

export type ListingImage = { key: string; url: string | null };
export type Spec = { label: string; value: string };

export type Listing = {
  id: string;
  status: ListingStatus;
  /** Bumped on every supplier edit; sent back on update (stale → 409 STALE). */
  rev: number;
  title: string;
  brand: string;
  partNumber: string;
  description: string;
  fits: string;
  categoryHint: string;
  specs: Spec[];
  images: ListingImage[];
  costPaise: number;
  gstPct: number;
  availability: Availability;
  availabilityAt: string | null;
  dispatchDays: number | null;
  reviewNote: string;
  submittedAt: string | null;
  liveAt: string | null;
  updatedAt: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type DocumentKind = 'gstCertificate' | 'cancelledCheque';

/** A photo picked on the phone, ready to upload. */
export type LocalFile = { uri: string; name: string; mimeType: string };

export type SignUpInput = {
  email: string;
  password: string;
  companyName: string;
  contactName: string;
  phone: string;
};

export type ProfileInput = {
  companyName: string;
  contactName: string;
  phone: string;
  city: string;
  address: string;
  gstin: string;
  pan: string;
  /** Full number only when (re)entered; omitted keeps the saved one. */
  bank: { accountName: string; accountNumber?: string; ifsc: string; upiId: string };
};

export type ListingInput = {
  title: string;
  brand: string;
  partNumber: string;
  description: string;
  fits: string;
  categoryHint: string;
  specs: Spec[];
  costPaise: number;
  gstPct: number;
  availability: Availability;
  dispatchDays: number;
};

export type AuthResult = { token: string; account: SupplierAccount };

/** Everything the screens may call. Implemented by the real API and the dev mock. */
export interface PartnerApi {
  /** Returns a token at once; the account starts as `email_unverified`. */
  signUp(input: SignUpInput): Promise<AuthResult>;
  /** Signed in (Bearer). */
  verifyEmail(code: string): Promise<SupplierAccount>;
  /** Signed in (Bearer); 429 RESEND_COOLDOWN carries retryAfterSeconds. */
  resendCode(): Promise<void>;
  signIn(email: string, password: string): Promise<AuthResult>;
  forgotPassword(email: string): Promise<void>;
  /** Signs in on success (old tokens are revoked server-side). */
  resetPassword(email: string, code: string, password: string): Promise<AuthResult>;
  signOutEverywhere(): Promise<void>;

  me(): Promise<SupplierAccount>;
  updateMe(input: ProfileInput): Promise<SupplierAccount>;
  uploadDocument(kind: DocumentKind, file: LocalFile): Promise<SupplierAccount>;
  submitForReview(): Promise<SupplierAccount>;

  listListings(params: { status?: ListingStatus; cursor?: string | null; limit?: number }): Promise<Page<Listing>>;
  getListing(id: string): Promise<Listing>;
  createListing(input: ListingInput): Promise<Listing>;
  updateListing(id: string, rev: number, input: ListingInput): Promise<Listing>;
  uploadListingPhoto(id: string, file: LocalFile): Promise<Listing>;
  /** `key` is the image key from the listing view; the API takes its last segment. */
  deleteListingPhoto(id: string, key: string): Promise<Listing>;
  submitListing(id: string): Promise<Listing>;
  withdrawListing(id: string): Promise<Listing>;
  setAvailability(id: string, availability: Availability): Promise<Listing>;
}
