/**
 * A customer's saved delivery addresses — the rules, as a pure function.
 *
 * Why this exists rather than reusing PUT /profile: that endpoint requires
 * `name` and `email` on every call and sets both unconditionally, so saving an
 * address from checkout would mean round-tripping the customer's identity
 * fields through an unrelated form. Its validator also runs `normalizeEmail()`,
 * which rewrites any email that was stored un-normalised (Google sign-in,
 * admin-created and migrated accounts). Address edits get their own endpoint
 * that cannot touch anything else.
 *
 * The rules:
 *   • Only known fields are kept. Anything else in the payload is dropped, so a
 *     client cannot write `coordinates` or arbitrary keys onto the user.
 *   • Indian delivery data: a 10-digit mobile (a leading +91/0 is tolerated and
 *     removed) and a 6-digit PIN code. The order flow already requires both; an
 *     address that could never be shipped to should not be savable.
 *   • At most MAX_ADDRESSES — the list is replaced wholesale on every save, so
 *     an unbounded array is an unbounded write.
 *   • Exactly one default whenever the list is non-empty: the first one marked
 *     default wins; if none is marked, the first address becomes the default.
 *     Checkout pre-selects the default, so "no default" and "two defaults" are
 *     both states the UI would have to guess about.
 */

export const MAX_ADDRESSES = 10;

const FIELDS = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'];
const REQUIRED = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];

const LABELS = {
  fullName: 'Full name',
  phone: 'Mobile number',
  addressLine1: 'Address line 1',
  city: 'City',
  state: 'State',
  postalCode: 'PIN code',
};

/** Thrown for any input the address book will not accept. Carries a 400. */
export class AddressBookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressBookError';
    this.statusCode = 400;
    this.isOperational = true;
  }
}

/** "+91 98765 43210" / "098765-43210" → "9876543210", or null if not 10 digits. */
export function normalisePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * Validate and clean a full address list, ready to replace user.addresses.
 * @param {unknown} input
 * @returns {Array<object>}
 * @throws {AddressBookError}
 */
export function normaliseAddressBook(input) {
  if (!Array.isArray(input)) throw new AddressBookError('addresses must be a list.');
  if (input.length > MAX_ADDRESSES) {
    throw new AddressBookError(`You can save up to ${MAX_ADDRESSES} addresses.`);
  }

  const cleaned = input.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new AddressBookError(`Address ${i + 1} is not valid.`);

    const a = {};
    for (const f of FIELDS) a[f] = String(raw[f] ?? '').trim();

    for (const f of REQUIRED) {
      if (!a[f]) throw new AddressBookError(`${LABELS[f]} is required (address ${i + 1}).`);
    }

    const phone = normalisePhone(a.phone);
    if (!phone) throw new AddressBookError(`Enter a valid 10-digit mobile number (address ${i + 1}).`);
    a.phone = phone;

    if (!/^\d{6}$/.test(a.postalCode)) {
      throw new AddressBookError(`PIN code must be 6 digits (address ${i + 1}).`);
    }

    for (const f of FIELDS) {
      if (a[f].length > 200) throw new AddressBookError(`${LABELS[f] ?? f} is too long (address ${i + 1}).`);
    }

    a.country = 'India';
    a.isDefault = raw.isDefault === true;
    // No `_id`: AddressSchema is declared `{ _id: false }` and the website
    // relies on that shape, so clients identify an address by its contents.
    return a;
  });

  if (cleaned.length) {
    const firstDefault = cleaned.findIndex((a) => a.isDefault);
    const winner = firstDefault === -1 ? 0 : firstDefault;
    cleaned.forEach((a, i) => { a.isDefault = i === winner; });
  }

  return cleaned;
}
