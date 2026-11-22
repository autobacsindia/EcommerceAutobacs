/**
 * Autobacs Partner (supplier app) authentication.
 *
 * A supplier token is a JWT signed with a key DERIVED from the normal JWT secret
 * (HMAC(secret, SUPPLIER_KEY_LABEL)) and carries audience SUPPLIER_TOKEN_AUDIENCE.
 * So, with no change to the staff/customer path:
 *   • a supplier token fails `protect`/`optionalAuth` (wrong key → 401), and
 *   • a staff/customer token fails `protectSupplier` (wrong key + no audience).
 * Rotation follows the main secrets: the token's `kid` picks the base secret.
 *
 * Tokens are accepted from the Authorization header ONLY — never a cookie — so a
 * browser session on the website can never be used against supplier routes.
 * Every request re-checks `sessionVersion` (instant revocation) and the account status.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import SupplierAccount, { SUPPLIER_ACCOUNT_STATUS } from '../models/SupplierAccount.js';
import { getActiveSecrets, getPrimarySecret } from '../utils/jwtSecretManager.js';
import { SUPPLIER_TOKEN_AUDIENCE, SUPPLIER_TOKEN_TTL, SUPPLIER_KEY_LABEL } from '../config/supplierPortal.js';

const deriveKey = (secret) => crypto.createHmac('sha256', secret).update(SUPPLIER_KEY_LABEL).digest('hex');

export function signSupplierToken(account) {
  const { secret, kid } = getPrimarySecret();
  return jwt.sign(
    { sid: String(account._id), sv: account.sessionVersion || 0, typ: 'supplier' },
    deriveKey(secret),
    { algorithm: 'HS256', audience: SUPPLIER_TOKEN_AUDIENCE, expiresIn: SUPPLIER_TOKEN_TTL, header: { kid } }
  );
}

/** Throws on anything but a valid, unexpired supplier token. */
export function verifySupplierToken(token) {
  const header = jwt.decode(token, { complete: true })?.header;
  if (!header) throw new Error('bad token');
  const kid = header.kid || 'current';
  const base = getActiveSecrets().find((s) => s.version === kid);
  if (!base) throw new Error('unknown key');
  const decoded = jwt.verify(token, deriveKey(base.secret), { algorithms: ['HS256'], audience: SUPPLIER_TOKEN_AUDIENCE });
  if (decoded.typ !== 'supplier' || !mongoose.isValidObjectId(decoded.sid)) throw new Error('bad token');
  return decoded;
}

const deny = (res, message, code) => res.status(401).json({ success: false, message, ...(code ? { code } : {}) });

/** Sets req.supplier = { _id, status, supplierId, companyName, sessionVersion }. Never 200 on failure. */
export async function protectSupplier(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return deny(res, 'Please sign in');
  let decoded;
  try {
    decoded = verifySupplierToken(auth.slice(7).trim());
  } catch {
    return deny(res, 'Please sign in again');
  }
  try {
    const account = await SupplierAccount.findById(decoded.sid)
      .select('_id status supplierId companyName sessionVersion')
      .lean();
    if (!account) return deny(res, 'Please sign in again');
    if ((account.sessionVersion || 0) !== decoded.sv) return deny(res, 'Session expired. Please sign in again.', 'SESSION_REVOKED');
    req.supplier = account;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Gate a route to accounts in one of `statuses` (default: approved only). 403 otherwise. */
export const requireSupplierStatus = (...statuses) => {
  const allowed = statuses.length ? statuses : [SUPPLIER_ACCOUNT_STATUS.APPROVED];
  return (req, res, next) => {
    if (!req.supplier) return deny(res, 'Please sign in');
    if (!allowed.includes(req.supplier.status)) {
      return res.status(403).json({ success: false, message: 'Your account cannot do this yet', code: 'SUPPLIER_STATUS', status: req.supplier.status });
    }
    return next();
  };
};
