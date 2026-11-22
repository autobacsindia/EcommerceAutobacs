/**
 * Supplier listings — procurement's product review queue.
 *
 *   approve (new)    submitted → live, creating a Product from procurement's edited form
 *   approve (link)   submitted → live, attached to an existing Product (optionally re-priced)
 *   request-changes  submitted → changes_requested
 *   reject           submitted | changes_requested → rejected
 *
 * ── The rules that keep money and the storefront right ──────────────────────
 *   • Approval names the listing `rev` it reviewed; if the supplier edited since,
 *     the claim misses and the answer is 409 LISTING_CHANGED — nothing unseen goes live.
 *   • Price is whole rupees incl. GST, checked by shared.priceDecision: below the
 *     supplier's cost is always refused; below the floor margin needs an explicit
 *     override with a reason (recorded on the listing's review note + audit log).
 *   • Claim-first (CAS status submitted+rev → live, productId null), then the
 *     product write, then productId is set. A failure puts the listing back to
 *     submitted and deletes any copied photos. So a double-click makes ONE product:
 *     the second click's claim misses and it answers with the product already made.
 *   • The supplier's cost never reaches Product (productWrites.assertNoCost).
 *   • `drivesStock` (one stock source per product in v1): default true when no
 *     other live listing drives the product; its availability is written to
 *     Product.stock. Out of stock = stock 'out', never isActive false.
 */
import auditLogger from '../auditLogger.js';
import SearchService from '../searchService.js';
import repo, { LISTING_STATUS as L, SUPPLIER_ACCOUNT_STATUS as A } from '../../repositories/supplierPartnerAdminRepository.js';
import { keysetPage } from '../../utils/listQuery.js';
import { readPrivateAsset } from '../storage/privateUploads.js';
import { deleteHostedImages } from '../storage/publicImageDeletes.js';
import {
  PAGE_SIZE, cleanPrice, fail, guard, idOf, iso, priceDecision, pricingView, requireId, requireNote, stamp, text,
} from './shared.js';
import { cleanProductForm, copyListingImages, createProduct, updateProduct } from './productWrites.js';

export const LISTING_QUEUE_STATUSES = Object.freeze([L.SUBMITTED, L.CHANGES_REQUESTED, L.LIVE, L.REJECTED, L.WITHDRAWN]);
const SORTS = Object.freeze({
  oldest: { field: 'submittedAt', dir: 1, type: 'date' },
  newest: { field: 'submittedAt', dir: -1, type: 'date' },
});
const DUPLICATE_LIMIT = 6;

function productCard(p) {
  if (!p) return null;
  return {
    id: idOf(p._id),
    name: p.name,
    slug: p.slug,
    sku: p.sku || '',
    price: p.price,
    stock: p.stock,
    isActive: p.isActive !== false,
    productType: p.productType || 'simple',
    image: p.images?.find((i) => i.isPrimary)?.url || p.images?.[0]?.url || '',
  };
}

function rowOf(l, companyName = '') {
  return {
    id: idOf(l._id),
    companyName,
    status: l.status,
    rev: l.rev || 0,
    title: l.title,
    brand: l.brand || '',
    partNumber: l.partNumber || '',
    costPaise: l.costPaise,
    gstPct: l.gstPct,
    availability: l.availability,
    imageCount: (l.images || []).length,
    submittedAt: iso(l.submittedAt),
    productId: idOf(l.productId),
    editedSinceLive: Boolean(l.editedSinceLive),
  };
}

export async function list(actor, params = {}) {
  guard(actor);
  const status = LISTING_QUEUE_STATUSES.includes(params.status) ? params.status : L.SUBMITTED;
  const sortName = status === L.SUBMITTED || status === L.CHANGES_REQUESTED ? 'oldest' : 'newest';
  const page = await keysetPage({
    query: { status, submittedAt: { $type: 'date' } },
    sorts: SORTS,
    sortName,
    cursor: params.after,
    pageSize: PAGE_SIZE,
    find: repo.listingPage,
  });
  // One read for the page's company names (no N+1).
  const ids = [...new Set(page.items.map((l) => String(l.supplierAccount)))];
  const accounts = ids.length ? await repo.findAccountsByIds(ids) : [];
  const names = new Map(accounts.map((a) => [String(a._id), a.companyName]));
  return { status, items: page.items.map((l) => rowOf(l, names.get(String(l.supplierAccount)) || '')), nextCursor: page.nextCursor };
}

