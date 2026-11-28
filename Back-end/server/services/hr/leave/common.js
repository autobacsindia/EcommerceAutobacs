/** Small shared helpers for the leave services. */
import mongoose from 'mongoose';
import AppError from '../../../utils/AppError.js';

export const fail = (message, status) => new AppError(message, status, { expose: true });
export const isDup = (err) => err?.code === 11000 || err?.cause?.code === 11000;
export const isId = (v) => mongoose.isValidObjectId(v) && String(v).length === 24;
export const PAGE_MAX = 50;
export const pageSize = (limit, dflt = 25) => Math.min(Math.max(Number(limit) || dflt, 1), PAGE_MAX);

/**
 * Run `fn(session)` in a transaction. withTransaction retries the whole callback
 * on a transient error (e.g. the per-employee lock's write conflict), so `fn`
 * must re-read everything it decides on — never close over values read outside.
 */
export async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
