/**
 * The morning stuck-order digest — one team-chat post per team, listing the
 * orders that have sat too long at that team's step of the workflow.
 *
 * The workflow already knows every line's stage, and the per-event chat posts
 * announce each handoff as it happens. What neither does is REMIND: an
 * out-of-stock item whose customer was never called sits in the sales queue
 * forever, silently. This is that reminder — once a day, to the team that owns
 * the stuck step, with links to the orders.
 *
 * How long is "too long" is per stage (STUCK_AFTER_HOURS). A line's clock starts
 * at the last thing anyone did to THAT line (its latest workflow history entry),
 * or at the moment the order entered the workflow if nobody has touched it.
 * Parcels in transit are timed from when they shipped.
 *
 * Read-only and bounded: it pages the open-workflow index (team_workflow_open)
 * with a keyset cursor and stops at MAX_ORDERS. It posts with an idempotency key
 * per team per day, so two replicas, a lock expiry or a manual re-run cannot
 * post the same digest twice. A team with nothing stuck gets no post — a daily
 * "all clear" would teach people to ignore the digest.
 */
import orderRepository from '../repositories/orderRepository.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { workflowView, STAGE, STAGE_LABELS, STAGE_TEAM } from '../utils/teamWorkflow.js';
import { SHIPMENT_STATUS } from '../utils/orderFulfilment.js';

/** Hours a line may wait at each stage before the owning team is reminded. */
export const STUCK_AFTER_HOURS = Object.freeze({
  [STAGE.STOCK_CHECK]: 24,
  [STAGE.CUSTOMER_DECISION]: 48,
  [STAGE.ACCOUNTS_APPROVAL]: 24,
  [STAGE.TO_SHIP]: 48,
  [STAGE.PAYMENT_PENDING]: 24, // accounts / admin to approve and pay
  [STAGE.WITH_SUPPLIER]: 120,
  [STAGE.SHIPPED]: 168, // a parcel in transit for a week
});

/** The team that owns a parcel in transit (not a line stage, so not in STAGE_TEAM). */
const TRANSIT_TEAM = 'operations';

const DIGEST_ORDER = [
  STAGE.STOCK_CHECK, STAGE.CUSTOMER_DECISION, STAGE.ACCOUNTS_APPROVAL,
  STAGE.TO_SHIP, STAGE.PAYMENT_PENDING, STAGE.WITH_SUPPLIER, STAGE.SHIPPED,
];

const PAGE = 100;
export const MAX_ORDERS = 5000;
const EXAMPLES_PER_STAGE = 3;
const MAX_REFS = 5; // chatService links at most five orders per message

