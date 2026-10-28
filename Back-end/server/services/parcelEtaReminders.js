/**
 * Morning reminders for parcels on their expected delivery date (utils/parcelEta.js).
 *
 * Every working morning (cronService.scheduleEtaReminders, 09:00 IST Mon–Sat) each
 * parcel still in transit whose date is TODAY gets "please update the delivery
 * status", and each one whose date has PASSED gets the same marked OVERDUE — every
 * morning until someone marks it delivered or sets a new date. A Sunday date is
 * therefore first reminded on Monday, as overdue by a day.
 *
 * ── WHO HEARS IT ────────────────────────────────────────────────────────────────
 * The person who set the latest date, @-mentioned in their own team's space (so it
 * pops up on their devices through chat's push). An admin's goes to #operations.
 * If that person has left (no longer active staff), it goes to #operations with
 * nobody mentioned — the whole team gets it, and someone picks it up.
 *
 * ── ONCE A DAY ──────────────────────────────────────────────────────────────────
 * Each post's idempotency key is `eta-<parcel>-<day>`, so running the job twice in
 * a day (two replicas, a restart, a manual re-run) posts each reminder ONCE. The
 * cron's per-day Redis marker only saves the second scan.
 *
 * ── BOUNDED ─────────────────────────────────────────────────────────────────────
 * Reads only OPEN workflow orders (an order with a parcel in transit is open — it
 * waits on operations), keyset-paged on the partial `team_workflow_open` index,
 * stopping at MAX_ORDERS. No new index.
 */
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { istDay, daysBetween, formatEtaDay, etaState } from '../utils/parcelEta.js';

export const MAX_ORDERS = 5000;
const PAGE = 100;
const FALLBACK_SPACE = 'team:operations';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** Every parcel in transit whose date is today or earlier: [{ order, parcel, overdueDays }]. */
export async function collectDueParcels(today) {
  const due = [];
  let after = null;
  let scanned = 0;
  while (scanned < MAX_ORDERS) {
    const page = await orderRepository.findOpenWorkflowPage({ after, limit: PAGE });
    if (!page.length) break;
    for (const order of page) {
      for (const parcel of order.shipments || []) {
        const state = etaState(parcel, today);
        if (state !== 'due_today' && state !== 'overdue') continue;
        due.push({ order, parcel, overdueDays: daysBetween(parcel.eta.day, today) });
      }
    }
    scanned += page.length;
    const last = page[page.length - 1];
    after = { enteredAt: last.workflow.enteredAt, id: last._id };
    if (page.length < PAGE) break;
  }
  if (scanned >= MAX_ORDERS) {
    console.warn(`[eta-reminders] stopped at ${MAX_ORDERS} open orders — some reminders may be missing`);
  }
  return due;
}

/** Where a reminder goes, and who it mentions. */
export function recipientFor(parcel, activeById) {
  const setter = activeById.get(idOf(parcel.eta?.setBy));
  if (!setter) return { space: FALLBACK_SPACE, mention: null };
  const team = setter.role === 'staff' ? setter.staff?.team : null;
  return { space: STAFF_TEAM_VALUES.includes(team) ? `team:${team}` : FALLBACK_SPACE, mention: setter };
}

/** The chat text for one parcel. */
export function reminderText({ order, parcel, overdueDays }, mention) {
  const courier = [
    parcel.carrier?.name,
    parcel.trackingNumber ? `tracking ${parcel.trackingNumber}` : null,
  ].filter(Boolean).join(', ');
  const which = `order ${orderNumber(order)}, parcel ${parcel.sequence}${courier ? ` (${courier})` : ''}`;
  const who = mention
    ? `@${mention.name} `
    : `${parcel.eta?.setByName ? `${parcel.eta.setByName} set this date and is no longer on the team. ` : ''}Operations: `;
  const next = 'please check with the courier, then mark it delivered or set a new expected date.';
  if (overdueDays > 0) {
    const days = overdueDays === 1 ? '1 day' : `${overdueDays} days`;
    return `⚠️ OVERDUE by ${days}: ${which} was expected on ${formatEtaDay(parcel.eta.day)} and is still in transit. ${who}${next}`;
  }
  return `⏰ Please update the delivery status — today is the expected delivery date for ${which}. ${who}${next}`;
}

/**
 * Post today's reminders. Returns { due, posted, failed }. A failed post
 * (postSystemMessage never throws; it returns null) is counted, and a later run
 * the same day posts it — the ones that went out are not repeated.
 */
export async function postEtaReminders(now = Date.now()) {
  const today = istDay(now);
  const due = await collectDueParcels(today);
  if (!due.length) return { due: 0, posted: 0, failed: 0 };

  const setterIds = [...new Set(due.map((d) => idOf(d.parcel.eta?.setBy)).filter(Boolean))];
  const activeById = new Map((await userRepository.findChatUsersByIds(setterIds)).map((u) => [idOf(u), u]));

  let posted = 0;
  let failed = 0;
  for (const d of due) {
    const { space, mention } = recipientFor(d.parcel, activeById);
    const msg = await postSystemMessage(space, reminderText(d, mention), {
      key: `eta-${idOf(d.parcel._id)}-${today}`,
      orderIds: [idOf(d.order._id)],
      mentions: mention ? [idOf(mention)] : [],
      threadOrder: idOf(d.order._id),
    });
    if (msg) posted += 1;
    else failed += 1;
  }
  return { due: due.length, posted, failed };
}
