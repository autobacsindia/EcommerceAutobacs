/**
 * A supplier's own listings. Every read and write is scoped by
 * `supplierAccount: ownerId` in the repository filter — another supplier's id is
 * simply "not found" (404), never 403, so ids cannot be probed.
 *
 * Bodies are allow-lists (validate.js): a selling price, productId, status, rev
 * bump, drivesStock… cannot be sent. The supplier sets only their own words,
 * photos, COST (ex-GST, whole paise), GST rate, availability and dispatch days.
 *
 * Every content edit bumps `rev` with a compare-and-set, so procurement's approval
 * (which names the rev it reviewed) can never approve an edit it did not see.
 */
import listings, { LISTING_STATUS as L } from '../../repositories/supplierListingRepository.js';
import { toSupplierListingView } from '../../utils/supplierPortalView.js';
import {
  SUPPLIER_AVAILABILITY, GST_RATES, MAX_LISTING_IMAGES, MAX_COST_PAISE,
} from '../../config/supplierPortal.js';
import { fail, notFound } from './errors.js';
import { onlyKeys, str, int, oneOf, isPlainObject } from './validate.js';
import { storeFiles, removeFiles, signedUrlMap } from './uploads.js';
import { syncPriceReview, supersedePriceReview, pushStock } from './liveSync.js';

export const PAGE_MAX = 50;
export const PAGE_DEFAULT = 20;
export const EDITABLE = Object.freeze([L.DRAFT, L.SUBMITTED, L.CHANGES_REQUESTED, L.LIVE]);
export const SUBMITTABLE = Object.freeze([L.DRAFT, L.CHANGES_REQUESTED]);
export const WITHDRAWABLE = Object.freeze([L.DRAFT, L.SUBMITTED, L.CHANGES_REQUESTED, L.LIVE]);
const CAS_TRIES = 4;

const CONTENT_FIELDS = ['title', 'brand', 'partNumber', 'description', 'fits', 'categoryHint', 'specs'];
const LISTING_FIELDS = [...CONTENT_FIELDS, 'costPaise', 'gstPct', 'availability', 'dispatchDays'];

const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));

// ── views ────────────────────────────────────────────────────────────────────

/** `coverOnly`: list rows carry a URL for the first photo only (others: url null). */
export async function viewsOf(rows, { coverOnly = false } = {}) {
  const urls = await signedUrlMap(rows, { coverOnly });
  const imageUrl = (key) => urls.get(key) ?? null;
  return rows.map((l) => toSupplierListingView(l, { imageUrl }));
}
const viewOf = async (row) => (await viewsOf([row]))[0];

// ── cursor ───────────────────────────────────────────────────────────────────

export const encodeCursor = (row) => Buffer.from(JSON.stringify({ u: new Date(row.updatedAt).toISOString(), i: String(row._id) })).toString('base64url');

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const { u, i } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const updatedAt = new Date(u);
    if (Number.isNaN(updatedAt.getTime()) || !isId(i)) throw new Error('bad');
    return { updatedAt, id: i };
  } catch {
    throw fail(400, 'BAD_CURSOR', 'That page link is not valid. Reload the list.');
  }
}

// ── input ────────────────────────────────────────────────────────────────────

function specsOf(value) {
  if (!Array.isArray(value) || value.length > 30) throw fail(400, 'INVALID_FIELD', 'Specs must be a list of up to 30 rows.', { field: 'specs' });
  return value.map((s) => {
    if (!isPlainObject(s)) throw fail(400, 'INVALID_FIELD', 'Each spec needs a label and a value.', { field: 'specs' });
    onlyKeys(s, ['label', 'value'], 'specs');
    return { label: str(s.label, 'Spec label', { min: 1, max: 60 }), value: str(s.value, 'Spec value', { min: 1, max: 200 }) };
  });
}

/** Parse the allowed listing fields present in `body`. Pure. */
export function listingFields(body, { requireAll = false } = {}) {
  const out = {};
  const has = (k) => k in body;
  if (requireAll || has('title')) out.title = str(body.title, 'Title', { min: 3, max: 200 });
  if (has('brand')) out.brand = str(body.brand, 'Brand', { max: 80 });
  if (has('partNumber')) out.partNumber = str(body.partNumber, 'Part number', { max: 80 });
  if (has('description')) out.description = str(body.description, 'Description', { max: 4000 });
  if (has('fits')) out.fits = str(body.fits, 'Fits', { max: 500 });
  if (has('categoryHint')) out.categoryHint = str(body.categoryHint, 'Category', { max: 80 });
  if (has('specs')) out.specs = specsOf(body.specs);
  // Cost is the supplier's own number: whole paise, ex-GST. Never a selling price.
  if (requireAll || has('costPaise')) out.costPaise = int(body.costPaise, 'Cost (paise, without GST)', { min: 1, max: MAX_COST_PAISE });
  if (requireAll || has('gstPct')) out.gstPct = oneOf(body.gstPct, 'GST %', GST_RATES);
  if (has('availability')) out.availability = oneOf(body.availability, 'Availability', SUPPLIER_AVAILABILITY);
  if (has('dispatchDays')) out.dispatchDays = int(body.dispatchDays, 'Dispatch days', { min: 0, max: 60 });
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ── reads ────────────────────────────────────────────────────────────────────

export async function list(ownerId, { cursor, status, limit } = {}) {
  let size = PAGE_DEFAULT;
  if (limit !== undefined && limit !== '') {
    size = Number(limit);
    if (!Number.isInteger(size) || size < 1 || size > PAGE_MAX) throw fail(400, 'INVALID_FIELD', `limit must be 1 to ${PAGE_MAX}.`, { field: 'limit' });
  }
  if (status !== undefined && status !== '') oneOf(status, 'status', Object.values(L));
  const after = decodeCursor(cursor);
  const rows = await listings.listOwned(ownerId, { status: status || null, after, limit: size + 1 });
  const page = rows.slice(0, size);
  return {
    listings: await viewsOf(page, { coverOnly: true }),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]) : null,
  };
}

