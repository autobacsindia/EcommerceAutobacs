/**
 * Shared builder for the Google Ads `purchase` conversion payload.
 *
 * Pure + client-safe: used by both the server page (page.tsx) and the client
 * fallback (ConversionFallback.tsx) so the currency/units logic lives in ONE
 * place. All money fields are RUPEES (the Order model stores rupees, not paise),
 * so values pass through with NO /100 conversion.
 */
import type { PurchasePayload } from './PurchaseTracker';

export interface ItemForPurchase {
  product?: { _id?: string; name?: string } | string | null;
  name?: string;
  price?: number; // rupees
  quantity?: number;
}

export interface OrderForPurchase {
  _id: string;
  totalAmount?: number; // rupees
  items?: ItemForPurchase[];
}

export function itemProductId(item: ItemForPurchase): string {
  if (item.product && typeof item.product === 'object') return item.product._id ?? '';
  if (typeof item.product === 'string') return item.product;
  return '';
}

export function itemName(item: ItemForPurchase): string {
  if (item.product && typeof item.product === 'object' && item.product.name) return item.product.name;
  return item.name ?? 'Item';
}

/**
 * Build the gtag purchase payload. `sendTo` routes it to the Ads conversion
 * action; pass '' to omit it (non-prod). Numeric fields are guarded so a
 * malformed order never emits `value: undefined`/`NaN`.
 */
export function buildPurchasePayload(order: OrderForPurchase, sendTo: string): PurchasePayload {
  return {
    ...(sendTo ? { send_to: sendTo } : {}),
    transaction_id: order._id,
    value: Number(order.totalAmount) || 0, // rupees — do NOT divide by 100
    currency: 'INR',
    items: (order.items ?? []).map((item) => ({
      item_id: itemProductId(item),
      item_name: itemName(item),
      price: Number(item.price) || 0, // rupees — do NOT divide by 100
      quantity: item.quantity ?? 1,
    })),
  };
}
