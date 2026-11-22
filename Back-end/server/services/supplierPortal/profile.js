/**
 * A supplier's own company profile + documents, and sending it for approval.
 *
 * Editable only while `draft` or `changes_requested`: once sent (`in_review`) the
 * documents procurement is checking cannot change under them, and once approved
 * a change goes through procurement (v2), not the app.
 */
import accounts, { SUPPLIER_ACCOUNT_STATUS as S } from '../../repositories/supplierAccountRepository.js';
import { toSupplierAccountView } from '../../utils/supplierPortalView.js';
import { MAX_ATTACHMENT_BYTES, mb } from '../../config/attachments.js';
import { fail } from './errors.js';
import {
  onlyKeys, str, phone as phoneOf, isPlainObject, GSTIN_RE, PAN_RE, IFSC_RE, ACCOUNT_NO_RE, UPI_RE,
} from './validate.js';
import { storeFiles, removeFiles } from './uploads.js';
import { notifyProcurementAccountSubmitted } from './notify.js';

export const EDITABLE_STATUSES = Object.freeze([S.DRAFT, S.CHANGES_REQUESTED]);
export const DOCUMENT_KINDS = Object.freeze(['gstCertificate', 'cancelledCheque']);
export const DOCUMENT_MAX_BYTES = MAX_ATTACHMENT_BYTES;

const PROFILE_KEYS = ['companyName', 'contactName', 'phone', 'city', 'address', 'gstin', 'pan', 'bank'];
const BANK_KEYS = ['accountName', 'accountNumber', 'ifsc', 'upiId'];

const locked = (status) => fail(409, 'PROFILE_LOCKED', status === S.IN_REVIEW
  ? 'Your details are with our team for checking. You can edit them if they ask for changes.'
  : 'Your details cannot be changed from the app now.', { status });

export async function getMe(supplierId) {
  const account = await accounts.findById(supplierId);
  if (!account) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  return toSupplierAccountView(account);
}

const upper = (v, label, max) => str(v, label, { max }).toUpperCase().replace(/\s+/g, '');

/** Build the $set for a profile edit. Pure; throws 400 on bad input. */
export function profileUpdate(body, current) {
  onlyKeys(body, PROFILE_KEYS);
  const $set = {};
  if ('companyName' in body) $set.companyName = str(body.companyName, 'Company name', { min: 2, max: 120 });
  if ('contactName' in body) $set.contactName = str(body.contactName, 'Contact name', { min: 2, max: 120 });
  if ('phone' in body) $set.phone = phoneOf(body.phone);
  if ('city' in body) $set.city = str(body.city, 'City', { max: 80 });
  if ('address' in body) $set.address = str(body.address, 'Address', { max: 500 });
  if ('gstin' in body) {
    const v = upper(body.gstin, 'GSTIN', 20);
    if (v && !GSTIN_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'GSTIN should look like 29ABCDE1234F1Z5.', { field: 'gstin' });
    $set.gstin = v;
  }
  if ('pan' in body) {
    const v = upper(body.pan, 'PAN', 15);
    if (v && !PAN_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'PAN should look like ABCDE1234F.', { field: 'pan' });
    $set.pan = v;
  }
  const gstin = $set.gstin ?? current?.gstin ?? '';
  const pan = $set.pan ?? current?.pan ?? '';
  // A GSTIN carries the PAN in characters 3–12; a mismatch is a typo (or the wrong company).
  if (gstin && pan && gstin.slice(2, 12) !== pan) {
    throw fail(400, 'GSTIN_PAN_MISMATCH', 'The PAN does not match the GSTIN (characters 3 to 12 of the GSTIN are the PAN).');
  }
  if ('bank' in body) {
    if (!isPlainObject(body.bank)) throw fail(400, 'INVALID_FIELD', 'Bank details must be an object.', { field: 'bank' });
    onlyKeys(body.bank, BANK_KEYS, 'bank');
    const b = body.bank;
    if ('accountName' in b) $set['bank.accountName'] = str(b.accountName, 'Account name', { max: 120 });
    if ('accountNumber' in b) {
      const v = str(b.accountNumber, 'Account number', { max: 30 }).replace(/\s+/g, '');
      if (v && !ACCOUNT_NO_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'Account number should be 9 to 18 digits.', { field: 'bank.accountNumber' });
      // The model setter encrypts it; only the last 4 digits are ever shown back.
      $set['bank.accountNumber'] = v;
      $set['bank.accountLast4'] = v.slice(-4);
    }
    if ('ifsc' in b) {
      const v = upper(b.ifsc, 'IFSC', 15);
      if (v && !IFSC_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'IFSC should look like HDFC0001234.', { field: 'bank.ifsc' });
      $set['bank.ifsc'] = v;
    }
    if ('upiId' in b) {
      const v = str(b.upiId, 'UPI ID', { max: 100 });
      if (v && !UPI_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'UPI ID should look like name@bank.', { field: 'bank.upiId' });
      $set['bank.upiId'] = v;
    }
  }
  return $set;
}

