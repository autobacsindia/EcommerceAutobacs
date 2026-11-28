/**
 * Payroll money maths — ONE rounding rule for every payslip figure.
 *
 *   Every line is worked out from integer paise as a single fraction
 *   (product of the inputs ÷ product of the divisors) in exact integer
 *   arithmetic (BigInt), then rounded ONCE to the nearest paisa, halves up.
 *   Lines are rounded separately; totals are plain sums of the rounded lines,
 *   so the payslip always adds up to the paisa.
 *
 * Rates stored as decimals in HrSettings (0.12, 0.0075) are turned into whole
 * parts-per-million first, so no float ever touches a money figure. Days are
 * counted in HALF-days (integers) so ½-day LOP needs no floats either.
 */

const assertCount = (v, what) => {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`payroll maths: ${what} must be a whole number ≥ 0 (got ${v})`);
};

/** round-half-up( Π num ÷ Π den ) for whole numbers ≥ 0 (den > 0). */
export function ratio(num, den) {
  let n = 1n;
  let d = 1n;
  for (const v of num) { assertCount(v, 'factor'); n *= BigInt(v); }
  for (const v of den) {
    assertCount(v, 'divisor');
    if (v === 0) throw new Error('payroll maths: divide by zero');
    d *= BigInt(v);
  }
  const q = n / d;
  const r = n % d;
  return Number(2n * r >= d ? q + 1n : q);
}

const PPM = 1000000;
/** A decimal rate (0.12) as whole parts per million (120000). */
export const toPpm = (rate) => {
  const v = Math.round(Number(rate) * PPM);
  if (!Number.isFinite(v) || v < 0) throw new Error(`payroll maths: bad rate ${rate}`);
  return v;
};
/** paise × rate, rounded once. */
export const applyRate = (paise, rate) => ratio([paise, toPpm(rate)], [PPM]);

/** Days (may end in .5) → whole half-days. Anything not on a half-day step is refused. */
export function toHalfDays(days, what = 'days') {
  const h = Number(days || 0) * 2;
  if (!Number.isFinite(h) || h < 0 || Math.abs(h - Math.round(h)) > 1e-9) {
    throw new Error(`payroll: ${what} must be a whole or half number of days (got ${days})`);
  }
  return Math.round(h);
}
export const fromHalfDays = (h) => h / 2;

/** ₹1,23,456.78 — for the human-readable `calc` text only, never for maths. */
export const rupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', {
  minimumFractionDigits: Number(paise) % 100 ? 2 : 0, maximumFractionDigits: 2,
})}`;

/** "½", "2½", "3" — days for the `calc` text. */
export const dayText = (days) => {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (!half) return String(whole);
  return whole ? `${whole}½` : '½';
};
