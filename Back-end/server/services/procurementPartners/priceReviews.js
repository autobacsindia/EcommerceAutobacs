/**
 * Price reviews — a supplier changed the cost of a LIVE product. A cost change
 * never moves Product.price by itself; procurement applies a new price or keeps
 * the current one here.
 *
 *   apply  pending → applied, Product.price = decided price (cache purged)
 *   keep   pending → kept, Product.price unchanged
 *
 * Both run the same price rule as approval against the NEW cost: below cost is
 * refused (keeping a price the new cost has overtaken would sell at a loss),
 * below the floor needs an override with a reason. CAS on `pending`, review
 * first then product; a failed product write puts the review back to pending.
 */
import auditLogger from '../auditLogger.js';
import repo, { PRICE_REVIEW_STATUS as P } from '../../repositories/supplierPartnerAdminRepository.js';
import { keysetPage } from '../../utils/listQuery.js';
import { checkPrice } from '../../utils/supplierPricing.js';
import { resolveMarginRule } from '../supplierPortal/marginRules.js';
import { PAGE_SIZE, cleanPrice, fail, guard, idOf, iso, priceDecision, requireId, text } from './shared.js';
import { updateProduct } from './productWrites.js';

const SORTS = Object.freeze({
  oldest: { field: 'createdAt', dir: 1, type: 'date' },
  newest: { field: 'createdAt', dir: -1, type: 'date' },
});
const HISTORY_PAGE = 20;

function rowOf(r, { product, listing, companyName, rule } = {}) {
  const current = product?.price && rule
    ? checkPrice({ costPaise: r.newCostPaise, gstPct: r.gstPct, priceRupees: product.price, floorBp: rule.floorBp })
    : null;
  return {
    id: idOf(r._id),
    status: r.status,
    listingId: idOf(r.listing),
    productId: idOf(r.product),
    productName: product?.name || '',
    productSlug: product?.slug || '',
    listingTitle: listing?.title || '',
    companyName: companyName || '',
    oldCostPaise: r.oldCostPaise,
    newCostPaise: r.newCostPaise,
    gstPct: r.gstPct,
    priceAtRaise: r.priceAtRaise,
    currentPrice: product?.price ?? null,
    suggestedPrice: r.suggestedPrice,
    marginBp: r.marginBp,
    ...(current ? { currentMarginBp: current.marginBp, currentBelowFloor: current.belowFloor, currentBelowCost: current.belowCost } : {}),
    ...(rule ? { floorBp: rule.floorBp } : {}),
    decidedPrice: r.decidedPrice ?? null,
    decidedByName: r.decidedByName || '',
    decidedAt: iso(r.decidedAt),
    note: r.note || '',
    createdAt: iso(r.createdAt),
  };
}

/** Product, listing and company for a page of reviews — three batched reads. */
async function enrich(rows) {
  const productIds = [...new Set(rows.map((r) => String(r.product)))];
  const listingIds = [...new Set(rows.map((r) => String(r.listing)))];
  const accountIds = [...new Set(rows.map((r) => String(r.supplierAccount)))];
  const [products, listings, accounts] = await Promise.all([
    productIds.length ? repo.findProducts(productIds) : [],
    listingIds.length ? repo.findListingsByIds(listingIds) : [],
    accountIds.length ? repo.findAccountsByIds(accountIds) : [],
  ]);
  const p = new Map(products.map((x) => [String(x._id), x]));
  const l = new Map(listings.map((x) => [String(x._id), x]));
  const a = new Map(accounts.map((x) => [String(x._id), x.companyName]));
  // Margin rules: one read per distinct category set (usually one or two per page).
  const rules = new Map();
  for (const prod of products) {
    const key = (prod.categories || []).map(String).join(',');
    if (!rules.has(key)) rules.set(key, await resolveMarginRule(prod.categories || []));
  }
  return rows.map((r) => {
    const product = p.get(String(r.product));
    return rowOf(r, {
      product,
      listing: l.get(String(r.listing)),
      companyName: a.get(String(r.supplierAccount)),
      rule: product ? rules.get((product.categories || []).map(String).join(',')) : null,
    });
  });
}

