/** Shapes returned by /staff/work (Back-end services/teamWorkflowService.js). */

export type WorkQueue = 'procurement' | 'decisions' | 'refunds' | 'deliveries';

export type LineStage =
  | 'stock_check' | 'to_ship' | 'with_supplier' | 'customer_decision'
  | 'accounts_approval' | 'shipped' | 'delivered' | 'cancelled';

export type LineAction =
  | 'in_stock' | 'ordered' | 'out_of_stock' | 'ship' | 'wait' | 'refund' | 'approve' | 'reject'
  | 'payment_initiated' | 'payment_undo';

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
  }[];
  cancellations: {
    id: string;
    items: { name: string; quantity: number }[];
    reason: string;
    cancelledAt: string | null;
    refundStatus: string | null;
    refundAmount: number | null;
  }[];
  history: { at: string; by: string; team: string; action: string; item: string; note: string }[];
  canShip: boolean;
  /** Seller, sales head or admin — shows the "Send to customer" WhatsApp button. */
  canContactCustomer: boolean;
};

export const STAGE_TONE: Record<LineStage, string> = {
  stock_check: 'bg-amber-100 text-amber-800',
  to_ship: 'bg-blue-100 text-blue-800',
  with_supplier: 'bg-indigo-100 text-indigo-800',
  customer_decision: 'bg-red-100 text-red-800',
  accounts_approval: 'bg-purple-100 text-purple-800',
  shipped: 'bg-sky-100 text-sky-800',
  delivered: 'bg-green-100 text-green-800',
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
