/** Shapes returned by /staff/work (Back-end services/teamWorkflowService.js). */

export type WorkQueue = 'procurement' | 'decisions' | 'refunds' | 'deliveries';

/** Courier progress on a parcel in transit (Back-end utils/parcelSteps.js). */
export type ParcelStepStatus = 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivery_failed';
export const PARCEL_STEP_OPTIONS: { value: ParcelStepStatus; label: string }[] = [
  { value: 'picked_up', label: 'Picked up' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivery_failed', label: 'Delivery failed' },
];

export type LineStage =
  | 'stock_check' | 'to_ship' | 'own_stock' | 'payment_pending' | 'with_supplier' | 'customer_decision'
  | 'accounts_approval' | 'shipped' | 'delivered' | 'cancelled';

export type LineAction =
  | 'in_stock' | 'own_stock' | 'ordered' | 'out_of_stock' | 'ship' | 'dispatch_own' | 'wait' | 'refund' | 'approve' | 'reject'
  | 'payment_initiated' | 'payment_undo' | 'stock_undo' | 'decision_undo';

/** A parcel in transit against its expected delivery date (Back-end utils/parcelEta.js). */
export type EtaState = 'none' | 'upcoming' | 'due_today' | 'overdue';

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
  /** The stage behind `summary` — colours the order's pill like the stage itself. */
  summaryStage?: LineStage | null;
  needs: string[];
  /** Parcels in transit vs their expected delivery date; null when none is in transit. */
  eta?: { overdue: number; dueToday: number; missing: number; earliest: string | null } | null;
  lines: {
    itemId: string;
    /** Catalogue product — for the "open on the website" link. */
    productId?: string | null;
    variantId?: string | null;
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
    stock: 'pending' | 'in_stock' | 'own_stock' | 'ordered' | 'out_of_stock' | null;
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
    /** Marked delivered by mistake: operations / admin can put it back in transit. */
    canUndoDelivered?: boolean;
    /** The first proof — the WhatsApp message promises a photo only when there is one. */
    photoUrl: string | null;
    /** Every proof (photos and PDFs), oldest first, each through the staff-only proxy. Absent from an older server. */
    photos?: { id: string; url: string; contentType: string; name: string }[];
    canMarkDelivered: boolean;
    /** Dispatch details can still be corrected (any time while the parcel is in transit). */
    canEdit?: boolean;
    /** Courier progress, newest first (operations adds while in transit). */
    steps?: { status: ParcelStepStatus; label: string; note: string; at: string; by: string }[];
    /** Compare-and-set token: sent back with a new step so a double press adds one. */
    stepCount?: number;
    canAddStep?: boolean;
    /** The team's expected delivery date ('YYYY-MM-DD', India) — never shown to the customer. */
    eta?: { date: string; setBy: string; setAt: string | null } | null;
    /** null when the parcel is not in transit. */
    etaState?: EtaState | null;
    /** Date changes, newest first. */
    etaHistory?: { from: string; to: string; by: string; at: string }[];
    /** Procurement, operations or admin, while in transit. */
    canSetEta?: boolean;
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
  history: {
    at: string; by: string; team: string; action: string; item: string; note: string;
    /** Raw action ('stock_in_stock', 'delivered'…) and its line, for the journey tracker. */
    code?: string; itemId?: string | null;
  }[];
  canShip: boolean;
  /** Procurement may dispatch "Our Warehouse" items (courier + tracking, no supplier). */
  canDispatchOwn: boolean;
  /** Seller, sales head or admin — shows the "Send to customer" WhatsApp button. */
  canContactCustomer: boolean;
  /** Accounts or admin — the customer's saved bank account for refunds / NEFT. */
  canSeeCustomerBank?: boolean;
  /** GTM seller, operations or admin, on a paid order that reached the customer. */
  canRaiseReturn?: boolean;
};

/*
  The six stages procurement works through, each with its own colour:
    New Order (orange) → In Stock (yellow) → Payment Pending (red)
    → Ordered From Supplier (dark yellow) → Dispatched (green) → Delivered (dark green)
  Our own warehouse (teal) skips the supplier steps: New Order → Our Warehouse → Dispatched.
  Out-of-stock / refund stages keep their own (pink / purple) so they never
  read as a step of the normal flow.
*/
export const STAGE_TONE: Record<LineStage, string> = {
  stock_check: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300',
  to_ship: 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300',
  own_stock: 'bg-teal-100 text-teal-800 ring-1 ring-teal-300',
  payment_pending: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  with_supplier: 'bg-amber-300 text-amber-950 ring-1 ring-amber-500',
  customer_decision: 'bg-pink-100 text-pink-800',
  accounts_approval: 'bg-purple-100 text-purple-800',
  shipped: 'bg-green-100 text-green-800 ring-1 ring-green-300',
  delivered: 'bg-green-700 text-white',
  cancelled: 'bg-gray-200 text-gray-700',
};

