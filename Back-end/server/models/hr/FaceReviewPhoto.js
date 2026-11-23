import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * The ONE case a punch photo is kept: the face check failed and the employee
 * asked HR to approve the punch. The image is in the PRIVATE bucket under
 * `storageKey`; HR views it through a short-lived presigned URL.
 *
 * Deleted 30 days after creation by a cron job that removes the stored object
 * FIRST and then this row (the job queries `expiresAt`). Deliberately not a TTL
 * index: a TTL would drop the row and orphan the image in the bucket forever.
 */
const FaceReviewPhotoSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  punch: { type: ObjectId, ref: 'AttendancePunch', required: true },
  storageKey: { type: String, required: true, maxlength: 400 },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

FaceReviewPhotoSchema.index({ punch: 1 }, { name: 'hr_face_photo_punch_unique', unique: true });
FaceReviewPhotoSchema.index({ expiresAt: 1 }, { name: 'hr_face_photo_expires' });
FaceReviewPhotoSchema.index({ employee: 1 }, { name: 'hr_face_photo_employee' });

export default mongoose.models.FaceReviewPhoto || mongoose.model('FaceReviewPhoto', FaceReviewPhotoSchema);