async function loadOwned(ownerId, id) {
  if (!isId(id)) throw notFound();
  const row = await listings.findOwned(ownerId, id);
  if (!row) throw notFound();
  return row;
}

export const get = async (ownerId, id) => viewOf(await loadOwned(ownerId, id));

// ── writes ───────────────────────────────────────────────────────────────────

export async function create(supplier, body) {
  onlyKeys(body, LISTING_FIELDS);
  const fields = listingFields(body, { requireAll: true });
  const row = await listings.create({
    ...fields,
    supplierAccount: supplier._id,
    supplierId: supplier.supplierId || null,
    status: L.DRAFT,
    rev: 0,
    availabilityAt: new Date(),
  });
  return viewOf(row.toObject());
}

const lockedListing = (status) => fail(409, 'LISTING_LOCKED', status === L.WITHDRAWN
  ? 'This product was withdrawn. Add it again as a new product.'
  : 'This product can no longer be changed.', { status });

/**
 * Edit fields. Optional `rev` in the body = "I edited the version with this rev":
 * a stale editor gets 409 STALE instead of overwriting someone else's change.
 */
export async function update(ownerId, id, body) {
  onlyKeys(body, [...LISTING_FIELDS, 'rev']);
  const fields = listingFields(body);
  const expectedRev = body.rev === undefined ? null : int(body.rev, 'rev', { min: 0, max: Number.MAX_SAFE_INTEGER });

  let before;
  let after;
  for (let i = 0; i < CAS_TRIES && !after; i += 1) {
     
    before = await loadOwned(ownerId, id);
    if (!EDITABLE.includes(before.status)) throw lockedListing(before.status);
    if (expectedRev !== null && expectedRev !== before.rev) {
      throw fail(409, 'STALE', 'This product was changed elsewhere. Reload it and try again.', { rev: before.rev });
    }
    const $set = {};
    for (const [k, v] of Object.entries(fields)) if (!same(before[k], v)) $set[k] = v;
    if (!Object.keys($set).length) {
      after = before; // nothing changed: no rev bump, no side effects beyond the stock re-push below
      break;
    }
    const now = new Date();
    if ('costPaise' in $set || 'gstPct' in $set) $set.costChangedAt = now;
    if ('availability' in $set) $set.availabilityAt = now;
    if (before.status === L.LIVE && CONTENT_FIELDS.some((k) => k in $set)) $set.editedSinceLive = true;
     
    after = await listings.updateOwned(ownerId, id, { rev: before.rev, status: before.status }, { $set, $inc: { rev: 1 } });
  }
  if (!after) throw fail(409, 'BUSY', 'This product is being changed elsewhere. Please try again.');

  if (after.status === L.LIVE && after.productId) {
    const costMoved = after !== before && (after.costPaise !== before.costPaise || after.gstPct !== before.gstPct);
    if (costMoved) {
      try {
        await syncPriceReview(ownerId, id, before.costPaise);
      } catch (err) {
        // Compensate: a cost change without its price review would hide the change
        // from procurement. Put the old cost back (CAS) and ask the supplier to retry.
        console.error(`[PARTNER_PRICE_REVIEW_FAILED] listing ${id}: ${err.message}`);
        await listings.updateOwned(ownerId, id, { rev: after.rev }, {
          $set: { costPaise: before.costPaise, gstPct: before.gstPct }, $inc: { rev: 1 },
        }).catch(() => {});
        throw fail(503, 'TRY_AGAIN', 'Your new price could not be saved just now. Please try again.');
      }
    }
    if ('availability' in fields) await pushOrFail(after);
  }
  return viewOf(after);
}

async function pushOrFail(listing, availability) {
  try {
    await pushStock(listing, availability);
  } catch (err) {
    console.error(`[PARTNER_STOCK_PUSH_FAILED] listing ${listing._id}: ${err.message}`);
    // Saved on the listing; the push is idempotent, so sending the same value again fixes it.
    throw fail(503, 'STOCK_SYNC_FAILED', 'Saved, but the website stock did not update yet. Please send it again.');
  }
}

