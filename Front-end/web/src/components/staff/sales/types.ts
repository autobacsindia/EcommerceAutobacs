/** Shapes returned by the /staff sales endpoints (Back-end services/salesOrderService.js). */

export type SalesOrderItem = {
  name: string;
  variantLabel: string | null;
  quantity: number;
  price: number;
  /** Catalogue price when the line was sold at an offer; null = full price. */
  listPrice: number | null;
};

export type SalesOrder = {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  items: SalesOrderItem[];
  customer: { name: string; email: string; phone: string };
  shippingAddress: {
    fullName?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  } | null;
  salesPerson: string;
  /** Sales-panel order, or a website order (team workflow). */
  source?: 'sales' | 'website';
  /** Where the team workflow has got to; null for orders paid before it existed. */
  workflowSummary?: string | null;
  /** null once paid / closed. */
  linkState: 'active' | 'expired' | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
  razorpayPaymentId: string | null;
  paymentMethod: string | null;
};

export type SalesOrderPage = { success: boolean; orders: SalesOrder[]; nextCursor: string | null; scope?: 'mine' | 'team' };

export type SalesProduct = {
  id: string;
  name: string;
  sku: string;
  image: string;
  price: number;
  available: boolean;
  variants: { id: string; label: string; price: number; available: boolean }[];
};

export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees, showing paise only when there are any (an offer can be ₹4,499.50). */
export const rupees = (n: number) => (Number.isInteger(Math.round(n * 100) / 100) ? whole : paise).format(n);
