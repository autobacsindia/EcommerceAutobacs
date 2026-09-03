/**
 * Pure checkout-side validation of the enterprise buyer block.
 *
 * Extracted from the checkout component so it can be tested without rendering a
 * page that depends on auth, cart, Razorpay and six mocked contexts — and so
 * both address paths (saved address / new address form) call exactly the same
 * rules. When this lived inline it sat AFTER the saved-address early return, so
 * a returning customer skipped it entirely and met the rules only as a server
 * 400 at Place Order.
 *
 * ⚠️ ADVISORY ONLY. services/buyerService.js enforces all of this again and is
 * the authority; this exists to fail fast and in front of the right field.
 */

import { checkGstin } from './buyerTypes';

export interface EnterpriseBlockInput {
  isEnterprise: boolean;
  legalName: string;
  gstin: string;
  billingSameAsShipping: boolean;
  billing: { line1: string; city: string; postalCode: string };
  shipping: { line1: string; city: string; postalCode: string };
}

/**
 * @returns the first problem to show the buyer, or null when the block is usable.
 */
export function enterpriseBlockError(input: EnterpriseBlockInput): string | null {
  if (!input.isEnterprise) return null;

  if (!input.legalName.trim()) {
    return 'Enter the registered legal name for your GST registration';
  }

  const gstin = checkGstin(input.gstin);
  if (!gstin.valid) {
    // `message` is undefined for an untouched empty field — say something useful
    // rather than showing nothing when the buyer presses Continue.
    return gstin.message || 'Enter a valid GSTIN';
  }

  const billing = input.billingSameAsShipping ? input.shipping : input.billing;
  if (!billing.line1.trim() || !billing.city.trim() || !billing.postalCode.trim()) {
    return 'Enter a complete billing address — it appears on your receipt';
  }

  return null;
}
