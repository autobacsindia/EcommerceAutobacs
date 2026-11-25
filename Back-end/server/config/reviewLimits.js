/**
 * How long a review comment may be, by who is writing it.
 *
 * Two different jobs, so two different limits:
 *
 *  • CUSTOMER_COMMENT_MAX — what a shopper may submit: the shared public cap
 *    (config/publicTextLimits.js, 5,000). Raised from 1,000 so a detailed
 *    review is never refused; the product page shortens long cards on display.
 *
 *  • ADMIN_COMMENT_MAX — what staff may enter. Higher, because the real use is
 *    bringing a customer's existing review across from Google, and those run
 *    long. Trimming someone's words to fit a field is how a genuine review
 *    turns into a misleading one, so the field gives way instead.
 *
 * The schema allows the higher of the two (it cannot tell who is writing); the
 * customer limit is enforced on the public routes. Both live here so raising
 * one can never silently raise the other.
 */
import { CUSTOMER_TEXT_MAX } from './publicTextLimits.js';

export const CUSTOMER_COMMENT_MAX = CUSTOMER_TEXT_MAX;
export const ADMIN_COMMENT_MAX = 10000;