async function load(id) {
  const l = await repo.findListing(requireId(id, 'listing'));
  if (!l) throw fail('That listing was not found.', 404);
  return l;
}

/**
 * Existing products this might be: an exact SKU = part number, then the admin
 * product search (SearchService, includeInactive — the same call the admin
 * product list makes) for the part number and the title. Advisory only: a
 * search failure shows no suggestions, it never blocks the review.
 */
async function possibleDuplicates(l) {
  const ids = [];
  const add = (id) => { const s = String(id); if (!ids.includes(s)) ids.push(s); };
  try {
    if (l.partNumber) {
      const exact = await repo.findProductBySku(l.partNumber);
      if (exact) add(exact._id);
    }
    for (const term of [l.partNumber, l.title].map((t) => text(t, 100)).filter((t) => t.length >= 2)) {
      if (ids.length >= DUPLICATE_LIMIT) break;
      const { products = [] } = await SearchService.searchProducts({ search: term, limit: DUPLICATE_LIMIT, page: 1 }, { includeInactive: true });
      products.forEach((p) => add(p._id));
    }
  } catch (err) {
    console.warn('[procurementPartners] duplicate search failed:', err.message);
  }
  const top = ids.slice(0, DUPLICATE_LIMIT);
  if (!top.length) return [];
  const docs = await repo.findProducts(top);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return top.map((id) => productCard(byId.get(id))).filter(Boolean);
}

export async function get(actor, id) {
  guard(actor);
  const l = await load(id);
  const [account, product, duplicates] = await Promise.all([
    repo.findAccount(l.supplierAccount),
    l.productId ? repo.findProduct(l.productId) : null,
    l.status === L.SUBMITTED ? possibleDuplicates(l) : [],
  ]);
  return {
    ...rowOf(l, account?.companyName || ''),
    supplier: account ? { id: idOf(account._id), companyName: account.companyName, status: account.status, city: account.city || '', phone: account.phone } : null,
    description: l.description || '',
    fits: l.fits || '',
    categoryHint: l.categoryHint || '',
    specs: (l.specs || []).map((s) => ({ label: s.label, value: s.value })),
    images: (l.images || []).map((img, index) => ({ index, contentType: img.contentType || '' })),
    dispatchDays: l.dispatchDays,
    availabilityAt: iso(l.availabilityAt),
    reviewNote: l.reviewNote || '',
    reviewedByName: l.reviewedByName || '',
    drivesStock: Boolean(l.drivesStock),
    product: productCard(product),
    duplicates,
    pricing: await pricingView({ costPaise: l.costPaise, gstPct: l.gstPct, categoryIds: product?.categories || [], price: product?.price || null }),
  };
}

export async function getImage(actor, id, index) {
  guard(actor);
  const l = await load(id);
  const img = (l.images || [])[Number(index)];
  if (!Number.isInteger(Number(index)) || !img) throw fail('That photo was not found.', 404);
  const buffer = await readPrivateAsset({ publicId: img.key, provider: 'r2' }, async () => { throw new Error('supplier photos are R2-only'); });
  return { buffer, contentType: img.contentType || 'image/jpeg', name: `photo-${Number(index) + 1}` };
}

/** Pricing preview for the review screen's price box (categories change the margin rule). */
export async function quote(actor, id, input = {}) {
  guard(actor);
  const l = await load(id);
  const categoryIds = (Array.isArray(input.categories) ? input.categories : []).map(String).filter((c) => /^[a-f0-9]{24}$/i.test(c)).slice(0, 10);
  const price = input.price == null || input.price === '' ? null : cleanPrice(input.price);
  return pricingView({ costPaise: l.costPaise, gstPct: l.gstPct, categoryIds, price });
}

function requireRev(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isInteger(n) || n < 0) throw fail('Refresh the listing and review it again (missing version).', 400);
  return n;
}

const changed = () => fail('The supplier changed this listing while you were reviewing it. Refresh to see their latest version.', 409, 'LISTING_CHANGED');

