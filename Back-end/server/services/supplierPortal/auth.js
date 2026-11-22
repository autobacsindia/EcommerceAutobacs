/**
 * Autobacs Partner sign-up / sign-in. Separate from customer & staff auth: the
 * account is a SupplierAccount and the token comes from middleware/supplierAuth.js.
 *
 * Leak rules:
 *   • login: one generic 401 for "no such email", "wrong password" and "locked" —
 *     plus a dummy bcrypt compare so a missing email is not faster.
 *   • forgot: always the same 200, whether or not the email has an account.
 *   • signup: a taken email is a 409 (the supplier must be told to sign in
 *     instead); the IP rate limit is what stops anyone mapping addresses with it.
 */
import bcrypt from 'bcryptjs';
import accounts, { SUPPLIER_ACCOUNT_STATUS as S, emailKeyOf } from '../../repositories/supplierAccountRepository.js';
import { signSupplierToken } from '../../middleware/supplierAuth.js';
import { toSupplierAccountView } from '../../utils/supplierPortalView.js';
import { fail } from './errors.js';
import { onlyKeys, str, email as emailOf, phone as phoneOf, password as passwordOf, sixDigitCode } from './validate.js';
import { issueCode, consumeCode, releaseCooldown } from './codes.js';
import { sendCodeEmail } from './notify.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
// A real bcrypt hash of a random string: compared when the email is unknown so
// both paths cost one bcrypt.
const DUMMY_HASH = bcrypt.hashSync('autobacs-partner-dummy-password', ROUNDS);

const LOGIN_FAILED = () => fail(401, 'INVALID_LOGIN', 'Email or password is wrong. After 5 wrong tries, sign-in pauses for 15 minutes.');

const session = (account) => ({ token: signSupplierToken(account), account: toSupplierAccountView(account) });

/** Send a code by email; if the email fails, free the cooldown so "resend" works at once. */
async function deliverCode(account, purpose, { force = false } = {}) {
  const code = await issueCode(account._id, purpose, { force });
  const sent = await sendCodeEmail({ to: account.email, name: account.contactName, code, purpose });
  if (!sent) await releaseCooldown(account._id);
  return sent;
}

export async function signup(body) {
  onlyKeys(body, ['email', 'password', 'companyName', 'contactName', 'phone']);
  const email = emailOf(body.email);
  const pw = passwordOf(body.password);
  const data = {
    email,
    emailKey: emailKeyOf(email),
    companyName: str(body.companyName, 'Company name', { min: 2, max: 120 }),
    contactName: str(body.contactName, 'Contact name', { min: 2, max: 120 }),
    phone: phoneOf(body.phone),
    status: S.EMAIL_UNVERIFIED,
  };
  const taken = () => fail(409, 'EMAIL_TAKEN', 'This email already has an Autobacs Partner account. Sign in, or reset the password.');
  if (await accounts.findByEmail(data.emailKey)) throw taken();
  let account;
  try {
    account = await accounts.create({ ...data, passwordHash: await bcrypt.hash(pw, ROUNDS) });
  } catch (err) {
    if (err?.code === 11000) throw taken(); // two sign-ups raced
    throw err;
  }
  const codeSent = await deliverCode(account, 'verify', { force: true });
  return { ...session(account), codeSent };
}

export async function verifyEmail(supplierId, body) {
  onlyKeys(body, ['code']);
  const code = sixDigitCode(body.code);
  const account = await accounts.findByIdWithCode(supplierId);
  if (!account) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  // Idempotent: a retried verify after success just returns the account.
  if (account.status !== S.EMAIL_UNVERIFIED) return { account: toSupplierAccountView(account) };
  const done = await consumeCode(account, 'verify', code, {
    $set: { status: S.DRAFT, emailVerifiedAt: new Date() },
  });
  return { account: toSupplierAccountView(done) };
}

export async function resendCode(supplierId) {
  const account = await accounts.findById(supplierId);
  if (!account) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (account.status !== S.EMAIL_UNVERIFIED) throw fail(409, 'ALREADY_VERIFIED', 'Your email is already confirmed.');
  const codeSent = await deliverCode(account, 'verify');
  if (!codeSent) throw fail(502, 'EMAIL_FAILED', 'We could not send the email just now. Please try again.');
  return { codeSent };
}

export async function login(body) {
  onlyKeys(body, ['email', 'password']);
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) {
    throw fail(400, 'INVALID_FIELD', 'Enter your email and password.');
  }
  const account = await accounts.findByEmailForLogin(emailKeyOf(body.email));
  if (!account) {
    await bcrypt.compare(body.password, DUMMY_HASH);
    throw LOGIN_FAILED();
  }
  const ok = await bcrypt.compare(body.password, account.passwordHash);
  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) throw LOGIN_FAILED();
  if (!ok) {
    const after = await accounts.updateWhere({ _id: account._id }, { $inc: { failedLogins: 1 } });
    // failedLogins is select:false, so re-derive from what we read (+1). A race can
    // only make the lock arrive one try late, never let a 6th parallel guess skip it
    // for long: every further failure re-checks.
    const count = (account.failedLogins || 0) + 1;
    if (after && count >= MAX_FAILED_LOGINS) {
      await accounts.updateWhere({ _id: account._id }, { $set: { lockedUntil: new Date(Date.now() + LOCK_MS), failedLogins: 0 } });
    }
    throw LOGIN_FAILED();
  }
  const fresh = await accounts.updateWhere(
    { _id: account._id },
    { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );
  return session(fresh || account);
}

export async function forgot(body) {
  onlyKeys(body, ['email']);
  const generic = { message: 'If this email has an Autobacs Partner account, we have sent a code to it.' };
  if (typeof body.email !== 'string' || !body.email.trim()) throw fail(400, 'INVALID_FIELD', 'Enter your email.');
  const account = await accounts.findByEmail(emailKeyOf(body.email));
  if (!account || account.status === S.REJECTED) return generic;
  try {
    await deliverCode(account, 'reset');
  } catch (err) {
    // Cooldown or a mail failure: say the same thing (no account-existence leak).
    if (err?.code !== 'RESEND_COOLDOWN') throw err;
  }
  return generic;
}

export async function reset(body) {
  onlyKeys(body, ['email', 'code', 'password']);
  if (typeof body.email !== 'string' || !body.email.trim()) throw fail(400, 'INVALID_FIELD', 'Enter your email.');
  const code = sixDigitCode(body.code);
  const pw = passwordOf(body.password);
  const account = await accounts.findByEmailWithCode(emailKeyOf(body.email));
  if (!account) throw fail(400, 'INVALID_CODE', 'That code is not right. Check the latest email or ask for a new code.');
  const $set = { passwordHash: await bcrypt.hash(pw, ROUNDS), failedLogins: 0, lockedUntil: null };
  // The code proved they read this inbox, so an unconfirmed email is now confirmed.
  if (account.status === S.EMAIL_UNVERIFIED) Object.assign($set, { status: S.DRAFT, emailVerifiedAt: new Date() });
  // sessionVersion bump signs out every device that had the old password.
  const done = await consumeCode(account, 'reset', code, { $set, $inc: { sessionVersion: 1 } });
  return session(done);
}

export async function logoutAll(supplierId) {
  const done = await accounts.updateWhere({ _id: supplierId }, { $inc: { sessionVersion: 1 } });
  if (!done) throw fail(401, 'UNAUTHENTICATED', 'Please sign in again');
  return { message: 'Signed out on every device.' };
}
