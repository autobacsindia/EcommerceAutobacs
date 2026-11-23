/**
 * Employee documents (models/hr/EmployeeDocument.js): PAN card, offer letter…
 *
 *   - bytes go ONLY to the private bucket (config/storage.js), under
 *     hr/employees/<employeeId>/documents/; there is no public fallback — when
 *     private storage isn't configured, upload is refused (503) instead of
 *     quietly publishing identity papers.
 *   - the declared type must be on the allowlist AND the bytes must match it
 *     (a renamed .exe is refused); size ≤ HR_DOCUMENT_MAX_BYTES.
 *   - every read is a presigned GET valid for 5 minutes, minted per request
 *     after the access check; nothing permanent is ever stored or returned.
 *   - delete is soft (deletedAt/deletedBy) and audited; the object is kept so
 *     "who removed this and what was it" stays answerable.
 *
 * Access (middleware/hrAuth.js scope `documents`): self, HR, admin. Team heads
 * see none. Not allowed = 404, the same as a document that doesn't exist.
 */
import crypto from 'crypto';
import multer from 'multer';
import AppError from '../../../utils/AppError.js';
import documentRepository from '../../../repositories/hr/documentRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { canAccessEmployee, isHrOrAdmin } from '../../../middleware/hrAuth.js';
import { EMPLOYEE_DOCUMENT_KINDS } from '../../../config/hr.js';
import { storageProvider } from '../../../config/storage.js';
import { putPrivateAsset, deletePrivateAsset } from '../../storage/privateUploads.js';
import { r2PrivateUrl } from '../../storage/privateAssetUrl.js';
import { attachmentType, safeName } from '../../chatAttachmentService.js';
import { encodeCursor, decodeCursor, afterClause, sortSpec } from '../../../utils/listQuery.js';
import { recordHrAudit } from '../audit.js';
import {
  fail, isId, inTransaction, pageSize,
} from '../leave/common.js';

export const HR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_DOCUMENT_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const HR_DOCUMENT_URL_TTL_SECONDS = 300;
const NEWEST = Object.freeze({ field: 'createdAt', dir: -1, type: 'date' });
const LIST_SELECT = 'employee kind fileName mimeType sizeBytes note uploadedBy createdAt';

const notFound = () => fail('Document not found', 404);
export const documentFolder = (employeeId) => `hr/employees/${employeeId}/documents`;

/** multer: one file on field `file`, in memory, capped (+1: busboy treats reaching the limit as over). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HR_DOCUMENT_MAX_BYTES + 1, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(file.mimetype || '').toLowerCase();
    file.mimetype = mime;
    if (!HR_DOCUMENT_TYPES.includes(mime)) {
      return cb(new AppError('Upload a PDF or a photo (JPG, PNG, WebP).', 400, { expose: true }), false);
    }
    return cb(null, true);
  },
});

/** Express middleware: parse the upload and turn multer's errors into clean 400s. */
export function uploadHrDocument(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `That file is too big. Documents can be up to ${HR_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.`
        : 'That upload could not be read. Send one file on the "file" field.';
      return res.status(400).json({ success: false, message });
    }
    return next(err);
  });
}

export const shapeDocument = (d) => ({
  id: String(d._id),
  employee: String(d.employee),
  kind: d.kind,
  fileName: d.fileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  note: d.note || '',
  uploadedBy: d.uploadedBy ? String(d.uploadedBy) : null,
  createdAt: d.createdAt,
});

