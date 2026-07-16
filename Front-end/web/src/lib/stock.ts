// Stock is a coarse availability status, not a numeric quantity. The backend
// stores 'in' | 'low' | 'out' | 'backorder'; the storefront only ever shows the label.
//
// Some legacy/WooCommerce-synced payloads may still expose a numeric `stock`
// or a WooCommerce-style `stock_status` ('instock'|'outofstock'). The helpers
// below normalize all of those into a single StockStatus so UI code never has
// to branch on the shape.

// 'backorder' = not on hand but still orderable (ships when restocked).
export type StockStatus = 'in' | 'low' | 'out' | 'backorder';

export const STOCK_LABEL: Record<StockStatus, string> = {
  in: 'In Stock',
  low: 'Low Stock',
  out: 'Out of Stock',
  backorder: 'On Backorder',
};

type StockBearing = {
  stock?: StockStatus | string | number | null;
  stock_status?: string | null;
};

/** Normalize any product-ish payload to a StockStatus. Defaults to 'in'. */
export function getStockStatus(product: StockBearing | null | undefined): StockStatus {
  if (!product) return 'out';

  const raw = product.stock;

  if (raw === 'in' || raw === 'low' || raw === 'out' || raw === 'backorder') return raw;

  // Legacy numeric quantity (pre-migration or unsynced sources).
  if (typeof raw === 'number') {
    if (raw <= 0) return 'out';
    if (raw <= 5) return 'low';
    return 'in';
  }

  // WooCommerce-style flag as a fallback.
  if (product.stock_status === 'outofstock') return 'out';
  if (product.stock_status === 'onbackorder') return 'backorder';
  if (product.stock_status === 'instock') return 'in';

  return 'in';
}

export function isOutOfStock(product: StockBearing | null | undefined): boolean {
  return getStockStatus(product) === 'out';
}

export function isLowStock(product: StockBearing | null | undefined): boolean {
  return getStockStatus(product) === 'low';
}

export function isBackorder(product: StockBearing | null | undefined): boolean {
  return getStockStatus(product) === 'backorder';
}

/**
 * True when the item can be added to cart / purchased directly. Out of stock is
 * unavailable; backorder is enquiry-only (routed to the consultation flow), so
 * neither is directly purchasable.
 */
export function isPurchasable(product: StockBearing | null | undefined): boolean {
  const s = getStockStatus(product);
  return s !== 'out' && s !== 'backorder';
}

export function getStockLabel(product: StockBearing | null | undefined): string {
  return STOCK_LABEL[getStockStatus(product)];
}
