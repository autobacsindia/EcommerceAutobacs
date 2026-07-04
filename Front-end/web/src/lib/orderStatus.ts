/**
 * Customer-facing order status presentation helpers (obsidian + gold theme).
 *
 * These are the DARK-theme badge styles used on the storefront (/orders,
 * /orders/[id], /profile). Do NOT confuse with ORDER_STATUS_COLORS in
 * lib/constants.ts, which are the light-theme chips used in the admin panel.
 */

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-400',
  confirmed: 'bg-gold/10 text-gold',
  processing: 'bg-gold/10 text-gold',
  shipped: 'bg-orange-500/10 text-orange-400',
  delivered: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  refunded: 'bg-obsidian-raised text-ink/70',
  failed: 'bg-red-500/10 text-red-400',
};

/** Tailwind classes for a storefront status badge. */
export function getOrderStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status] || 'bg-obsidian-raised text-ink/70';
}

/** Human-readable status label (capitalized). */
export function getOrderStatusLabel(status: string): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '';
}
