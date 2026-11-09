import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  validateTrainingId, validatePathList, validateLessonOptions, validatePathCreate, validatePathUpdate,
  validateAssign, validateAssignmentList, validateSubmit, validateMark,
} from '../validators/staffTraining.validator.js';
import {
  trainingMeta, listPaths, lessonOptions, getPath, createPath, updatePath, archivePath, assign, listAssignments,
  getAssignment, startAttempt, submitAttempt, markAttempt, allowRetry, signOff, cancelAssignment,
} from '../services/staffTrainingService.js';

/** Training (/api/v1/staff/training). Mounted after routes/staff.js's signed-in gate. */
const router = express.Router();
const v = (...chains) => [...chains.flat(), validateRequest];
// Holds the test questions and scores: never kept by a browser or proxy.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/meta', (req, res) => res.json({ success: true, ...trainingMeta(req.user) }));
router.get('/lesson-options', v(validateLessonOptions), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await lessonOptions(req.user, req.query.team)) });
}));

router.get('/paths', v(validatePathList), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPaths(req.user, req.query)) });
}));
router.post('/paths', v(validatePathCreate), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, path: await createPath(req.user, req.body, req) });
}));
router.get('/paths/:id', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, path: await getPath(req.user, req.params.id) });
}));
router.patch('/paths/:id', v(validatePathUpdate), asyncHandler(async (req, res) => {
  res.json({ success: true, path: await updatePath(req.user, req.params.id, req.body, req) });
}));
router.delete('/paths/:id', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await archivePath(req.user, req.params.id, req)) });
}));
router.post('/paths/:id/assign', v(validateAssign), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, assignment: await assign(req.user, req.params.id, req.body, req) });
}));

router.get('/assignments', v(validateAssignmentList), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listAssignments(req.user, req.query)) });
}));
router.get('/assignments/:id', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, assignment: await getAssignment(req.user, req.params.id) });
}));
router.post('/assignments/:id/test', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, attempt: await startAttempt(req.user, req.params.id) });
}));
router.post('/assignments/:id/test/submit', v(validateSubmit), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await submitAttempt(req.user, req.params.id, req.body)) });
}));
router.post('/assignments/:id/test/mark', v(validateMark), asyncHandler(async (req, res) => {
  res.json({ success: true, assignment: await markAttempt(req.user, req.params.id, req.body, req) });
}));
router.post('/assignments/:id/allow-retry', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, assignment: await allowRetry(req.user, req.params.id, req) });
}));
router.post('/assignments/:id/sign-off', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, assignment: await signOff(req.user, req.params.id, req) });
}));
router.post('/assignments/:id/cancel', v(validateTrainingId), asyncHandler(async (req, res) => {
  res.json({ success: true, assignment: await cancelAssignment(req.user, req.params.id, req) });
}));

export default router;
