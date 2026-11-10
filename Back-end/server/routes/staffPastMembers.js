import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  validatePastMemberList, validatePastMemberId, validatePastMemberPage,
  validatePastMemberNoteCreate, validatePastMemberNoteUpdate, validatePastMemberNoteId,
} from '../validators/staffPastMember.validator.js';
import { listNotes, addNote, editNote, deleteNote } from '../services/staffPastMemberNoteService.js';
import { listPastMembers, getPastMember, listPastMemberTasks, listPastMemberOrders } from '../services/staffPastMemberService.js';

/** Past team members and their work history (/api/v1/staff/past-members). Mounted after routes/staff.js's signed-in gate. */
const router = express.Router();
const v = (...chains) => [...chains.flat(), validateRequest];
// Per-person staff history: never kept by a browser or shared cache.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', v(validatePastMemberList), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMembers(req.user, req.query)) });
}));
router.get('/:userId', v(validatePastMemberId), asyncHandler(async (req, res) => {
  res.json({ success: true, member: await getPastMember(req.user, req.params.userId) });
}));
router.get('/:userId/tasks', v(validatePastMemberPage), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMemberTasks(req.user, req.params.userId, req.query)) });
}));
router.get('/:userId/orders', v(validatePastMemberPage), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMemberOrders(req.user, req.params.userId, req.query)) });
}));

// Notes by the team head and admins.
router.get('/:userId/notes', v(validatePastMemberPage), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listNotes(req.user, req.params.userId, req.query)) });
}));
router.post('/:userId/notes', v(validatePastMemberNoteCreate), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, note: await addNote(req.user, req.params.userId, req.body, req) });
}));
router.patch('/:userId/notes/:noteId', v(validatePastMemberNoteUpdate), asyncHandler(async (req, res) => {
  res.json({ success: true, note: await editNote(req.user, req.params.userId, req.params.noteId, req.body, req) });
}));
router.delete('/:userId/notes/:noteId', v(validatePastMemberNoteId), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteNote(req.user, req.params.userId, req.params.noteId, req)) });
}));

export default router;
