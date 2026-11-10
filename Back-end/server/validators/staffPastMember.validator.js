/** Past-member validation: shape and bounds only. Rules are services/staffPastMemberService.js. */
import { param, query } from 'express-validator';
import mongoose from 'mongoose';

const cursor = query('cursor').optional().isString().isLength({ max: 300 }).withMessage('Invalid page cursor');
export const validatePastMemberList = [cursor, query('team').optional().isString().isLength({ max: 40 }).withMessage('Choose a valid team')];
export const validatePastMemberId = [param('userId').custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage('Invalid id')];
export const validatePastMemberPage = [...validatePastMemberId, cursor];
