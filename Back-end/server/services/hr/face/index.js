/**
 * Public surface of the face module for other HR sessions (docs/ADR-hr-system.md §4).
 * Exit calls `eraseFaceData` on settlement / last day.
 */
import faceRepository from '../../../repositories/hr/faceRepository.js';
import { recordHrAudit } from '../audit.js';
import { deleteEmployeePhotos } from './reviewPhotos.js';

export { faceStatus } from './faceService.js';

/**
 * Erase an employee's biometric data: the template is unset and the profile
 * kept only as proof of deletion (status 'deleted', deletedAt, reason); every
 * review photo is removed (object, then row). Joins the caller's transaction
 * for the profile + audit writes. Idempotent.
 */
export async function eraseFaceData(employeeId, reason, session = null) {
  const profile = await faceRepository.findProfile(employeeId, session);
  const photos = await deleteEmployeePhotos(employeeId, session);
  if (!profile || profile.status === 'deleted') return { erased: false, photos };
  const row = await faceRepository.updateIfRev(employeeId, profile.rev, {
    status: 'deleted', deletedAt: new Date(), deletedReason: String(reason || 'exit').slice(0, 200), modelVersion: '',
  }, { unset: { templateEnc: 1 }, session });
  if (!row) throw new Error('Face profile changed during erasure; retry');
  await recordHrAudit({
    action: 'face.erased', entity: 'FaceProfile', entityId: row._id, subject: employeeId, reason: String(reason || ''), session,
    changes: [{ field: 'templateEnc', from: 'set', to: null }],
  });
  return { erased: true, photos };
}
