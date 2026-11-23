/**
 * One-time email codes (verify email, reset password).
 *
 *   • 6 digits from crypto.randomInt, stored only as an HMAC keyed by the server's
 *     primary JWT secret — a database read alone cannot brute-force them offline.
 *   • 15-minute expiry, 5 tries. The try is COUNTED (atomically, with the cap in
 *     the filter) BEFORE the code is compared, so parallel guesses cannot exceed 5.
 *   • A correct code is consumed by a compare-and-set on its hash: it works once.
 *   • A new code needs 60 s since the last one (cooldown in the update filter).
 */
import crypto from 'crypto';
import accounts from '../../repositories/supplierAccountRepository.js';
import { getPrimarySecret } from '../../utils/jwtSecretManager.js';
import { fail } from './errors.js';

export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

const CLEARED = {
  'emailCode.hash': '', 'emailCode.purpose': '', 'emailCode.expiresAt': null, 'emailCode.attempts': 0,
};

export const hashCode = (accountId, purpose, code) => crypto
  .createHmac('sha256', getPrimarySecret().secret)
  .update(`supplier-code:${accountId}:${purpose}:${code}`)
  .digest('hex');

const sameHash = (a, b) => {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/**
 * Store a fresh code for `purpose` and return it (plain) for the email, or throw
 * 429 RESEND_COOLDOWN. `force` skips the cooldown (first code at sign-up).
 */
export async function issueCode(accountId, purpose, { now = new Date(), force = false } = {}) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const filter = { _id: accountId };
  if (!force) {
    filter.$or = [{ 'emailCode.sentAt': null }, { 'emailCode.sentAt': { $lte: new Date(now.getTime() - RESEND_COOLDOWN_MS) } }];
  }
  const updated = await accounts.updateWhere(filter, {
    $set: {
      'emailCode.hash': hashCode(accountId, purpose, code),
      'emailCode.purpose': purpose,
      'emailCode.expiresAt': new Date(now.getTime() + CODE_TTL_MS),
      'emailCode.attempts': 0,
      'emailCode.sentAt': now,
    },
  });
  if (!updated) {
    throw fail(429, 'RESEND_COOLDOWN', 'Please wait a minute before asking for another code.', { retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) });
  }
  return code;
}

/** The email could not be sent — let the supplier ask again straight away. */
export const releaseCooldown = (accountId) => accounts.updateWhere({ _id: accountId }, { $set: { 'emailCode.sentAt': null } });

/**
 * Check `code` against the stored one and, if right, apply `onSuccess` (an update)
 * in the same write that consumes the code. Returns the updated account.
 * `account` must have been read WITH the code fields.
 */
export async function consumeCode(account, purpose, code, onSuccess = {}) {
  const stored = account?.emailCode || {};
  const invalid = () => fail(400, 'INVALID_CODE', 'That code is not right. Check the latest email or ask for a new code.');
  if (!stored.hash || stored.purpose !== purpose) throw invalid();
  if (!stored.expiresAt || new Date(stored.expiresAt).getTime() < Date.now()) {
    throw fail(400, 'CODE_EXPIRED', 'That code has expired. Ask for a new one.');
  }
  // Count this try first, capped in the filter: never more than CODE_MAX_ATTEMPTS comparisons.
  const counted = await accounts.updateWhere(
    { _id: account._id, 'emailCode.hash': stored.hash, 'emailCode.attempts': { $lt: CODE_MAX_ATTEMPTS } },
    { $inc: { 'emailCode.attempts': 1 } },
  );
  if (!counted) throw fail(400, 'CODE_LOCKED', 'Too many wrong tries. Ask for a new code.');

  if (!sameHash(hashCode(account._id, purpose, code), stored.hash)) {
    const used = (stored.attempts || 0) + 1;
    throw fail(400, 'INVALID_CODE', 'That code is not right. Check the latest email or ask for a new code.', {
      attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - used),
    });
  }

  const { $set = {}, ...rest } = onSuccess;
  const done = await accounts.updateWhere(
    { _id: account._id, 'emailCode.hash': stored.hash },
    { ...rest, $set: { ...CLEARED, ...$set } },
  );
  if (!done) throw invalid(); // consumed by a parallel request
  return done;
}