const HOUR = 3600 * 1000;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** "30h" under three days, "4d" after. */
const age = (ms) => {
  const h = Math.floor(ms / HOUR);
  return h < 72 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

/** When each line of this order was last touched. */
function lastTouched(order) {
  const touched = new Map();
  for (const e of order.workflow?.history || []) {
    if (!e.itemId || !e.at) continue;
    const id = idOf(e.itemId);
    const at = new Date(e.at).getTime();
    if (!(touched.get(id) > at)) touched.set(id, at);
  }
  return touched;
}

/**
 * Everything one order is waiting on right now: [{ team, stage, since }], one
 * entry per stage (two lines at stock check count once, from the older line —
 * the team acts on the order, not the line). Shared with the admin Team activity
 * board (services/teamActivityService.js), so "waiting since" means the same
 * thing in both.
 */
export function waitingOn(order) {
  const view = workflowView(order);
  if (!view) return [];
  const entered = new Date(order.workflow.enteredAt).getTime();
  const touched = lastTouched(order);
  const oldest = new Map(); // stage → earliest `since`

  for (const line of view.lines) {
    if (!STAGE_TEAM[line.stage]) continue;
    const since = touched.get(line.itemId) ?? entered;
    if (!(oldest.get(line.stage) <= since)) oldest.set(line.stage, since);
  }
  for (const id of view.inTransitShipmentIds) {
    const parcel = (order.shipments || []).find((s) => idOf(s._id) === id);
    if (parcel?.status !== SHIPMENT_STATUS.SHIPPED) continue;
    const since = new Date(parcel.shippedAt || parcel.createdAt || entered).getTime();
    if (!(oldest.get(STAGE.SHIPPED) <= since)) oldest.set(STAGE.SHIPPED, since);
  }

  return [...oldest].map(([stage, since]) => ({
    team: stage === STAGE.SHIPPED ? TRANSIT_TEAM : STAGE_TEAM[stage], stage, since,
  }));
}

/** What is waiting past its stage's threshold: [{ team, stage, since }]. */
export function stuckOn(order, now = Date.now()) {
  return waitingOn(order).filter(({ stage, since }) => now - since >= STUCK_AFTER_HOURS[stage] * HOUR);
}

/** Scan the open workflow and group what is stuck: team → stage → [{ order, since }]. */
export async function collectStuck(now = Date.now()) {
  const byTeam = new Map();
  let after = null;
  let scanned = 0;
  while (scanned < MAX_ORDERS) {
    const page = await orderRepository.findOpenWorkflowPage({ after, limit: PAGE });
    if (!page.length) break;
    for (const order of page) {
      for (const { team, stage, since } of stuckOn(order, now)) {
        if (!byTeam.has(team)) byTeam.set(team, new Map());
        const stages = byTeam.get(team);
        if (!stages.has(stage)) stages.set(stage, []);
        stages.get(stage).push({ order, since });
      }
    }
    scanned += page.length;
    const last = page[page.length - 1];
    after = { enteredAt: last.workflow.enteredAt, id: last._id };
    if (page.length < PAGE) break;
  }
  if (scanned >= MAX_ORDERS) {
    console.warn(`[chat-digest] stopped at ${MAX_ORDERS} open orders — the digest may be incomplete`);
  }
  return byTeam;
}

/** One team's digest text and the orders it links (oldest first). */
export function digestText(stages, now = Date.now()) {
  const lines = [];
  const linked = [];
  const orders = new Set();
  for (const stage of DIGEST_ORDER) {
    const stuck = stages.get(stage);
    if (!stuck?.length) continue;
    stuck.sort((a, b) => a.since - b.since);
    stuck.forEach((s) => orders.add(idOf(s.order._id)));
    const examples = stuck.slice(0, EXAMPLES_PER_STAGE)
      .map((s) => `${orderNumber(s.order)} (${age(now - s.since)})`).join(', ');
    const more = stuck.length > EXAMPLES_PER_STAGE ? `, +${stuck.length - EXAMPLES_PER_STAGE} more` : '';
    const label = stage === STAGE.SHIPPED ? 'In transit' : STAGE_LABELS[stage];
    lines.push(`• ${label} for over ${age(STUCK_AFTER_HOURS[stage] * HOUR)}: ${stuck.length} — ${examples}${more}`);
    for (const s of stuck) {
      if (linked.length < MAX_REFS && !linked.includes(idOf(s.order._id))) linked.push(idOf(s.order._id));
    }
  }
  const total = orders.size;
  const head = `🌅 Morning check — ${total} order${total === 1 ? '' : 's'} waiting on this team longer than usual:`;
  return { text: [head, ...lines, 'Open the team panel to move them on.'].join('\n'), orderIds: linked };
}

/** The calendar day in India, for the once-a-day key. */
const istDay = (now) => new Date(now + 5.5 * HOUR).toISOString().slice(0, 10);

/**
 * Build and post today's digest for every team with something stuck.
 * Returns { team: messageId|null } for the teams it posted to.
 */
export async function postStuckDigests(now = Date.now()) {
  const byTeam = await collectStuck(now);
  const day = istDay(now);
  const posted = {};
  for (const [team, stages] of byTeam) {
    const { text, orderIds } = digestText(stages, now);
    const msg = await postSystemMessage(`team:${team}`, text, { key: `digest-${team}-${day}`, orderIds });
    posted[team] = msg?.id ?? null;
  }
  return posted;
}