/** After a missed claim: same product already made (a repeat click) → that result; anything else → 409. */
async function afterMissedClaim(id, rev) {
  const now = await load(id);
  if (now.status === L.LIVE && now.productId) return now;
  if (now.status === L.LIVE) throw fail('This listing is being approved right now — refresh in a moment.', 409);
  if (now.status === L.SUBMITTED && now.rev !== rev) throw changed();
  throw fail(`This listing is now "${now.status.replace('_', ' ')}" — refresh to see the latest.`, 409);
}

async function decideStockDriver(listing, productId, wanted, product) {
  if (product?.productType === 'variable') return false; // each model has its own stock
  const other = await repo.findStockDriver(productId, listing._id);
  if (wanted === true && other) throw fail('Another supplier already sets this product\'s stock. Untick "this supplier sets the stock".', 409);
  if (wanted === false) return false;
  return !other;
}

async function supplierFor(listing) {
  const account = await repo.findAccount(listing.supplierAccount);
  if (!account || account.status !== A.APPROVED) {
    throw fail('This supplier\'s account is not approved (it may be suspended) — approve or unsuspend the supplier first.', 409);
  }
  return account;
}

async function result(listing) {
  const product = listing.productId ? await repo.findProduct(listing.productId) : null;
  return { listing: rowOf(listing), product: productCard(product) };
}

/** Approve as a NEW product. */
export async function approveNew(actor, id, input = {}, req) {
  guard(actor);
  const listingId = requireId(id, 'listing');
  const rev = requireRev(input.rev);
  const before = await load(listingId);
  if (before.status === L.LIVE && before.productId) return { ...(await result(before)), created: false };
  if (before.status !== L.SUBMITTED) return { ...(await result(await afterMissedClaim(listingId, rev))), created: false };
  if (before.rev !== rev) throw changed();

  const account = await supplierFor(before);
  const fields = await cleanProductForm(input.product);
  const price = cleanPrice(input.price);
  const decision = await priceDecision({
    costPaise: before.costPaise, gstPct: before.gstPct, price, categoryIds: fields.categories,
    override: input.override === true, overrideReason: input.overrideReason,
  });
  const isActive = input.keepHidden !== true;
  const wantIdx = Array.isArray(input.imageIndexes) ? input.imageIndexes.map(Number) : (before.images || []).map((_, i) => i);
  const images = [...new Set(wantIdx)].filter((i) => Number.isInteger(i) && before.images?.[i]).map((i) => before.images[i]);

  // 1. Claim.
  const claimed = await repo.casListing(listingId, { statuses: [L.SUBMITTED], rev }, {
    status: L.LIVE, productId: null, ...stamp(actor),
    reviewNote: decision.belowFloor ? `Sold below floor: ${decision.overrideReason}` : '',
  });
  if (!claimed) return { ...(await result(await afterMissedClaim(listingId, rev))), created: false };

  // 2. Photos + product. 3. Link. Any failure → back to submitted.
  let copied = [];
  let product = null;
  try {
    copied = await copyListingImages(images, fields.name);
    // A brand-new product has no other supplier, so this one sets its stock unless told not to.
    const drivesStock = input.drivesStock !== false;
    product = await createProduct({
      ...fields, price, isActive, stock: drivesStock ? before.availability : 'in',
    }, copied);
    const live = await repo.casListing(listingId, { statuses: [L.LIVE] }, {
      productId: product._id, supplierId: account.supplierId, drivesStock, liveAt: new Date(), editedSinceLive: false,
    });
    if (!live) throw fail('This listing changed while approving — refresh and try again.', 409);
    auditLogger.logAction(req, 'APPROVE_NEW', 'SupplierListing', listingId, {
      productId: String(product._id), price, marginBp: decision.marginBp, belowFloor: decision.belowFloor, overrideReason: decision.overrideReason, isActive,
    });
    return { ...(await result(live)), created: true };
  } catch (err) {
    await repo.casListing(listingId, { statuses: [L.LIVE] }, { status: L.SUBMITTED, productId: null, reviewedAt: null, reviewedBy: null, reviewedByName: '', reviewNote: '' });
    // A failure after the product exists hides it (its photos stay with it); before that, the copies go.
    if (product) {
      await repo.setProductFields(product._id, { isActive: false });
      console.error(`[CLEANUP_REQUIRED] partner approval failed after creating product ${product._id}; it was hidden`);
    } else if (copied.length) {
      await deleteHostedImages(copied.map((i) => ({ url: i.url, public_id: i.public_id })));
    }
    throw err;
  }
}