/** Store one file for `employee` (access already checked by the route). */
export async function uploadDocument(actor, employee, file, { kind, note } = {}, req = null) {
  if (!file?.buffer?.length) throw fail('Attach a file on the "file" field', 400);
  if (!EMPLOYEE_DOCUMENT_KINDS.includes(kind)) throw fail(`kind must be one of ${EMPLOYEE_DOCUMENT_KINDS.join(', ')}`, 400);
  if (file.size > HR_DOCUMENT_MAX_BYTES) throw fail('That file is too big. Documents can be up to 10 MB.', 400);
  const type = attachmentType(file.mimetype);
  if (!type || !HR_DOCUMENT_TYPES.includes(file.mimetype) || !type.verify(file.buffer)) {
    throw fail(`"${String(file.originalname || 'file').slice(0, 80)}" does not look like a real ${type?.ext?.toUpperCase() || 'PDF or photo'} file`, 400);
  }
  if (employee.status === 'exited' && !isHrOrAdmin(actor)) throw notFound();
  if (storageProvider() !== 'r2') {
    throw fail('Private file storage is not set up here, so documents can’t be uploaded.', 503);
  }

  const fileName = safeName(file.originalname, type.ext);
  const basename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
  const stored = await putPrivateAsset({
    buffer: file.buffer, folder: documentFolder(employee._id), basename, contentType: file.mimetype,
  });
  try {
    const row = await inTransaction(async (session) => {
      const created = await documentRepository.create({
        employee: employee._id,
        kind,
        fileName,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        storageKey: stored.publicId,
        note: String(note ?? '').trim().slice(0, 300),
        uploadedBy: actor._id,
      }, session);
      await recordHrAudit({
        action: 'document.uploaded', entity: 'EmployeeDocument', entityId: created._id, subject: employee._id, actor, req, session,
        changes: [{ field: 'document', from: null, to: `${kind}: ${fileName}` }],
      });
      return created;
    });
    return shapeDocument(row);
  } catch (err) {
    // The row didn't commit: don't leave an orphaned identity document in the bucket.
    await deletePrivateAsset({ publicId: stored.publicId, provider: 'r2' });
    throw err;
  }
}

/** One employee's live documents, newest first (keyset). */
export async function listDocuments(employeeId, { cursor, limit } = {}) {
  const lim = pageSize(limit);
  const base = { employee: employeeId, deletedAt: null };
  const ac = afterClause(NEWEST, cursor ? decodeCursor('newest', NEWEST, cursor) : null);
  const rows = await documentRepository.page(ac ? { $and: [base, ac] } : base, { sort: sortSpec(NEWEST), limit: lim + 1, select: LIST_SELECT });
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  return { items: items.map(shapeDocument), nextCursor: hasMore ? encodeCursor('newest', NEWEST, items[items.length - 1]) : null };
}

/** Load a live document the caller may see (scope `documents`), else 404. */
async function loadVisible(actor, docId) {
  if (!isId(docId)) throw notFound();
  const doc = await documentRepository.findLive(docId);
  if (!doc) throw notFound();
  const employee = await employeeRepository.findById(doc.employee);
  if (!employee || !canAccessEmployee(actor, employee, 'documents')) throw notFound();
  return { doc, employee };
}

/** A 5-minute presigned GET for one document. */
export async function documentUrl(actor, docId) {
  const { doc } = await loadVisible(actor, docId);
  const url = await r2PrivateUrl({
    key: doc.storageKey, ttlSeconds: HR_DOCUMENT_URL_TTL_SECONDS, downloadAs: doc.fileName, contentType: doc.mimeType,
  });
  if (!url) throw fail('This document can’t be opened right now', 503);
  return { url, expiresInSeconds: HR_DOCUMENT_URL_TTL_SECONDS, fileName: doc.fileName, mimeType: doc.mimeType };
}

/** Soft delete (HR/admin; the route checks the role). A second delete is a 404. */
export async function deleteDocument(actor, docId, { reason = '', req = null } = {}) {
  const { doc } = await loadVisible(actor, docId);
  const row = await inTransaction(async (session) => {
    const updated = await documentRepository.softDelete(doc._id, actor._id, new Date(), session);
    if (!updated) throw notFound();
    await recordHrAudit({
      action: 'document.deleted', entity: 'EmployeeDocument', entityId: doc._id, subject: doc.employee, actor, req, session,
      reason: String(reason ?? '').slice(0, 500),
      changes: [{ field: 'document', from: `${doc.kind}: ${doc.fileName}`, to: null }],
    });
    return updated;
  });
  return { id: String(row._id), deletedAt: row.deletedAt };
}