export async function setAvailability(ownerId, id, body) {
  onlyKeys(body, ['availability']);
  const availability = oneOf(body.availability, 'Availability', SUPPLIER_AVAILABILITY);
  const before = await loadOwned(ownerId, id);
  if (!EDITABLE.includes(before.status)) throw lockedListing(before.status);
  // Not a content edit: no rev bump, so a stock toggle never invalidates a pending approval.
  let row = before;
  if (before.availability !== availability) {
    row = await listings.updateOwned(ownerId, id, { status: { $in: EDITABLE } }, { $set: { availability, availabilityAt: new Date() } });
    if (!row) throw lockedListing(L.WITHDRAWN);
  }
  if (row.status === L.LIVE) await pushOrFail(row, availability);
  return viewOf(row);
}

export async function submit(ownerId, id) {
  const before = await loadOwned(ownerId, id);
  if (before.status === L.SUBMITTED) return viewOf(before); // double tap
  if (!SUBMITTABLE.includes(before.status)) throw lockedListing(before.status);
  if (!(before.images || []).length) throw fail(400, 'INCOMPLETE', 'Add at least one photo before sending.', { missing: ['images'] });
  const row = await listings.updateOwned(ownerId, id, { status: { $in: SUBMITTABLE } }, { $set: { status: L.SUBMITTED, submittedAt: new Date() } });
  return viewOf(row || await loadOwned(ownerId, id));
}

export async function withdraw(ownerId, id) {
  const before = await loadOwned(ownerId, id);
  let row = before;
  if (before.status !== L.WITHDRAWN) {
    if (!WITHDRAWABLE.includes(before.status)) throw lockedListing(before.status);
    row = await listings.updateOwned(ownerId, id, { status: before.status }, {
      $set: { status: L.WITHDRAWN, availability: 'out', availabilityAt: new Date() }, $inc: { rev: 1 },
    });
    if (!row) throw fail(409, 'BUSY', 'This product is being changed elsewhere. Please try again.');
    if (before.status === L.LIVE) await supersedePriceReview(before._id);
  }
  // Idempotent: a withdrawn live product is pushed to 'out' every time, so a retry
  // after a failed push finishes the job.
  if (row.productId) await pushOrFail(row, 'out');
  return viewOf(row);
}

// ── photos ───────────────────────────────────────────────────────────────────

export async function addPhotos(ownerId, id, files) {
  const before = await loadOwned(ownerId, id);
  if (!EDITABLE.includes(before.status)) throw lockedListing(before.status);
  const have = (before.images || []).length;
  const room = MAX_LISTING_IMAGES - have;
  const list = (files || []).filter((f) => f?.buffer?.length);
  if (!list.length) throw fail(400, 'NO_FILE', 'Choose a photo to upload.');
  if (list.length > room) {
    throw fail(400, 'TOO_MANY_PHOTOS', room > 0
      ? `A product can have ${MAX_LISTING_IMAGES} photos — you can add ${room} more.`
      : `This product already has ${MAX_LISTING_IMAGES} photos.`, { max: MAX_LISTING_IMAGES });
  }
  const stored = await storeFiles(list, {
    folder: `listings/${ownerId}/${id}`, prefix: 'photo', allowPdf: false, max: MAX_LISTING_IMAGES, noun: 'photo',
  });
  const $set = before.status === L.LIVE ? { editedSinceLive: true } : {};
  // "Room for n more": the (MAX - n)th photo must not exist yet — holds under parallel uploads.
  const row = await listings.updateOwned(
    ownerId, id,
    { status: { $in: EDITABLE }, [`images.${MAX_LISTING_IMAGES - stored.length}`]: { $exists: false } },
    { $push: { images: { $each: stored } }, $inc: { rev: 1 }, ...(Object.keys($set).length ? { $set } : {}) },
  );
  if (!row) {
    await removeFiles(stored);
    throw fail(409, 'TOO_MANY_PHOTOS', `This product already has ${MAX_LISTING_IMAGES} photos — reload to see them.`);
  }
  return viewOf(row);
}

export async function removePhoto(ownerId, id, photoId) {
  const before = await loadOwned(ownerId, id);
  if (!EDITABLE.includes(before.status)) throw lockedListing(before.status);
  const photo = (before.images || []).find((img) => img.key.split('/').pop() === String(photoId));
  if (!photo) throw notFound();
  const $set = before.status === L.LIVE ? { editedSinceLive: true } : {};
  const row = await listings.updateOwned(
    ownerId, id,
    { status: { $in: EDITABLE }, 'images.key': photo.key },
    { $pull: { images: { key: photo.key } }, $inc: { rev: 1 }, ...(Object.keys($set).length ? { $set } : {}) },
  );
  if (!row) throw notFound();
  await removeFiles([photo]);
  return viewOf(row);
}
