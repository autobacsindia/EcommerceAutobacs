/**
 * Run `fn(session)` in a MongoDB transaction (ADR rule 2: multi-document writes
 * commit together — the change and its audit row, or neither). withTransaction
 * retries transient errors itself, so `fn` must be safe to re-run.
 */
import mongoose from 'mongoose';

export async function withTx(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
}

export const isDuplicateKey = (err) => err?.code === 11000;
