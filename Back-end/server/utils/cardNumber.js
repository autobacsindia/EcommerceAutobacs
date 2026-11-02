/**
 * Does this text carry what looks like a payment card number?
 *
 * Used to refuse free text on forms where a card number must never be typed
 * (Subscriptions & dues: "card last 4 digits only"). A card number is 12–19
 * digits, often written in groups — "4111 1111 1111 1111", "4111-1111-1111-1111" —
 * and passes the Luhn check every card number carries. The Luhn check keeps
 * ordinary long numbers (a phone number with its country code, an invoice or
 * account number) from being refused nine times out of ten.
 */

/** Runs of digits, allowing single spaces or dashes between groups. */
const DIGIT_RUNS = /\d(?:[ -]?\d)+/g;

export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * True when a 12–19 digit run in `text` passes the Luhn check. The run is tested
 * whole: testing every window of a longer number would flag most long reference
 * numbers (each window passes one time in ten), and a run of 20+ digits is not a card.
 */
export function containsCardNumber(text) {
  const runs = String(text ?? '').match(DIGIT_RUNS) || [];
  return runs.some((run) => {
    const digits = run.replace(/[ -]/g, '');
    return digits.length >= 12 && digits.length <= 19 && luhnValid(digits);
  });
}
