import mongoose from 'mongoose';
import { EMPLOYEE_DOCUMENT_KINDS } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * A file in an employee's private folder (PAN card, offer letter…). The bytes
 * live in the PRIVATE storage bucket (config/storage.js) under `storageKey`;
 * every read is a short-lived presigned URL, never a public link. Soft-deleted
 * so "who removed Priya's PAN on 3 Dec" stays answerable.
 */
const EmployeeDocumentSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  kind: { type: String, enum: EMPLOYEE_DOCUMENT_KINDS, required: true },
  fileName: { type: String, required: true, maxlength: 200 },
  mimeType: { type: String, required: true, maxlength: 100 },
  sizeBytes: { type: Number, required: true, min: 1 },
  storageKey: { type: String, required: true, maxlength: 400 },
  note: { type: String, default: '', maxlength: 300 },
  uploadedBy: { type: ObjectId, ref: 'User', required: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: ObjectId, ref: 'User', default: null },
}, { timestamps: true });

EmployeeDocumentSchema.index({ employee: 1, createdAt: -1, _id: -1 }, { name: 'hr_document_employee_created' });

export default mongoose.models.EmployeeDocument || mongoose.model('EmployeeDocument', EmployeeDocumentSchema);
