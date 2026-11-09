/**
 * Lesson Library validation: shape and bounds only. Who may do what, and the
 * cleaning of every field, is services/staffLessonService.js.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { LESSON_AUDIENCES } from '../models/StaffLesson.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const FILE_NAME = /^file-[0-9a-f]{16}\.[a-z0-9]{2,5}$/;

export const validateLessonId = [param('id').custom(isObjectId).withMessage('Invalid lesson id')];
export const validateLessonFileName = [
  ...validateLessonId,
  param('name').matches(FILE_NAME).withMessage('Invalid file'),
  query('download').optional().isIn(['0', '1']).withMessage('Invalid download'),
];
export const validateLessonList = [
  query('section').optional().isIn(LESSON_AUDIENCES).withMessage('Invalid section'),
  query('q').optional().isString().isLength({ max: 100 }).withMessage('Search is too long'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];
const fields = [
  body('title').optional().isString(),
  body('body').optional().isString(),
  body('topic').optional().isString(),
  // "" is the form's "Me" / "keep the current owner".
  body('ownerId').optional({ values: 'falsy' }).custom(isObjectId).withMessage('Invalid owner'),
];
export const validateLessonCreate = [
  body('title').isString().withMessage('Give the lesson a title'),
  body('audience').isIn(LESSON_AUDIENCES).withMessage('Choose who the lesson is for'),
  ...fields,
];
export const validateLessonUpdate = [
  ...validateLessonId,
  body('rev').isInt({ min: 0 }).withMessage('Reload and try again'),
  body('audience').optional().isIn(LESSON_AUDIENCES).withMessage('Choose who the lesson is for'),
  ...fields,
];
export const validateLessonUploadTarget = [
  ...validateLessonId,
  body('contentType').isString().isLength({ max: 120 }).withMessage('Invalid file type'),
  body('size').isInt({ min: 1 }).withMessage('Invalid file size'),
];
export const validateLessonAttach = [
  ...validateLessonId,
  body('key').isString().isLength({ max: 200 }).withMessage('Invalid upload'),
  body('name').isString().isLength({ max: 255 }).withMessage('Invalid file name'),
];
export const validateLessonDone = [...validateLessonId, body('done').isBoolean().withMessage('Invalid value')];
