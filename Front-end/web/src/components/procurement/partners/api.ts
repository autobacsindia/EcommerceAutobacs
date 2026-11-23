import apiClient from '@/lib/api-client';

/**
 * Autobacs Partner — procurement's side. The API is /api/procurement/partners
 * (backend routes/procurementPartners.js). Every number shown here is worked out
 * or re-checked by the server; the price maths below only gives instant feedback
 * while typing, and the server refuses a below-cost price whatever this says.
 */

const BASE = '/procurement/partners';
const enc = encodeURIComponent;

export const partnerKeys = {
  all: ['procurement-partners'] as const,
  counts: () => [...partnerKeys.all, 'counts'] as const,
  accounts: (status: string) => [...partnerKeys.all, 'accounts', status] as const,
  account: (id: string) => [...partnerKeys.all, 'account', id] as const,
  listings: (status: string) => [...partnerKeys.all, 'listings', status] as const,
  listing: (id: string) => [...partnerKeys.all, 'listing', id] as const,
  priceReviews: (status: string) => [...partnerKeys.all, 'price-reviews', status] as const,
  priceHistory: (productId: string) => [...partnerKeys.all, 'price-history', productId] as const,
  marginRules: () => [...partnerKeys.all, 'margin-rules'] as const,
};

export type Counts = { accounts: number; listings: number; priceReviews: number; total: number };

export type AccountStatus = 'in_review' | 'changes_requested' | 'approved' | 'suspended' | 'rejected';
export type AccountRow = {
  id: string; companyName: string; contactName: string; email: string; phone: string; city: string;
  status: AccountStatus; submittedAt: string | null; reviewedAt: string | null; reviewedByName: string; supplierId: string | null;
};
export type PossibleSupplier = { id: string; name: string; gstin: string; phone: string; accountMasked: string; ifsc: string; upiId: string };
export type AccountDetail = AccountRow & {
  address: string; gstin: string; pan: string; reviewNote: string; createdAt: string | null;
  documents: { gstCertificate: { contentType: string } | null; cancelledCheque: { contentType: string } | null };
  bank: { accountName: string; accountNumber: string; accountLast4: string; ifsc: string; upiId: string };
  possibleSuppliers: PossibleSupplier[];
  linkedSupplier?: { id: string; name: string; bankChangedAt: string | null } | null;
};

export type ListingStatus = 'submitted' | 'changes_requested' | 'live' | 'rejected' | 'withdrawn';
export type Availability = 'in' | 'low' | 'out';
export type ListingRow = {
  id: string; companyName: string; status: ListingStatus; rev: number; title: string; brand: string; partNumber: string;
  costPaise: number; gstPct: number; availability: Availability; imageCount: number; submittedAt: string | null;
  productId: string | null; editedSinceLive: boolean;
};
export type ProductCard = {
  id: string; name: string; slug: string; sku: string; price: number; stock: string; isActive: boolean; productType: string; image: string;
};
export type MarginRule = { targetBp: number; floorBp: number; source?: string };
export type Pricing = {
  costPaise: number; gstPct: number; rule: MarginRule; suggestedPrice: number;
  currentPrice?: number; currentMarginBp?: number; currentBelowFloor?: boolean; currentBelowCost?: boolean;
};
export type ListingDetail = ListingRow & {
  supplier: { id: string; companyName: string; status: string; city: string; phone: string } | null;
  description: string; fits: string; categoryHint: string; specs: { label: string; value: string }[];
  images: { index: number; contentType: string }[]; dispatchDays: number; availabilityAt: string | null;
  reviewNote: string; reviewedByName: string; drivesStock: boolean;
  product: ProductCard | null; duplicates: ProductCard[]; pricing: Pricing;
};

export type PriceReview = {
  id: string; status: 'pending' | 'applied' | 'kept' | 'superseded'; listingId: string; productId: string;
  productName: string; productSlug: string; listingTitle: string; companyName: string;
  oldCostPaise: number; newCostPaise: number; gstPct: number; priceAtRaise: number; currentPrice: number | null;
  suggestedPrice: number; marginBp: number; currentMarginBp?: number; currentBelowFloor?: boolean; currentBelowCost?: boolean;
  floorBp?: number; decidedPrice: number | null; decidedByName: string; decidedAt: string | null; note: string; createdAt: string | null;
};

export type RuleRow = { key: string; categoryId: string | null; categoryName: string; targetBp: number; floorBp: number; updatedByName: string; updatedAt: string | null };
export type MarginRules = { builtIn: MarginRule; default: RuleRow | null; categories: RuleRow[] };

type Page<T> = { status: string; items: T[]; nextCursor: string | null };

const qs = (params: Record<string, string>) => new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();

export const getCounts = () => apiClient.get<{ counts: Counts }>(`${BASE}/counts`).then((r) => r.counts);

export const listAccounts = (status: string, after = '') => apiClient.get<Page<AccountRow>>(`${BASE}/accounts?${qs({ status, after })}`);
export const getAccount = (id: string) => apiClient.get<{ account: AccountDetail }>(`${BASE}/accounts/${enc(id)}`).then((r) => r.account);
export const documentUrl = (id: string, kind: 'gst-certificate' | 'cancelled-cheque') => `/api/v1${BASE}/accounts/${enc(id)}/documents/${kind}`;
export type ApproveAccountInput = { mode: 'new' } | { mode: 'link'; supplierId: string; copyBank: boolean };
export const approveAccount = (id: string, body: ApproveAccountInput) =>
  apiClient.post<{ account: AccountDetail; bankChanged: boolean; created: boolean }>(`${BASE}/accounts/${enc(id)}/approve`, body);
