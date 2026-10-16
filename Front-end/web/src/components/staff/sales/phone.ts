/**
 * Indian mobile numbers as people type them — "98765 43210", "098765-43210",
 * "+91 98765 43210" — reduced to the 10 digits the API stores. Mirrors
 * normalizeIndianMobile in Back-end/server/validators/staff.validator.js.
 */
export function normalizeMobile(value: string): string {
  const digits = value.replace(/[\s\-().]/g, '');
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? m[1] : value.trim();
}

/** '' when fine, otherwise what to tell the salesperson. */
export function mobileProblem(value: string): string {
  const v = value.trim();
  if (!v) return 'Enter the customer’s mobile number';
  const n = normalizeMobile(v);
  if (/^[6-9]\d{9}$/.test(n)) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10) return 'Too short — a mobile number has 10 digits';
  if (/^[0-5]/.test(normalizeMobile(digits.slice(-10)))) return 'A mobile number starts with 6, 7, 8 or 9';
  return 'Enter a valid 10-digit Indian mobile number';
}
