/** Past-member validation: shape and bounds only. Rules are services/staffPastMemberService.js. */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const cursor = query('cursor').optional().isString().isLength({ max: 300 }).withMessage('Invalid page cursor');
export const validatePastMemberList = [cursor, query('team').optional().isString().isLength({ max: 40 }).withMessage('Choose a valid team')];
export const validatePastMemberId = [param('userId').custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage('Invalid id')];
export const validatePastMemberPage = [...validatePastMemberId, cursor];
const noteId = param('noteId').custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage('Invalid id');
const noteBody = body('body').isString().withMessage('Write something first');
export const validatePastMemberNoteCreate = [...validatePastMemberId, noteBody];
export const validatePastMemberNoteUpdate = [...validatePastMemberId, noteId, noteBody, body('rev').isInt({ min: 0 }).withMessage('Reload and try again')];
export const validatePastMemberNoteId = [...validatePastMemberId, noteId];
