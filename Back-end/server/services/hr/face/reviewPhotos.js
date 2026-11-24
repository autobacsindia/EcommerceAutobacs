/**
 * The ONLY stored face images: a punch photo the employee sent for HR review
 * after a failed face check (models/hr/FaceReviewPhoto.js).
 *
 *   - PRIVATE bucket only (R2). Without it, review requests are refused (503)
 *     rather than putting a biometric photo somewhere public-by-default.
 *   - HR reads it through a 5-minute presigned URL minted per view.
 *   - Deleted `faceReviewPhotoDays` after creation by the cleanup cron, object
 *     FIRST and then the row (a row without an object is harmless; an object
 *     without a row would never be found again). Also deleted on exit erasure.
 */
import { storageProvider } from '../../../config/storage.js';
import { putObject, deleteObject } from '../../storage/r2Provider.js';
import { r2PrivateUrl } from '../../storage/privateAssetUrl.js';
import faceRepository from '../../../repositories/hr/faceRepository.js';

const URL_TTL_SECONDS = 5 * 60;
const SWEEP_BATCH = 200;

const r2Store = {
  available: () => storageProvider() === 'r2',
  put: (key, body) => putObject({ body, key, scope: 'private', contentType: 'image/jpeg' }),
  del: (key) => deleteObject({ key, scope: 'private' }),
  url: (key) => r2PrivateUrl({ key, ttlSeconds: URL_TTL_SECONDS, contentType: 'image/jpeg' }),
};
let store = r2Store;

/** Tests: an in-memory store (null restores R2). */
export const setPhotoStore = (s) => { store = s || r2Store; };
export const photoStoreAvailable = () => store.available();

export const photoKey = (employeeId, punchId) => `hr/face-review/${employeeId}/${punchId}.jpg`;

export const putPhoto = (key, buffer) => store.put(key, buffer);
export const deletePhotoObject = (key) => store.del(key);

export async function photoUrlForPunch(punchId) {
  const row = await faceRepository.findPhotoByPunch(punchId);
  if (!row) return null;
  return { url: await store.url(row.storageKey), expiresInSeconds: URL_TTL_SECONDS };
}

/** Delete every review photo of one employee (exit erasure). Returns how many could not be removed. */
export async function deleteEmployeePhotos(employeeId, session = null) {
  const rows = await faceRepository.listPhotosForEmployee(employeeId, session);
  let failed = 0;
  for (const r of rows) {
    if (await store.del(r.storageKey)) await faceRepository.deletePhoto(r._id);
    else failed += 1;
  }
  return { deleted: rows.length - failed, failed };
}

/** Cron: delete expired photos, object first then row. Never throws. */
export async function sweepExpiredPhotos(now = new Date()) {
  let deleted = 0;
  let failed = 0;
  try {
    for (;;) {
      const rows = await faceRepository.listExpiredPhotos(now, SWEEP_BATCH);
      if (!rows.length) break;
      let progressed = false;
      for (const r of rows) {
        if (await store.del(r.storageKey)) {
          await faceRepository.deletePhoto(r._id);
          deleted += 1;
          progressed = true;
        } else failed += 1;
      }
      // Every delete in this batch failed: stop, the next run retries (no hot loop on an outage).
      if (!progressed || rows.length < SWEEP_BATCH) break;
    }
  } catch (err) {
    console.error('[hr-face] review photo sweep failed:', err.message);
  }
  return { deleted, failed };
}
