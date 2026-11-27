/**
 * Which panel orders count as revenue — shared by services/companyRevenueService.js
 * and services/unbilledReceiptService.js so both use one rule (and neither
 * imports the other).
 */
import { SALE_STATUSES } from '../utils/orderStatusGroups.js';

/** A panel order that counts as revenue: a real sale, not refunded. */
export const countedOrderFilter = (from) => ({
  status: { $in: [...SALE_STATUSES] },
  paymentStatus: { $ne: 'refunded' },
  ...(from ? { createdAt: { $gte: from } } : {}),
});
