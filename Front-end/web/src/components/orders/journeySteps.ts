/**
 * An order's journey, one row per product line, as steps an admin can read left
 * to right: Paid → New Order → In Stock → Payment Pending → Ordered From
 * Supplier → Dispatched → Delivered (or, from our own warehouse, New Order →
 * Our Warehouse → Dispatched). Out of stock / refund is a side branch, never a
 * step of the normal flow.
 *
 * Where each line IS comes from the server (`line.stage`, derived from the
 * workflow, parcels and cancellations — Back-end utils/teamWorkflow.js). This
 * file only lays the path out around it and pins who/when onto each step from
 * the workflow history. Pure: no I/O, no clock.
 */
import type { LineStage, WorkOrder } from '@/components/staff/work/types';

export type StepKey = 'paid' | LineStage;
export type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

export type JourneyStep = {
  key: StepKey;
  label: string;
  state: StepState;
  /** When the line reached this step, and who moved it there (from the history). */
  at: string | null;
  by: string | null;
  team: string | null;
  note: string | null;
};

export type JourneyLine = {
  itemId: string;
  name: string;
  quantity: number;
  steps: JourneyStep[];
  /** Out of stock → customer decision → refund approval → cancelled. Null when the line never left the normal path. */
  branch: JourneyStep[] | null;
};

const LABEL: Record<StepKey, string> = {
  paid: 'Paid',
  stock_check: 'New Order',
  to_ship: 'In Stock',
  own_stock: 'Our Warehouse',
  payment_pending: 'Payment Pending',
  with_supplier: 'Ordered From Supplier',
  shipped: 'Dispatched',
  delivered: 'Delivered',
  customer_decision: 'Out of stock — ask customer',
  accounts_approval: 'Refund — waiting for accounts',
  cancelled: 'Cancelled / refunded',
};

const SUPPLIER_PATH: StepKey[] = ['paid', 'stock_check', 'to_ship', 'payment_pending', 'with_supplier', 'shipped', 'delivered'];
const WAREHOUSE_PATH: StepKey[] = ['paid', 'stock_check', 'own_stock', 'shipped', 'delivered'];
const BRANCH: StepKey[] = ['customer_decision', 'accounts_approval', 'cancelled'];

/** The history actions that move a line INTO each step (Back-end services/teamWorkflowService.js). */
const ARRIVES_BY: Record<StepKey, string[]> = {
  paid: ['entered'],
  stock_check: ['entered', 'customer_waits', 'stock_undone', 'decision_undone'],
  to_ship: ['stock_in_stock'],
  own_stock: ['stock_own_stock'],
  payment_pending: ['payment_pending'],
  with_supplier: ['stock_ordered'],
  shipped: ['shipped', 'shipped_own'], // narrowed per path in arrival()
  delivered: ['delivered'],
  customer_decision: ['stock_out_of_stock', 'refund_rejected'],
  accounts_approval: ['refund_requested'],
  cancelled: ['refund_approved', 'refund_sent'],
};

type History = WorkOrder['history'];

/**
 * The latest history entry that moved this line into `key` (order-wide entries
 * count for every line). Dispatch is order-wide but path-specific: a warehouse
 * line leaves with "shipped_own", a supplier line with "shipped" — taking either
 * would stamp one parcel's time on the other line.
 */
function arrival(history: History, itemId: string, key: StepKey, viaWarehouse: boolean) {
  const codes = key === 'shipped' ? [viaWarehouse ? 'shipped_own' : 'shipped'] : ARRIVES_BY[key];
  // The API sends history newest first.
  return history.find((h) => h.code && codes.includes(h.code) && (!h.itemId || h.itemId === itemId)) ?? null;
}

/** Normal-path steps a line can pass by: paying the supplier straight from New Order never visits "In Stock". */
const SKIPPABLE = new Set<StepKey>(['to_ship', 'payment_pending', 'with_supplier']);

function step(history: History, itemId: string, key: StepKey, state: StepState, viaWarehouse = false): JourneyStep {
  const h = state === 'upcoming' ? null : arrival(history, itemId, key, viaWarehouse);
  return {
    key,
    label: LABEL[key],
    // Gone past with nothing recorded for it: skipped, not done.
    state: state === 'done' && !h && SKIPPABLE.has(key) ? 'skipped' : state,
    at: h?.at ?? null,
    by: h ? h.by : null,
    team: h?.team || null,
    note: h?.note || null,
  };
}

export function buildJourney(order: Pick<WorkOrder, 'inWorkflow' | 'lines' | 'history'>): JourneyLine[] {
  if (!order.inWorkflow) return [];
  const history = order.history || [];

  return order.lines.map((line) => {
    const stage: LineStage = line.stage ?? 'stock_check';
    const viaWarehouse = stage === 'own_stock' || line.stock === 'own_stock'
      || history.some((h) => h.code === 'stock_own_stock' && h.itemId === line.itemId);
    const path = viaWarehouse ? WAREHOUSE_PATH : SUPPLIER_PATH;
    const inBranch = BRANCH.includes(stage);
    const wentOutOfStock = history.some((h) => h.code === 'stock_out_of_stock' && h.itemId === line.itemId);

    // On the branch, the normal path stopped at New Order.
    const at = inBranch ? path.indexOf('stock_check') : path.indexOf(stage);
    const finished = stage === 'delivered';
    const steps = path.map((key, i) => {
      if (inBranch) return step(history, line.itemId, key, i <= at ? 'done' : 'upcoming', viaWarehouse);
      if (i < at || (i === at && finished)) return step(history, line.itemId, key, 'done', viaWarehouse);
      return step(history, line.itemId, key, i === at ? 'current' : 'upcoming', viaWarehouse);
    });

    let branch: JourneyStep[] | null = null;
    if (inBranch) {
      // A cancellation that never went through "out of stock" (an admin cancel)
      // is the last step alone, not a three-step story that did not happen.
      const keys = stage === 'cancelled' && !wentOutOfStock ? (['cancelled'] as StepKey[]) : BRANCH;
      const b = keys.indexOf(stage);
      branch = keys.map((key, i) => step(history, line.itemId, key,
        i < b || (i === b && stage === 'cancelled') ? 'done' : i === b ? 'current' : 'upcoming'));
    }

    return { itemId: line.itemId, name: line.name, quantity: line.quantity, steps, branch };
  });
}
