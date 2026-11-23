/**
 * Format checks for supplier details. The server re-checks everything; these
 * exist so a supplier sees "PAN looks wrong" while typing, not after a round trip.
 * No imports, so `node --test` can run it directly.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^[0-9]{9,18}$/;
export const UPI_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
export const PHONE_RE = /^[6-9][0-9]{9}$/;
export const CODE_RE = /^[0-9]{6}$/;

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit (the official mod-36 scheme). */
export function gstinChecksumOk(gstin: string): boolean {
  if (!GSTIN_RE.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(gstin[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GST_CHARS[check] === gstin[14];
}

export const normalizeUpper = (s: string) => s.replace(/\s/g, '').toUpperCase();
export const digitsOnly = (s: string) => s.replace(/\D/g, '');
/** "+91 98765 43210" → "9876543210" */
export const normalizePhone = (s: string) => digitsOnly(s).replace(/^(91|0)(?=[6-9]\d{9}$)/, '');

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and numbers';
  return null;
}

export type OnboardingFields = {
  companyName: string;
  contactName: string;
  phone: string;
  city: string;
  address: string;
  gstin: string;
  pan: string;
  accountName: string;
  accountNumber: string;
  accountNumberAgain: string;
  ifsc: string;
  upiId: string;
};

/**
 * Field → message for everything wrong. `accountNumber` may be left blank when
 * the server already holds one (we only ever get its last 4 back).
 */
export function checkOnboarding(f: OnboardingFields, opts: { hasSavedAccount: boolean }): Partial<Record<keyof OnboardingFields, string>> {
  const e: Partial<Record<keyof OnboardingFields, string>> = {};
  if (f.companyName.trim().length < 2) e.companyName = 'Enter your company name';
  if (f.contactName.trim().length < 2) e.contactName = 'Enter a contact person';
  if (!PHONE_RE.test(normalizePhone(f.phone))) e.phone = 'Enter a 10-digit mobile number';
  if (f.city.trim().length < 2) e.city = 'Enter your city';
  if (f.address.trim().length < 8) e.address = 'Enter your full address';

  const gstin = normalizeUpper(f.gstin);
  const pan = normalizeUpper(f.pan);
  if (!GSTIN_RE.test(gstin)) e.gstin = 'GSTIN has 15 characters, like 32ABCDE1234F1Z5';
  else if (!gstinChecksumOk(gstin)) e.gstin = 'This GSTIN has a typo (check digit does not match)';
  if (!PAN_RE.test(pan)) e.pan = 'PAN has 10 characters, like ABCDE1234F';
  else if (GSTIN_RE.test(gstin) && gstin.slice(2, 12) !== pan) e.pan = 'PAN must match characters 3–12 of your GSTIN';

  if (f.accountName.trim().length < 2) e.accountName = 'Enter the name on the bank account';
  const acct = digitsOnly(f.accountNumber);
  if (acct || !opts.hasSavedAccount) {
    if (!ACCOUNT_RE.test(acct)) e.accountNumber = 'Account number is 9 to 18 digits';
    else if (acct !== digitsOnly(f.accountNumberAgain)) e.accountNumberAgain = 'The two account numbers do not match';
  }
  if (!IFSC_RE.test(normalizeUpper(f.ifsc))) e.ifsc = 'IFSC has 11 characters, like HDFC0001234';
  if (f.upiId.trim() && !UPI_RE.test(f.upiId.trim())) e.upiId = 'UPI ID looks like name@bank';
  return e;
}
