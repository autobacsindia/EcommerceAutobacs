import crypto from 'crypto';

/**
 * Application-layer field encryption for stored secrets (AES-256-GCM).
 *
 * ── WHAT THIS DEFENDS AGAINST, AND WHAT IT DOES NOT ──────────────────────────────
 * It protects fields whose exposure would be a real harm to the PERSON, not just to us:
 * an affiliate's bank account number and PAN. Those arrive on a PUBLIC, unauthenticated
 * form and sit in the database for years.
 *
 * The threat model is DATABASE-ONLY exposure — a leaked backup, a `mongodump`, an
 * over-permissioned Atlas user, a support engineer browsing collections. Against those
 * this is effective: the ciphertext is useless without the key, which lives in the
 * application environment and never in Mongo.
 *
 * ⚠️ It does NOT defend against a full application compromise. Anyone who can run code
 * in this process has both the key and the database credentials. Saying so plainly
 * matters: the value of this is bounded, and pretending otherwise would encourage
 * treating these fields as safe in contexts where they are not.
 *
 * Atlas already encrypts the disk at rest. This is a second, independent layer, scoped
 * to the handful of fields where the blast radius justifies it — not a general policy.
 *
 * ── WHY GCM ──────────────────────────────────────────────────────────────────────
 * Authenticated. A tampered ciphertext fails to decrypt rather than yielding plausible
 * garbage — which matters when the plaintext is a bank account number that someone is
 * about to transfer money to.
 *
 * ── FORMAT ───────────────────────────────────────────────────────────────────────
 *   enc:v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
 *
 * The prefix is what makes every operation idempotent and migration-safe: we can always
 * tell an encrypted value from a legacy plaintext one, so re-saving a document cannot
 * double-encrypt, and a partially migrated collection reads correctly throughout. The
 * version segment leaves room to rotate the key or the algorithm later without guessing
 * at what an old row contains.
 */

const PREFIX = 'enc';
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // GCM standard; 96-bit nonce
const KEY_BYTES = 32;  // AES-256

/**
 * The key, decoded once and cached.
 *
 * Accepts base64 or hex so it can be generated with either of the two commands people
 * actually reach for:
 *   openssl rand -base64 32
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
let cachedKey;
let cachedRaw;

const loadKey = () => {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) return null;
  // Re-derive if the variable changed (tests set it per-suite).
  if (cachedKey && cachedRaw === raw) return cachedKey;

  const decoded = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). `
      + 'Generate one with: openssl rand -base64 32'
    );
  }

  cachedKey = decoded;
  cachedRaw = raw;
  return cachedKey;
};

/** Has this value already been encrypted by us? */
export const isEncrypted = (value) =>
  typeof value === 'string' && value.startsWith(`${PREFIX}:${VERSION}:`);

/** True when a key is configured, i.e. when encrypted writes are possible. */
export const encryptionAvailable = () => Boolean(process.env.FIELD_ENCRYPTION_KEY);

/**
 * Encrypt a value for storage.
 *
 * ⚠️ THROWS when no key is configured, rather than storing plaintext.
 *
 * Falling back to plaintext would be the worst outcome available: the field would look
 * protected everywhere it is discussed, the failure would be invisible, and nobody would
 * discover it until the data was already exposed. A loud failure at write time is
 * recoverable — a missing environment variable is a five-minute fix. Silent plaintext is
 * not recoverable, because you cannot un-leak it.
 *
 * Returns null/undefined unchanged, and already-encrypted values unchanged (idempotent,
 * so a document can be re-saved freely).
 */
export const encryptField = (value) => {
  if (value === null || value === undefined || value === '') return value;
  if (isEncrypted(value)) return value;

  const key = loadKey();
  if (!key) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not set — refusing to store a sensitive field in plaintext. '
      + 'Generate one with `openssl rand -base64 32` and set it in the environment.'
    );
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
};

/**
 * Decrypt a stored value.
 *
 * A value that is NOT in our format is returned as-is. That is deliberate: it lets a
 * collection be migrated row by row and read correctly the whole way through, and it
 * means a row written before this existed still resolves rather than throwing on a
 * payout screen.
 *
 * A value that IS in our format but fails to decrypt throws — a wrong key or a tampered
 * ciphertext must be loud. Returning the ciphertext, or an empty string, would put a
 * corrupt "account number" in front of someone about to make a bank transfer.
 */
export const decryptField = (value) => {
  if (!isEncrypted(value)) return value;

  const key = loadKey();
  if (!key) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set — cannot decrypt a stored field.');
  }

  const [, , ivB64, tagB64, dataB64] = value.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

/** Last four characters of a possibly-encrypted value, without exposing the rest. */
export const lastFourOf = (value) => {
  const plain = decryptField(value);
  const digits = String(plain ?? '').replace(/\D/g, '');
  return digits.slice(-4);
};

export default { encryptField, decryptField, isEncrypted, encryptionAvailable, lastFourOf };
