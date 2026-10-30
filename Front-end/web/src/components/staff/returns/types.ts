/**
 * Shapes of /api/v1/staff/returns (Back-end/server/services/returnService.js). Money is
 * always the server's: these screens display amounts, they never work one out.
 */

export type ReturnFault = 'ours' | 'customer';

export type ReturnQueue = 'review' | 'pickup' | 'inspect' | 'supplier_pickup' | 'refund' | 'supplier' | 'mine' | 'all';

export interface ReturnRow {
  id: string;
  ref: string;
  orderId: string;
  orderNumber: string | null;
  customer: string;
  items: { name: string; quantity: number; reason: string; reasonLabel: string; fault: ReturnFault }[];
  status: 'pending' | 'approved' | 'courier_booked' | 'received' | 'refunded' | 'rejected' | 'cancelled';
  stage: string;
  origin: 'customer' | 'admin_offline' | 'staff';
  destination: 'warehouse' | 'supplier' | null;
  supplierName: string | null;
  pickupMode: 'courier' | 'dropped_at_store' | 'supplier_direct' | null;
  pickupAttempts: number;
  refund: { status: string; amount: number };
  claims: { id: string; supplierName: string; status: string }[];
  createdAt: string;
  ageDays: number;
}

export interface SupplierClaim {
  _id: string;
  status: 'open' | 'accepted' | 'rejected' | 'promised' | 'settled';
  supplierName: string;
  paymentRequestRef?: string | null;
  answer?: { accepted: boolean | null; reference?: string | null; note?: string | null; byName?: string; at?: string | null };
  shipBack?: { courier?: string | null; trackingNumber?: string | null; byName?: string; at?: string | null };
  supplierCheck?: { passed: boolean | null; notes?: string | null; byName?: string; at?: string | null };
  settlement?: {
    kind: 'credit_note' | 'refund' | 'free_replacement' | null;
    amountPaise: number | null;
    reference?: string | null;
    promisedAt?: string | null;
    promisedByName?: string;
    received?: { method: 'bank' | 'deducted' | null; utr?: string | null; deductedFromRef?: string | null; note?: string | null; byName?: string; at?: string | null };
  };
  loss?: { recorded: boolean; note?: string | null };
}

export interface ReturnDetail extends ReturnRow {
  problemDescription: string;
  raisedBy: string | null;
  customerContact: { name: string; phone: string; email: string };
  seller: string;
  lines: {
    orderItemId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    reason: string;
    reasonLabel: string;
    fault: { claimed: ReturnFault; confirmed: ReturnFault | null; note: string | null };
  }[];
  evidence: { video: { url: string } | null; proofOfPurchase: { url: string } | null; images: { url: string }[] };
  files: { id: string; purpose: string; claimId: string | null; name: string; contentType: string }[];
  destinationOptions: { default: 'warehouse'; suppliers: string[] };
  courier: { provider?: string; trackingNumber?: string; bookedAt?: string } | null;
  pickup: { mode: string | null; bookedBy: 'us' | 'supplier' | null; note?: string | null } | null;
  pickupAttemptsList: { at: string; note?: string }[];
  inspection: {
    passed: boolean | null; notes?: string; disposition?: string | null; failAction?: string | null; holdUntil?: string | null;
    supplierCheck?: { passed: boolean | null; notes?: string | null; byName?: string };
  } | null;
  rejectionReason: string | null;
  refundDetail: {
    status?: string; finalAmount?: number; productValue?: number; shippingShare?: number;
    pickupDeduction?: number; pickupDeductionReason?: string | null; creditNoteNo?: string | null;
    serviceLines?: { orderItemId: string; name: string; amountPaise: number }[];
    method?: string; reference?: string;
  } | null;
  refundRoute: 'gateway' | 'offline';
  supplierClaims: SupplierClaim[];
  repeatReturns: number;
  timeline: { status: string; note?: string; timestamp: string }[];
  can: {
    review: boolean; pickup: boolean; droppedAtStore: boolean; received: boolean; supplierCheck: boolean;
    inspect: boolean; refund: boolean; supplierClaims: boolean; supplierMoney: boolean;
  };
}

export interface RefundPreview {
  breakdown: { goodsGross: number; goodsNet: number; discountShare: number; shippingShare: number; service: number; pickupDeduction: number; restocking: number; total: number };
  refundNow: number;
  orderTotal: number;
  alreadyRefunded: number;
  maxRefundable: number;
  hasOurFault: boolean;
  hasCustomerFault: boolean;
  fullRefundOnly: boolean;
  paidBy: string | null;
  serviceLineOptions: { orderItemId: string; name: string; quantity: number; netPaid: number; alreadyRefunded: boolean }[];
  canSend: boolean;
  limit: number;
}

export const FAULT_LABEL: Record<ReturnFault, string> = { ours: 'Our fault', customer: "Customer's reason" };
export const FAULT_TONE: Record<ReturnFault, string> = {
  ours: 'bg-sky-100 text-sky-800',
  customer: 'bg-amber-100 text-amber-800',
};
export const DISPOSITION_OPTIONS = [
  { value: 'resell', label: 'Resell' },
  { value: 'open_box', label: 'Sell as open-box' },
  { value: 'return_to_supplier', label: 'Send back to supplier' },
  { value: 'scrap', label: 'Scrap' },
] as const;
export const SETTLEMENT_LABEL: Record<string, string> = {
  credit_note: 'Credit note', refund: 'Refund to us', free_replacement: 'Free replacement',
};
export const CLAIM_STATUS_LABEL: Record<SupplierClaim['status'], string> = {
  open: 'Contact the supplier',
  accepted: 'Supplier accepted',
  rejected: 'Supplier rejected',
  promised: 'Money promised',
  settled: 'Settled',
};

/** The tabs each team works from (the server re-checks every one). */
export function tabsFor({ team, isHead, canSell, isAdmin }: { team: string; isHead: boolean; canSell: boolean; isAdmin: boolean }) {
  const t: { key: ReturnQueue | 'owed'; label: string }[] = [];
  const ops = isAdmin || team === 'operations';
  const proc = isAdmin || team === 'procurement';
  const acc = isAdmin || team === 'accounts';
  if (ops) t.push({ key: 'review', label: 'To check' }, { key: 'pickup', label: 'Pickups' }, { key: 'inspect', label: 'To inspect' });
  if (proc) t.push({ key: 'supplier_pickup', label: 'Going to suppliers' }, { key: 'supplier', label: 'Supplier claims' });
  if (proc || acc) t.push({ key: 'owed', label: 'Suppliers owe us' });
  // Accounts has its own Return refunds page; an admin has no /team, so it gets a tab.
  if (isAdmin) t.push({ key: 'refund', label: 'Refunds to send' });
  if (canSell) t.push({ key: 'mine', label: 'Mine' });
  if (isAdmin || ['operations', 'procurement', 'accounts'].includes(team) || (team === 'sales' && isHead)) t.push({ key: 'all', label: 'All returns' });
  return t;
}
