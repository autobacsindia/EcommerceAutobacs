/**
 * Run `fn(session)` in one MongoDB transaction (ADR rule 2: the change and its
 * audit row commit together or not at all). withTransaction retries transient
 * errors itself, so `fn` must be safe to re-run.
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
