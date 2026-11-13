/**
 * Company / seller identity used on invoices and receipts.
 *
 * Env-driven so the legal entity details (GSTIN, registered address) are never
 * hardcoded and can differ per environment. All fields are optional at the
 * config level — invoiceService renders only what is present, so a missing
 * GSTIN simply omits that line rather than crashing invoice generation.
 *
 * Set real values in the Railway dashboard (see .env.example COMPANY_*).
 */

export const companyInfo = {
  // The BRAND every customer and staff member sees (emails, quotes, slips,
  // feeds, the invoice heading). Set COMPANY_NAME=Autobacs India in Railway.
  name: process.env.COMPANY_NAME || 'Autobacs India',
  // The REGISTERED seller, printed once beside the GSTIN on tax invoices only
  // (GST rules require the legal name there). Nowhere else.
  legalName: process.env.COMPANY_LEGAL_NAME || 'Roavion Automotive Private Limited',
  gstin: process.env.COMPANY_GSTIN || '',
  address: process.env.COMPANY_ADDRESS || '',
  city: process.env.COMPANY_CITY || '',
  state: process.env.COMPANY_STATE || '',
  pincode: process.env.COMPANY_PINCODE || '',
  phone: process.env.COMPANY_PHONE || '',
  email: process.env.COMPANY_EMAIL || 'support@autobacsindia.com',
};

/** Single-line postal address built from the parts that are set. */
export const companyAddressLine = () =>
  [companyInfo.address, companyInfo.city, companyInfo.state, companyInfo.pincode]
    .filter(Boolean)
    .join(', ');

export default companyInfo;
