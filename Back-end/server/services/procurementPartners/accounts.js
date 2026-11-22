/**
 * Supplier accounts (Autobacs Partner sign-ups) — procurement's queue and decisions.
 *
 *   approve          in_review → approved, linked to a procurement `Supplier`
 *                    (an existing one, or a new one made from the sign-up)
 *   request-changes  in_review → changes_requested (note shown to the supplier)
 *   reject           in_review | changes_requested → rejected (note; signs them out)
 *   suspend          approved → suspended (signs them out)
 *   unsuspend        suspended → approved (signs them out, so the app reloads its status)
 *
 * Every move is compare-and-set on the status read, so a double-click or two
 * reviewers at once give ONE decision: the repeat of the same decision answers
 * with the record as it stands; a different decision gets 409.
 *
 * Approval is CAS-first: the account is claimed (status → approved) before the
 * Supplier is created/linked, and put back to in_review if that step fails. So a
 * double-approve can never create two Supplier records, and a failed link never
 * leaves a half-approved account. Bank details reach the Supplier only through
 * services/supplierService.js, whose model setter encrypts the account number and
 * whose update stamps `bankChangedAt` when the destination changes (the warning
 * accounts sees on the next payment).
 */
import auditLogger from '../auditLogger.js';
import repo, { SUPPLIER_ACCOUNT_STATUS as S } from '../../repositories/supplierPartnerAdminRepository.js';
import * as supplierService from '../supplierService.js';
import { keysetPage } from '../../utils/listQuery.js';
import { decryptField } from '../../utils/fieldEncryption.js';
import { readPrivateAsset } from '../storage/privateUploads.js';
import { PAGE_SIZE, fail, guard, idOf, iso, requireId, requireNote, stamp, text } from './shared.js';

export const ACCOUNT_LIST_STATUSES = Object.freeze([S.IN_REVIEW, S.CHANGES_REQUESTED, S.APPROVED, S.SUSPENDED, S.REJECTED]);
const SORTS = Object.freeze({
  oldest: { field: 'submittedAt', dir: 1, type: 'date' },
  newest: { field: 'submittedAt', dir: -1, type: 'date' },
});
export const DOC_KINDS = Object.freeze({ 'gst-certificate': 'gstCertificate', 'cancelled-cheque': 'cancelledCheque' });

const plainAccount = (a) => (a?.bank?.accountNumber ? decryptField(a.bank.accountNumber) : '');

function rowOf(a) {
  return {
    id: idOf(a._id),
    companyName: a.companyName,
    contactName: a.contactName,
    email: a.email,
    phone: a.phone,
    city: a.city || '',
    status: a.status,
    submittedAt: iso(a.submittedAt),
    reviewedAt: iso(a.reviewedAt),
    reviewedByName: a.reviewedByName || '',
    supplierId: idOf(a.supplierId),
  };
}

/** Procurement's full view. Never sent to a supplier (they get utils/supplierPortalView.js). */
function detailOf(a) {
  return {
    ...rowOf(a),
    address: a.address || '',
    gstin: a.gstin || '',
    pan: a.pan || '',
    documents: {
      gstCertificate: a.gstCertificate?.key ? { contentType: a.gstCertificate.contentType || '', uploadedAt: iso(a.gstCertificate.uploadedAt) } : null,
      cancelledCheque: a.cancelledCheque?.key ? { contentType: a.cancelledCheque.contentType || '', uploadedAt: iso(a.cancelledCheque.uploadedAt) } : null,
    },
    bank: {
      accountName: a.bank?.accountName || '',
      accountNumber: plainAccount(a),
      accountLast4: a.bank?.accountLast4 || '',
      ifsc: a.bank?.ifsc || '',
      upiId: a.bank?.upiId || '',
    },
    reviewNote: a.reviewNote || '',
    createdAt: iso(a.createdAt),
  };
}

export async function list(actor, params = {}) {
  guard(actor);
  const status = ACCOUNT_LIST_STATUSES.includes(params.status) ? params.status : S.IN_REVIEW;
  // The waiting queue is first-come-first-served; decided ones show the latest first.
  const sortName = status === S.IN_REVIEW || status === S.CHANGES_REQUESTED ? 'oldest' : 'newest';
  const page = await keysetPage({
    query: { status, submittedAt: { $type: 'date' } },
    sorts: SORTS,
    sortName,
    cursor: params.after,
    pageSize: PAGE_SIZE,
    find: repo.accountPage,
  });
  return { status, items: page.items.map(rowOf), nextCursor: page.nextCursor };
}