/** Approve by linking to an EXISTING product (optionally setting its price). */
export async function approveLink(actor, id, input = {}, req) {
  guard(actor);
  const listingId = requireId(id, 'listing');
  const rev = requireRev(input.rev);
  const productId = requireId(input.productId, 'product');
  const before = await load(listingId);
  if (before.status === L.LIVE && before.productId) {
    if (String(before.productId) !== productId) throw fail('This listing is already live on a different product.', 409);
    return { ...(await result(before)), created: false };
  }
  if (before.status !== L.SUBMITTED) return { ...(await result(await afterMissedClaim(listingId, rev))), created: false };
  if (before.rev !== rev) throw changed();

  const account = await supplierFor(before);
  const product = await repo.findProduct(productId);
  if (!product) throw fail('That product was not found.', 404);
  const already = await repo.findLiveListingForProduct(productId, before.supplierAccount);
  if (already && String(already._id) !== listingId) throw fail('This supplier already has another listing on that product.', 409);

  const newPrice = input.setPrice === true ? cleanPrice(input.price) : null;
  // The price customers will pay after this — checked against cost even when unchanged.
  const decision = await priceDecision({
    costPaise: before.costPaise, gstPct: before.gstPct, price: newPrice ?? product.price, categoryIds: product.categories || [],
    override: input.override === true, overrideReason: input.overrideReason,
  });
  const drivesStock = await decideStockDriver(before, productId, input.drivesStock, product);

  const claimed = await repo.casListing(listingId, { statuses: [L.SUBMITTED], rev }, {
    status: L.LIVE, productId: null, ...stamp(actor),
    reviewNote: decision.belowFloor ? `Sold below floor: ${decision.overrideReason}` : '',
  });
  if (!claimed) return { ...(await result(await afterMissedClaim(listingId, rev))), created: false };

  try {
    const live = await repo.casListing(listingId, { statuses: [L.LIVE] }, {
      productId: product._id, supplierId: account.supplierId, drivesStock, liveAt: new Date(), editedSinceLive: false,
    });
    if (!live) throw fail('This listing changed while approving — refresh and try again.', 409);
    await updateProduct(product, { price: newPrice, stock: drivesStock ? before.availability : null });
    auditLogger.logAction(req, 'APPROVE_LINK', 'SupplierListing', listingId, {
      productId, price: newPrice, marginBp: decision.marginBp, belowFloor: decision.belowFloor, overrideReason: decision.overrideReason, drivesStock,
    });
    return { ...(await result(live)), created: false };
  } catch (err) {
    await repo.casListing(listingId, { statuses: [L.LIVE] }, { status: L.SUBMITTED, productId: null, drivesStock: false, reviewedAt: null, reviewedBy: null, reviewedByName: '', reviewNote: '' });
    if (err?.code === 11000) throw fail('This supplier already has another listing on that product.', 409);
    throw err;
  }
}

async function move(actor, id, { from, to, note, action }, req) {
  guard(actor);
  const listingId = requireId(id, 'listing');
  const done = await repo.casListing(listingId, { statuses: from }, { status: to, reviewNote: note, ...stamp(actor) });
  if (!done) {
    const now = await load(listingId);
    if (now.status === to) return rowOf(now);
    throw fail(`This listing is now "${now.status.replace('_', ' ')}" — refresh to see the latest.`, 409);
  }
  auditLogger.logAction(req, action, 'SupplierListing', listingId, { to });
  return rowOf(done);
}

export const requestChanges = (actor, id, input = {}, req) => move(actor, id, {
  from: [L.SUBMITTED], to: L.CHANGES_REQUESTED, note: requireNote(input.note), action: 'REQUEST_CHANGES',
}, req);

export const reject = (actor, id, input = {}, req) => move(actor, id, {
  from: [L.SUBMITTED, L.CHANGES_REQUESTED], to: L.REJECTED, note: requireNote(input.note, 'Give the reason'), action: 'REJECT',
}, req);

export default { list, get, getImage, quote, approveNew, approveLink, requestChanges, reject };