export async function updateMe(supplierId, body) {
  const current = await accounts.findById(supplierId);
  if (!current) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (!EDITABLE_STATUSES.includes(current.status)) throw locked(current.status);
  const $set = profileUpdate(body, current);
  if (!Object.keys($set).length) return toSupplierAccountView(current);
  // Status in the filter: a submit racing this edit wins cleanly, never half-applies.
  const saved = await accounts.updateWhere({ _id: supplierId, status: { $in: EDITABLE_STATUSES } }, { $set });
  if (!saved) throw locked(S.IN_REVIEW);
  return toSupplierAccountView(saved);
}

export async function uploadDocument(supplierId, kind, file) {
  if (!DOCUMENT_KINDS.includes(kind)) throw fail(404, 'NOT_FOUND', 'Not found.');
  const current = await accounts.findById(supplierId);
  if (!current) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (!EDITABLE_STATUSES.includes(current.status)) throw locked(current.status);
  const [ref] = await storeFiles(file ? [file] : [], {
    folder: `accounts/${supplierId}`, prefix: kind, allowPdf: true, max: 1, noun: 'file',
  });
  const saved = await accounts.updateWhere(
    { _id: supplierId, status: { $in: EDITABLE_STATUSES } },
    { $set: { [kind]: { ...ref, uploadedAt: new Date() } } },
  );
  if (!saved) {
    await removeFiles([ref]);
    throw locked(S.IN_REVIEW);
  }
  // Replace = the old file goes, AFTER the new one is saved.
  const old = current[kind];
  if (old?.key && old.key !== ref.key) await removeFiles([old]);
  return toSupplierAccountView(saved);
}

/** What is still missing before the account can be sent for checking. */
export function missingForSubmit(a) {
  const missing = [];
  if (!a.gstin) missing.push('gstin');
  if (!a.pan) missing.push('pan');
  if (!a.address) missing.push('address');
  if (!a.city) missing.push('city');
  if (!a.gstCertificate?.key) missing.push('gstCertificate');
  if (!a.cancelledCheque?.key) missing.push('cancelledCheque');
  if (!a.bank?.accountName) missing.push('bank.accountName');
  if (!a.bank?.accountLast4) missing.push('bank.accountNumber');
  if (!a.bank?.ifsc) missing.push('bank.ifsc');
  return missing;
}

export async function submit(supplierId) {
  const current = await accounts.findById(supplierId);
  if (!current) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (current.status === S.IN_REVIEW) return toSupplierAccountView(current); // double tap
  if (!EDITABLE_STATUSES.includes(current.status)) throw locked(current.status);
  const missing = missingForSubmit(current);
  if (missing.length) throw fail(400, 'INCOMPLETE', 'Please fill in everything before sending.', { missing });
  const saved = await accounts.updateWhere(
    { _id: supplierId, status: { $in: EDITABLE_STATUSES } },
    { $set: { status: S.IN_REVIEW, submittedAt: new Date() } },
  );
  if (!saved) return getMe(supplierId); // a parallel submit won; it sends the notice
  notifyProcurementAccountSubmitted(saved);
  return toSupplierAccountView(saved);
}

export const documentLimitText = () => `a photo (JPG, PNG, WebP) or a PDF, up to ${mb(DOCUMENT_MAX_BYTES)}`;
