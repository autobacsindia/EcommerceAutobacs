import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  validateLessonId, validateLessonFileName, validateLessonList, validateLessonCreate,
  validateLessonUpdate, validateLessonUploadTarget, validateLessonAttach, validateLessonDone,
} from '../validators/staffLesson.validator.js';
import {
  lessonMeta, listLessons, getLesson, createLesson, updateLesson, markLessonChecked, archiveLesson,
  setLessonDone, lessonProgress, lessonUploadTarget, attachLessonFile, removeLessonFile, lessonFileUrl,
} from '../services/staffLessonService.js';

/**
 * The Lesson Library (/api/v1/staff/lessons). Mounted inside routes/staff.js after
 * its signed-in gate; who may do what is services/staffLessonService.js.
 */
const router = express.Router();

router.get('/meta', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await lessonMeta(req.user)) });
}));
router.get('/', validateLessonList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listLessons(req.user, req.query)) });
}));
router.post('/', validateLessonCreate, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, lesson: await createLesson(req.user, req.body, req) });
}));
router.get('/:id', validateLessonId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await getLesson(req.user, req.params.id) });
}));
router.patch('/:id', validateLessonUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await updateLesson(req.user, req.params.id, req.body, req) });
}));
router.delete('/:id', validateLessonId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await archiveLesson(req.user, req.params.id, req)) });
}));
router.post('/:id/checked', validateLessonId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await markLessonChecked(req.user, req.params.id, req) });
}));
router.put('/:id/done', validateLessonDone, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await setLessonDone(req.user, req.params.id, req.body.done === true || req.body.done === 'true') });
}));
router.get('/:id/progress', validateLessonId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await lessonProgress(req.user, req.params.id)) });
}));
router.post('/:id/upload-target', validateLessonUploadTarget, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await lessonUploadTarget(req.user, req.params.id, req.body)) });
}));
router.post('/:id/files', validateLessonAttach, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await attachLessonFile(req.user, req.params.id, req.body) });
}));
router.delete('/:id/files/:name', validateLessonFileName, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, lesson: await removeLessonFile(req.user, req.params.id, req.params.name, req) });
}));
// A short-lived link to the private file; never cached, since it is a credential.
router.get('/:id/files/:name', validateLessonFileName, validateRequest, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await lessonFileUrl(req.user, req.params.id, req.params.name, { download: req.query.download === '1' })) });
}));

export default router;
