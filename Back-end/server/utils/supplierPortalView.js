/**
 * What a SUPPLIER may see — allow-lists, never `toObject()` / spread.
 *
 * Every supplier API response is built here, so a field added to a model later
 * (a selling price, a margin, another supplier, staff names) stays hidden until
 * someone adds it here on purpose. tests/supplierPortalFoundation.test.js fails if
 * a forbidden key ever appears.
 *
 * Deliberately absent: productId / slug (the supplier app never links to the
 * storefront price), supplierId, reviewer identity, bank account number, password
 * and code fields, anything from Product, SupplierPriceReview or MarginRule.
 */
const id = (v) => (v == null ? null : String(v));
const date = (v) => (v ? new Date(v).toISOString() : null);

export function toSupplierAccountView(a) {
  if (!a) return null;
  return {
    id: id(a._id),
    email: a.email,
    emailVerified: Boolean(a.emailVerifiedAt),
    companyName: a.companyName,
    contactName: a.contactName,
    phone: a.phone,
    city: a.city || '',
    address: a.address || '',
    gstin: a.gstin || '',
    pan: a.pan || '',
    hasGstCertificate: Boolean(a.gstCertificate?.key),
    hasCancelledCheque: Boolean(a.cancelledCheque?.key),
    bank: {
      accountName: a.bank?.accountName || '',
      accountLast4: a.bank?.accountLast4 || '',
      ifsc: a.bank?.ifsc || '',
      upiId: a.bank?.upiId || '',
    },
    status: a.status,
    reviewNote: a.reviewNote || '',
    submittedAt: date(a.submittedAt),
  };
}

/** `imageUrl(key)` turns a private key into a short-lived URL (supplier API decides how). */
export function toSupplierListingView(l, { imageUrl = () => null } = {}) {
  if (!l) return null;
  return {
    id: id(l._id),
    status: l.status,
    rev: l.rev || 0,
    title: l.title,
    brand: l.brand || '',
    partNumber: l.partNumber || '',
    description: l.description || '',
    fits: l.fits || '',
    categoryHint: l.categoryHint || '',
    specs: (l.specs || []).map((s) => ({ label: s.label, value: s.value })),
    images: (l.images || []).map((img) => ({ key: img.key, url: imageUrl(img.key) })),
    costPaise: l.costPaise,
    gstPct: l.gstPct,
    availability: l.availability,
    availabilityAt: date(l.availabilityAt),
    dispatchDays: l.dispatchDays ?? null,
    reviewNote: l.reviewNote || '',
    submittedAt: date(l.submittedAt),
    liveAt: date(l.liveAt),
    updatedAt: date(l.updatedAt),
  };
}

/** Keys that must NEVER appear anywhere in a supplier response (checked by tests). */
export const FORBIDDEN_SUPPLIER_KEYS = Object.freeze([
  'price', 'originalPrice', 'salePrice', 'sellingPrice', 'suggestedPrice', 'decidedPrice', 'priceAtRaise',
  'marginBp', 'targetBp', 'floorBp', 'margin', 'productId', 'product', 'slug', 'supplierId',
  'reviewedBy', 'reviewedByName', 'passwordHash', 'emailCode', 'accountNumber', 'failedLogins', 'lockedUntil',
  'sessionVersion', 'supplierAccount',
]);