async function load(id, opts) {
  const a = await repo.findAccount(requireId(id, 'supplier'), opts);
  if (!a) throw fail('That supplier was not found.', 404);
  return a;
}

export async function get(actor, id) {
  guard(actor);
  const a = await load(id, { bank: true });
  const out = detailOf(a);
  // Suppliers we may already pay — offered first in the "link to existing" picker.
  // Same GSTIN first; failing that, the company name.
  let found = [];
  for (const q of [text(a.gstin, 15), text(a.companyName, 60)].filter(Boolean)) {
    ({ suppliers: found = [] } = await supplierService.list(actor, { q, status: 'active' }));
    if (found.length) break;
  }
  out.possibleSuppliers = found.slice(0, 5).map((s) => ({
    id: s.id, name: s.name, gstin: s.gstin || '', phone: s.phone || '',
    accountMasked: s.payment?.accountMasked || '', ifsc: s.payment?.ifsc || '', upiId: s.payment?.upiId || '',
  }));
  if (a.supplierId) {
    try {
      const s = await supplierService.get(actor, String(a.supplierId));
      out.linkedSupplier = { id: s.id, name: s.name, bankChangedAt: iso(s.bankChangedAt) };
    } catch { out.linkedSupplier = null; }
  }
  return out;
}

/** The private document bytes (GST certificate / cancelled cheque). */
export async function getDocument(actor, id, kind) {
  guard(actor);
  const field = DOC_KINDS[kind];
  if (!field) throw fail('That document was not found.', 404);
  const a = await load(id);
  const doc = a[field];
  if (!doc?.key) throw fail('The supplier has not sent that document.', 404);
  // Supplier documents are written to the private R2 bucket (key = object key).
  const buffer = await readPrivateAsset({ publicId: doc.key, provider: 'r2' }, async () => {
    throw new Error('supplier documents are R2-only');
  });
  const ext = String(doc.contentType || '').includes('pdf') ? 'pdf' : 'jpg';
  return { buffer, contentType: doc.contentType || 'application/octet-stream', name: `${kind}.${ext}` };
}

/** How we pay them, from what they typed in the app. Encryption happens in the Supplier model. */
function paymentFrom(a) {
  const accountNumber = plainAccount(a);
  if (accountNumber && a.bank?.ifsc) {
    return { method: 'bank', accountName: a.bank.accountName || a.companyName, accountNumber, ifsc: a.bank.ifsc };
  }
  if (a.bank?.upiId) return { method: 'upi', upiId: a.bank.upiId };
  return { method: 'none' };
}

/** CAS miss: the same decision again is a no-op; anything else is a conflict. */
async function settle(id, target, extraOk = () => true) {
  const now = await load(id);
  if (now.status === target && extraOk(now)) return now;
  throw fail(`This supplier is now "${now.status.replace('_', ' ')}" — refresh to see the latest.`, 409);
}