export type AccountAction = 'request-changes' | 'reject' | 'suspend' | 'unsuspend';
export const accountAction = (id: string, action: AccountAction, note = '') =>
  apiClient.post<{ account: AccountDetail }>(`${BASE}/accounts/${enc(id)}/${action}`, { note });

export const listListings = (status: string, after = '') => apiClient.get<Page<ListingRow>>(`${BASE}/listings?${qs({ status, after })}`);
export const getListing = (id: string) => apiClient.get<{ listing: ListingDetail }>(`${BASE}/listings/${enc(id)}`).then((r) => r.listing);
export const listingImageUrl = (id: string, index: number) => `/api/v1${BASE}/listings/${enc(id)}/images/${index}`;
export const quoteListing = (id: string, body: { categories: string[]; price?: number | null }) =>
  apiClient.post<{ pricing: Pricing }>(`${BASE}/listings/${enc(id)}/quote`, body).then((r) => r.pricing);

export type ProductForm = {
  name: string; description: string; shortDescription: string; categories: string[]; brand: string; sku: string;
  specifications: { key: string; value: string }[];
};
export type PriceOverride = { override?: boolean; overrideReason?: string };
export type ApproveNewInput = PriceOverride & {
  rev: number; product: ProductForm; price: number; keepHidden: boolean; imageIndexes: number[]; drivesStock: boolean;
};
export type ApproveLinkInput = PriceOverride & { rev: number; productId: string; setPrice: boolean; price?: number; drivesStock?: boolean };
type ApproveResult = { listing: ListingRow; product: ProductCard | null; created: boolean };
export const approveNew = (id: string, body: ApproveNewInput) => apiClient.post<ApproveResult>(`${BASE}/listings/${enc(id)}/approve-new`, body);
export const approveLink = (id: string, body: ApproveLinkInput) => apiClient.post<ApproveResult>(`${BASE}/listings/${enc(id)}/approve-link`, body);
export const listingAction = (id: string, action: 'request-changes' | 'reject', note: string) =>
  apiClient.post<{ listing: ListingRow }>(`${BASE}/listings/${enc(id)}/${action}`, { note });

export const listPriceReviews = (status: string, after = '') => apiClient.get<Page<PriceReview>>(`${BASE}/price-reviews?${qs({ status, after })}`);
export const priceHistory = (productId: string) =>
  apiClient.get<{ items: PriceReview[]; nextCursor: string | null }>(`${BASE}/price-reviews/product/${enc(productId)}`);
export const applyPrice = (id: string, body: PriceOverride & { price: number; note?: string }) =>
  apiClient.post<{ review: PriceReview }>(`${BASE}/price-reviews/${enc(id)}/apply`, body);
export const keepPrice = (id: string, body: PriceOverride & { note?: string }) =>
  apiClient.post<{ review: PriceReview }>(`${BASE}/price-reviews/${enc(id)}/keep`, body);

export const getMarginRules = () => apiClient.get<{ rules: MarginRules }>(`${BASE}/margin-rules`).then((r) => r.rules);
export const setMarginRule = (body: { categoryId: string | null; targetPct: string; floorPct: string }) =>
  apiClient.put<{ rules: MarginRules }>(`${BASE}/margin-rules`, body).then((r) => r.rules);
export const deleteMarginRule = (categoryId: string) =>
  apiClient.delete<{ rules: MarginRules }>(`${BASE}/margin-rules/${enc(categoryId)}`).then((r) => r.rules);

/** The server's message ("₹2,200 gives a 3.4% margin…"), or a fallback. */
export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;
export const errorCode = (e: unknown) => (e as { rawData?: { code?: string } })?.rawData?.code || '';

// ── Price maths (mirrors Back-end/server/utils/supplierPricing.js; display only) ──
const BP = 10000;
const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);

/** Whole-rupee price incl. GST that gives at least `marginBp` on `costPaise` (ex-GST). */
export function suggestPrice(costPaise: number, gstPct: number, marginBp: number): number {
  const exGst = ceilDiv(costPaise * BP, BP - marginBp);
  return ceilDiv(ceilDiv(exGst * (100 + gstPct), 100), 100);
}

/** Margin (basis points of the price without GST; may be negative) a price gives. */
export function marginOf(costPaise: number, gstPct: number, priceRupees: number): number {
  const exGst = Math.round((Math.round(priceRupees * 100) * 100) / (100 + gstPct));
  return Math.floor(((exGst - costPaise) * BP) / exGst);
}

/** The rule for a set of categories: the first with its own rule → default → built-in (same as the server). */
export function ruleFor(rules: MarginRules | undefined, categoryIds: string[]): MarginRule | null {
  if (!rules) return null;
  for (const id of categoryIds) {
    const r = rules.categories.find((c) => c.categoryId === id);
    if (r) return { targetBp: r.targetBp, floorBp: r.floorBp, source: r.key };
  }
  return rules.default ? { targetBp: rules.default.targetBp, floorBp: rules.default.floorBp, source: 'default' } : { ...rules.builtIn, source: 'built-in' };
}

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const paiseToRupees = (p: number) => rupees(p / 100);
export const pct = (bp: number) => `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;

export const AVAILABILITY_LABEL: Record<Availability, string> = { in: 'In stock', low: 'Low stock', out: 'Out of stock' };
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  in_review: 'Waiting for review', changes_requested: 'Asked to fix', approved: 'Approved', suspended: 'Paused', rejected: 'Rejected',
};
export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  submitted: 'Waiting for review', changes_requested: 'Asked to fix', live: 'Live', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
