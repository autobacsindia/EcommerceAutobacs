/** Shapes returned by /staff/work (Back-end services/teamWorkflowService.js). */

export type WorkQueue = 'procurement' | 'decisions' | 'refunds' | 'deliveries';

export type LineStage =
  | 'stock_check' | 'to_ship' | 'payment_pending' | 'with_supplier' | 'customer_decision'
  | 'accounts_approval' | 'shipped' | 'delivered' | 'cancelled';

export type LineAction =
  | 'in_stock' | 'ordered' | 'out_of_stock' | 'ship' | 'wait' | 'refund' | 'approve' | 'reject'
  | 'payment_initiated' | 'payment_undo' | 'stock_undo' | 'decision_undo';

export type WorkRow = {
  id: string;
  orderNumber: string;
  createdAt: string;
  enteredAt: string | null;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  source: 'sales' | 'website';
  soldBy: string;
  customer: { name: string; email: string; phone: string };
  city: string;
  summary: string | null;
  needs: string[];
  lines: {
    itemId: string;
    name: string;
    variantLabel: string | null;
    quantity: number;
    price: number;
    stage: LineStage | null;
    stageLabel: string | null;
  }[];
};

export type WorkOrder = Omit<WorkRow, 'lines'> & {
  inWorkflow: boolean;
  owesGoodie: boolean;
  shippingAddress: {
    fullName?: string; phone?: string; addressLine1?: string; addressLine2?: string;
    city?: string; state?: string; postalCode?: string;
  } | null;
  payment: { razorpayPaymentId: string | null; method: string | null } | null;
  lines: (WorkRow['lines'][number] & {
    stock: 'pending' | 'in_stock' | 'ordered' | 'out_of_stock' | null;
    supplierName: string;
    /** Procurement marked the supplier payment as started (in-stock items). Status only. */
    paymentInitiatedAt: string | null;
    refundRequestedAt: string | null;
    accountsApprovedAt: string | null;
    unshipped: number;
    actions: LineAction[];
  })[];
  parcels: {
    id: string;
    sequence: number;
    status: 'packed' | 'shipped' | 'delivered' | 'lost';
    courier: string;
    trackingNumber: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    items: { name: string; quantity: number }[];
    photoUrl: string | null;
    canMarkDelivered: boolean;
    /** Dispatch details can still be corrected (30 minutes after upload). */
    canEdit?: boolean;
  }[];
  cancellations: {
    id: string;
    items: { name: string; quantity: number }[];
    reason: string;
    cancelledAt: string | null;
    refundStatus: string | null;
    refundAmount: number | null;
    /** Why the last send failed (shown to the team). */
    refundFailure: string;
    /** Accounts (or admin): this out-of-stock refund can be sent / retried from here. */
    canSendRefund: boolean;
  }[];
  history: { at: string; by: string; team: string; action: string; item: string; note: string }[];
  canShip: boolean;
  /** Seller, sales head or admin — shows the "Send to customer" WhatsApp button. */
  canContactCustomer: boolean;
  /** Accounts or admin — the customer's saved bank account for refunds / NEFT. */
  canSeeCustomerBank?: boolean;
};

/*
  The six stages procurement works through, each with its own colour:
    New Order (orange) → In Stock (yellow) → Payment Pending (red)
    → Ordered From Supplier (dark yellow) → Dispatched (green) → Delivered (dark green)
  Out-of-stock / refund stages keep their own (pink / purple) so they never
  read as a step of the normal flow.
*/
export const STAGE_TONE: Record<LineStage, string> = {
  stock_check: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300',
  to_ship: 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300',
  payment_pending: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  with_supplier: 'bg-amber-300 text-amber-950 ring-1 ring-amber-500',
  customer_decision: 'bg-pink-100 text-pink-800',
  accounts_approval: 'bg-purple-100 text-purple-800',
  shipped: 'bg-green-100 text-green-800 ring-1 ring-green-300',
  delivered: 'bg-green-700 text-white',
  cancelled: 'bg-gray-200 text-gray-700',
};

/**
 * Shrink a phone photo before upload: longest side ≤ 1800px, JPEG. A 6 MB camera
 * photo becomes a few hundred KB, which matters on mobile data — and keeps it well
 * under the server's 8 MB cap. Falls back to the original file if the browser
 * cannot decode it.
 */
export async function shrinkPhoto(file: File, maxSide = 1800, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob || file;
  } catch {
    return file;
  }
}