export async function approve(actor, id, input = {}, req) {
  guard(actor);
  const mode = input.mode === 'link' ? 'link' : input.mode === 'new' ? 'new' : null;
  if (!mode) throw fail('Choose "link to a supplier we already have" or "add as a new supplier".', 400);
  const linkId = mode === 'link' ? requireId(input.supplierId, 'supplier') : null;
  const accountId = requireId(id, 'supplier');

  const before = await load(accountId, { bank: true });
  if (before.status === S.APPROVED) {
    // A retried approve: same decision → the record as it stands.
    if (!before.supplierId || (linkId && String(before.supplierId) !== linkId)) {
      throw fail('This supplier is already approved and linked to another supplier record.', 409);
    }
    return { account: detailOf(before), bankChanged: false, created: false };
  }
  if (before.status !== S.IN_REVIEW) {
    throw fail(`Only a supplier waiting for review can be approved (this one is "${before.status.replace('_', ' ')}").`, 409);
  }

  if (linkId) {
    const other = await repo.findAccountBySupplierId(linkId);
    if (other && String(other._id) !== accountId) {
      throw fail(`That supplier record already has an app login (${other.companyName}).`, 409);
    }
  }

  // 1. Claim the account. A concurrent approve/reject finds nothing to claim.
  const claimed = await repo.casAccount(accountId, [S.IN_REVIEW], { status: S.APPROVED, supplierId: null, reviewNote: '', ...stamp(actor) });
  if (!claimed) {
    const now = await settle(accountId, S.APPROVED, (a) => Boolean(a.supplierId) && (!linkId || String(a.supplierId) === linkId));
    return { account: detailOf(now), bankChanged: false, created: false };
  }

  // 2. Create / link the Supplier. Any failure puts the account back in the queue.
  let supplierId;
  let bankChanged = false;
  try {
    if (mode === 'new') {
      const s = await supplierService.create(actor, {
        name: before.companyName,
        contactPerson: before.contactName,
        phone: before.phone,
        email: before.email,
        gstin: before.gstin,
        address: [before.address, before.city].filter(Boolean).join(', '),
        notes: 'Joined through the Autobacs Partner app.',
        payment: paymentFrom(before),
      }, req);
      supplierId = s.id;
    } else {
      const s = await supplierService.get(actor, linkId);
      if (!s.active) throw fail(`${s.name} is marked inactive — reactivate it in Suppliers first.`, 409);
      if (input.copyBank === true) {
        const payment = paymentFrom(before);
        if (payment.method === 'none') throw fail('The supplier has not given bank or UPI details to copy.', 400);
        const updated = await supplierService.update(actor, linkId, {
          name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email,
          gstin: s.gstin || before.gstin, address: s.address, notes: s.notes, payment,
        }, req);
        bankChanged = Boolean(updated.bankChangedAt) && String(updated.bankChangedAt) !== String(s.bankChangedAt);
      }
      supplierId = linkId;
    }
    const linked = await repo.casAccount(accountId, [S.APPROVED], { supplierId });
    if (!linked) throw fail('This supplier changed while approving — refresh and try again.', 409);
    auditLogger.logAction(req, 'APPROVE', 'SupplierAccount', accountId, { mode, supplierId, bankChanged });
    return { account: detailOf(await load(accountId, { bank: true })), bankChanged, created: mode === 'new' };
  } catch (err) {
    await repo.casAccount(accountId, [S.APPROVED], { status: S.IN_REVIEW, supplierId: null, reviewedAt: null, reviewedBy: null, reviewedByName: '' });
    if (err?.code === 11000) throw fail('That supplier record already has an app login.', 409);
    throw err;
  }
}

/** One status move with a CAS, idempotent on a repeat. */
async function move(actor, id, { from, to, note = null, bumpSession = false, action }, req) {
  guard(actor);
  const accountId = requireId(id, 'supplier');
  const set = { status: to, ...stamp(actor), ...(note != null ? { reviewNote: note } : {}) };
  const done = await repo.casAccount(accountId, from, set, { bumpSession });
  if (!done) return detailOf(await settle(accountId, to));
  auditLogger.logAction(req, action, 'SupplierAccount', accountId, { to });
  return detailOf(done);
}

export const requestChanges = (actor, id, input = {}, req) => move(actor, id, {
  from: [S.IN_REVIEW], to: S.CHANGES_REQUESTED, note: requireNote(input.note), action: 'REQUEST_CHANGES',
}, req);

export const reject = (actor, id, input = {}, req) => move(actor, id, {
  from: [S.IN_REVIEW, S.CHANGES_REQUESTED], to: S.REJECTED, note: requireNote(input.note, 'Give the reason'), bumpSession: true, action: 'REJECT',
}, req);

export const suspend = (actor, id, input = {}, req) => move(actor, id, {
  from: [S.APPROVED], to: S.SUSPENDED, note: requireNote(input.note, 'Give the reason'), bumpSession: true, action: 'SUSPEND',
}, req);

export const unsuspend = (actor, id, _input = {}, req) => move(actor, id, {
  from: [S.SUSPENDED], to: S.APPROVED, note: '', bumpSession: true, action: 'UNSUSPEND',
}, req);

export default { list, get, getDocument, approve, requestChanges, reject, suspend, unsuspend };
