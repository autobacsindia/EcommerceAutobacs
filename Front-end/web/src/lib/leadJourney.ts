/**
 * Journey builder — merges a lead's activities, re-engagement signals and order
 * history into a single reverse-chronological rail, grouped by sales cycle.
 *
 * It is a pure function (no I/O) so the ordering/attribution rules — the only
 * non-trivial logic on the lead-detail screen — can be unit-tested in isolation.
 * See ADR-006 for the reopen-with-history model this rides on: on reopen, a
 * lead's `sources` are archived into `cycles[]` and reset, but `activities`
 * stay one flat, append-only stream — so activities are attributed to a cycle by
 * timestamp, while archived signals already belong to their cycle.
 */
import type { Lead, LeadCycle, LeadSource, LeadSourceType, LeadStatus, OrderHistoryItem } from './leads';

export type JourneyEvent =
  | { kind: 'signal'; at: number; sourceType: LeadSourceType; snapshot?: Record<string, unknown> }
  | {
      kind: 'order';
      at: number;
      orderId: string;
      orderNumber?: string;
      total?: number;
      status: string;
      paymentStatus?: string;
      cancelledBy?: string | null;
    }
  | { kind: 'activity'; at: number; activityType: string; notes?: string; actor?: string };

export interface JourneyGroup {
  cycleNo: number;
  /** 'open' while the cycle is live; otherwise how it closed. */
  outcome: LeadStatus | 'open';
  start?: number;
  end?: number;
  rep?: string;
  lostReason?: string;
  primarySource?: LeadSourceType;
  events: JourneyEvent[];
}

/** Parse an ISO/Date to epoch ms; `fallback` when absent/invalid so sorts never NaN. */
function ts(v?: string | Date | null, fallback = 0): number {
  if (!v) return fallback;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : fallback;
}

function repName(rep: { name?: string } | string | null | undefined): string | undefined {
  return rep && typeof rep === 'object' ? rep.name : undefined;
}

function refId(ref: { _id: string } | string | null | undefined): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'object' ? ref._id : ref;
}

function actorOf(a: Lead['activities'][number]): string | undefined {
  return repName(a.rep) ?? (a.by && typeof a.by === 'object' ? a.by.name : undefined);
}

function signalEvent(s: LeadSource): JourneyEvent {
  return { kind: 'signal', at: ts(s.capturedAt), sourceType: s.type, snapshot: s.snapshot };
}

/** Internal cycle window: an ordered slice of the timeline that owns events. */
type Win = JourneyGroup;

/**
 * Build the cycle-grouped journey, newest cycle first and newest event first
 * within each cycle. First-time leads (no reopen, no archived cycles) come back
 * as a single group — the caller decides whether to render a cycle header.
 */
export function buildJourney(lead: Lead, orderHistory: OrderHistoryItem[] = []): JourneyGroup[] {
  const archived = lead.cycles ?? [];

  // Windows in chronological order: each archived cycle, then the live one.
  const windows: Win[] = archived.map((c, i) => ({
    cycleNo: i + 1,
    outcome: c.outcome ?? 'lost',
    start: ts(c.startedAt),
    end: ts(c.closedAt, Number.POSITIVE_INFINITY),
    rep: repName(c.assignedRep),
    lostReason: c.lostReason,
    primarySource: c.primarySource,
    events: [],
  }));

  const isTerminal = lead.status === 'won' || lead.status === 'lost';
  windows.push({
    // Number the live cycle off reopenCount so it matches the page header's
    // "Cycle #{reopenCount+1}" even if reopenCount and cycles.length ever drift.
    cycleNo: (lead.reopenCount ?? archived.length) + 1,
    outcome: isTerminal ? lead.status : 'open',
    start: ts(lead.cycleStartedAt, ts(lead.createdAt)),
    end: Number.POSITIVE_INFINITY,
    rep: repName(lead.assignedRep),
    lostReason: lead.lostReason,
    primarySource: lead.primarySource,
    events: [],
  });

  const current = windows[windows.length - 1];
  const byCycleNo = new Map<number, Win>(windows.map((w) => [w.cycleNo, w]));

  // Authoritative order→cycle links: which cycle referenced an order as a
  // signal (payment_*/order_cancelled carry refModel 'Order') or as its
  // conversion. Walk oldest→newest so the *latest* cycle that touched an order
  // wins — a won order later cancelled belongs to the reopen cycle, not the
  // Won one it once closed. Falls back to timestamp for orders the CRM never
  // referenced (a purchase with no lead signal).
  const orderCycle = new Map<string, number>();
  const linkOrders = (sources: LeadSource[] | undefined, converted: LeadCycle['convertedOrder'], cycleNo: number) => {
    (sources ?? []).forEach((s) => {
      if (s.refModel !== 'Order') return;
      const id = refId(s.ref as { _id: string } | string | null | undefined);
      if (id) orderCycle.set(id, cycleNo);
    });
    const cid = refId(converted ?? null);
    if (cid) orderCycle.set(cid, cycleNo);
  };
  archived.forEach((c, i) => linkOrders(c.sources, c.convertedOrder, i + 1));
  linkOrders(lead.sources, lead.convertedOrder, current.cycleNo);

  // Pick the cycle a timestamp falls into: the latest window that opened at or
  // before it. Events before the first cycle fall into the earliest window.
  const assign = (at: number): Win => {
    let chosen = windows[0];
    for (const w of windows) {
      if ((w.start ?? 0) <= at && (w.start ?? 0) >= (chosen.start ?? 0)) chosen = w;
    }
    return chosen;
  };

  // Signals: archived ones already belong to their cycle; live ones to current.
  archived.forEach((c, i) => {
    (c.sources ?? []).forEach((s) => windows[i].events.push(signalEvent(s)));
  });
  (lead.sources ?? []).forEach((s) => current.events.push(signalEvent(s)));

  // Activities are one global stream → attribute by timestamp.
  (lead.activities ?? []).forEach((a) => {
    const at = ts(a.at);
    assign(at).events.push({ kind: 'activity', at, activityType: a.type, notes: a.notes, actor: actorOf(a) });
  });

  // Orders: place by the cycle that referenced them; else by date.
  orderHistory.forEach((o) => {
    const at = ts(o.createdAt);
    const linked = orderCycle.get(o._id);
    const win = (linked != null ? byCycleNo.get(linked) : undefined) ?? assign(at);
    win.events.push({
      kind: 'order',
      at,
      orderId: o._id,
      orderNumber: o.orderNumber,
      total: o.totalAmount,
      status: o.status,
      paymentStatus: o.paymentStatus,
      cancelledBy: o.cancelledBy,
    });
  });

  // Newest event first within a cycle; newest cycle first overall.
  windows.forEach((w) => w.events.sort((a, b) => b.at - a.at));
  windows.reverse();

  return windows;
}
