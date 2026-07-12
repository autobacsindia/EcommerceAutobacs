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
  name: process.env.COMPANY_NAME || 'Autobacs India',
  gstin: process.env.COMPANY_GSTIN || '',
  address: process.env.COMPANY_ADDRESS || '',
  city: process.env.COMPANY_CITY || '',
  state: process.env.COMPANY_STATE || '',
  pincode: process.env.COMPANY_PINCODE || '',
  phone: process.env.COMPANY_PHONE || '',
  email: process.env.COMPANY_EMAIL || 'support@autobacsindia.com',
  // Roavion primary logo (same asset as the storefront navbar). pdfkit needs a
  // PNG/JPEG, so invoiceService normalises Cloudinary URLs to f_png before fetch.
  logoUrl:
    process.env.COMPANY_LOGO_URL ||
    'https://res.cloudinary.com/dhwxtl6l8/image/upload/e_trim,f_auto,q_auto/v1782814887/roavion-primary_pwywsn.png',
};

/** Single-line postal address built from the parts that are set. */
export const companyAddressLine = () =>
  [companyInfo.address, companyInfo.city, companyInfo.state, companyInfo.pincode]
    .filter(Boolean)
    .join(', ');

export default companyInfo;