export async function list(actor, params = {}) {
  guard(actor);
  const status = Object.values(P).includes(params.status) ? params.status : P.PENDING;
  const page = await keysetPage({
    query: { status },
    sorts: SORTS,
    sortName: status === P.PENDING ? 'oldest' : 'newest',
    cursor: params.after,
    pageSize: PAGE_SIZE,
    find: repo.reviewPage,
  });
  return { status, items: await enrich(page.items), nextCursor: page.nextCursor };
}

/** Cost and price history of one product (applied, kept, pending, superseded), newest first. */
export async function history(actor, productId, params = {}) {
  guard(actor);
  const id = requireId(productId, 'product');
  const page = await keysetPage({
    query: { product: id },
    sorts: { newest: SORTS.newest },
    sortName: 'newest',
    cursor: params.after,
    pageSize: HISTORY_PAGE,
    find: repo.reviewPage,
  });
  return { items: await enrich(page.items), nextCursor: page.nextCursor };
}

async function load(id) {
  const r = await repo.findReview(requireId(id, 'price review'));
  if (!r) throw fail('That price review was not found.', 404);
  return r;
}

async function settle(id, target, sameDecision) {
  const now = await load(id);
  if (now.status === target && sameDecision(now)) return now;
  throw fail(`This price review is already "${now.status}" — refresh to see the latest.`, 409);
}

async function productOf(review) {
  const product = await repo.findProduct(review.product);
  if (!product) throw fail('That product no longer exists.', 404);
  return product;
}

export async function apply(actor, id, input = {}, req) {
  guard(actor);
  const reviewId = requireId(id, 'price review');
  const price = cleanPrice(input.price);
  const review = await load(reviewId);
  if (review.status !== P.PENDING) return (await enrich([await settle(reviewId, P.APPLIED, (r) => r.decidedPrice === price)]))[0];
  const product = await productOf(review);
  const decision = await priceDecision({
    costPaise: review.newCostPaise, gstPct: review.gstPct, price, categoryIds: product.categories || [],
    override: input.override === true, overrideReason: input.overrideReason,
  });
  const note = decision.belowFloor ? `Below floor: ${decision.overrideReason}` : text(input.note, 500);
  const done = await repo.casReview(reviewId, P.PENDING, {
    status: P.APPLIED, decidedPrice: price, decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(), note,
  });
  if (!done) return (await enrich([await settle(reviewId, P.APPLIED, (r) => r.decidedPrice === price)]))[0];
  try {
    await updateProduct(product, { price });
  } catch (err) {
    await repo.casReview(reviewId, P.APPLIED, { status: P.PENDING, decidedPrice: null, decidedBy: null, decidedByName: '', decidedAt: null, note: '' });
    throw err;
  }
  auditLogger.logAction(req, 'APPLY_PRICE', 'SupplierPriceReview', reviewId, {
    productId: String(product._id), from: product.price, to: price, marginBp: decision.marginBp, belowFloor: decision.belowFloor,
  });
  return (await enrich([done]))[0];
}

export async function keep(actor, id, input = {}, req) {
  guard(actor);
  const reviewId = requireId(id, 'price review');
  const review = await load(reviewId);
  if (review.status !== P.PENDING) return (await enrich([await settle(reviewId, P.KEPT, () => true)]))[0];
  const product = await productOf(review);
  const decision = await priceDecision({
    costPaise: review.newCostPaise, gstPct: review.gstPct, price: product.price, categoryIds: product.categories || [],
    override: input.override === true, overrideReason: input.overrideReason,
  });
  const note = decision.belowFloor ? `Kept below floor: ${decision.overrideReason}` : text(input.note, 500);
  const done = await repo.casReview(reviewId, P.PENDING, {
    status: P.KEPT, decidedPrice: product.price, decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(), note,
  });
  if (!done) return (await enrich([await settle(reviewId, P.KEPT, () => true)]))[0];
  auditLogger.logAction(req, 'KEEP_PRICE', 'SupplierPriceReview', reviewId, { productId: String(product._id), price: product.price, belowFloor: decision.belowFloor });
  return (await enrich([done]))[0];
}

export default { list, history, apply, keep };
