/**
 * Sales quotation settings (services/quotationService.js).
 *
 * The quotation is the PDF of a sales-panel order: the same lines and the same
 * server-computed total the payment link charges. These are the words around it.
 */

/** How long the quoted prices hold. The payment link inside lasts 48 h and is re-issued as needed. */
export const QUOTATION_VALID_DAYS = Number(process.env.QUOTATION_VALID_DAYS) || 7;

/** Printed under the totals on every quotation. */
export const QUOTATION_REMARKS = Object.freeze([
  'All prices are inclusive of GST.',
  'Installation, painting and delivery charges are extra unless listed above.',
  'Prices are held until the validity date and are subject to stock availability.',
  'This quotation is an estimate based on the details discussed; we will confirm any change with you before work begins.',
]);
