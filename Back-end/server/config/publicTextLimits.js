/**
 * How much a shopper or visitor may write in one box: a product review, a blog
 * comment, consultation notes, an affiliate application's pitch.
 *
 * 5,000 characters (about two typed pages) is far more than a genuine review or
 * note needs, so nobody meets it in normal use — but these routes are public,
 * so the cap stays firm against spam and huge pastes. Over the cap is refused
 * with a clear message; text is never shortened.
 *
 * Mirrored by CUSTOMER_TEXT_MAX in Front-end/web/src/lib/textLimit.ts.
 */
export const CUSTOMER_TEXT_MAX = 5000;
