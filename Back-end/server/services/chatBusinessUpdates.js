/**
 * Automatic team-chat posts for business events.
 *
 * ── ONE RULE ────────────────────────────────────────────────────────────────────
 * Each event is posted once, in the space of the team that owns the NEXT step of
 * the order workflow (services/teamWorkflowService.js), and the text names who
 * must act. A team space is private to that team (chatService.canAccess), so a
 * post in the wrong space is not merely misplaced — the people it addresses
 * cannot see it. That is how "out of stock, Sales: ask the customer" once sat in
 * #procurement where no salesperson could read it.
 *
 *   event                         space          who acts next
 *   paid order                    #procurement   procurement — stock check
 *   out of stock                  #sales         the order's seller (website: sales heads)
 *   ordered from supplier         #sales         the seller — tell the customer
 *   customer will wait            #procurement   procurement — source it
 *   refund requested              #accounts      accounts — approve or send back
 *   refund sent back              #sales         the seller — follow up
 *   refund sent (out of stock)    #sales         the seller — tell the customer
 *   refund could not be sent      #accounts      accounts — retry it from the team panel
 *   refund failed at the gateway  #accounts      accounts or an admin — retry it
 *   shipped                       #operations    operations — follow to delivery
 *   delivered                     #sales         the seller — close the loop
 *   order cancelled               #procurement   procurement — stop sourcing
 *   consultation request          #sales         sales — follow up
 *
 * #company is never used: it is for people, not for the order feed.
 *
 * ── HOW THEY ARRIVE ─────────────────────────────────────────────────────────────
 * Events that already had an email ride that email's notification job: the job
 * finishes its email, then posts here. Workflow steps with no email use one
 * chat-only job, `post-team-chat-update`. Either way nothing is hooked into
 * checkout, payment or order code, and if chat is down the business event is
 * unaffected.
 *
 * ── IDEMPOTENCY ─────────────────────────────────────────────────────────────────
 * BullMQ retries jobs, so every post carries a key. Where an event can genuinely
 * happen twice (an item goes out of stock, is found, then goes out again) the key
 * includes the queue job id: a retry of one job reuses its id and posts once,
 * while a second real event is a second job and posts again.
 *
 * ── THREADS ─────────────────────────────────────────────────────────────────────
 * Each order is one thread per space. In #sales an order's out-of-stock alert
 * starts it; "ordered from supplier", "refund sent back" and "delivered" reply
 * under it, and people discuss the order in the same thread.
 *
 * ── MENTIONS ────────────────────────────────────────────────────────────────────
 * A post that needs one person (the seller on the order) @-mentions them, which
 * highlights it for them and lists it under their mentions. System posts never
 * email a mention: the event's own email has already gone to the same people.
 */
import { postSystemMessage } from './chatService.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import { orderNumber } from './invoiceService.js';
import { variantDisplayName } from '../utils/orderLines.js';

const SPACE = Object.freeze({
  sales: 'team:sales',
  procurement: 'team:procurement',
  accounts: 'team:accounts',
  operations: 'team:operations',
});

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const customerOf = (order) => order?.shippingAddress?.fullName || order?.user?.name || 'the customer';

/** The item line an event is about, by its id within the order. */
const itemName = (order, itemId) => {
  const item = (order?.items || []).find((i) => idOf(i._id) === String(itemId));
  return item ? variantDisplayName(item.name, item.variantLabel) : 'an item';
};

const soldBy = (order) => (order?.salesUser ? `sold by ${order.salesUser.name || 'the sales team'}` : 'website order');

/** Idempotency key: per event, plus the job id when the event can recur. */
const keyOf = (base, jobId) => (jobId ? `${base}-job-${jobId}` : base);

/**
 * Who on sales answers for this order: its seller, or — for a website order, or a
 * seller who has since left — the sales heads. Mirrors teamWorkflowService's
 * `can.decide`, so the person mentioned is a person who can act.
 */
async function salesOwners(order) {
  const people = await userRepository.findChatUsers();
  const sales = people.filter((u) => u.role === 'staff' && u.staff?.team === 'sales');
  const seller = order?.salesUser && sales.find((u) => idOf(u) === idOf(order.salesUser));
  return seller ? [seller] : sales.filter((u) => u.staff?.isHead);
}

const admins = async () => (await userRepository.findChatUsers()).filter((u) => u.role === 'admin');

/** "@Sam" / "@Sana @Ravi" — the names chat highlights, or a fallback when nobody fits. */
const address = (people, fallback) => (people.length ? people.map((u) => `@${u.name}`).join(' ') : fallback);

const loadOrder = (orderId) => orderRepository.findForWorkflow(orderId);

/**
 * Shared shape for an order post. Every update about one order in one space is
 * one thread (`threadOrder`): the first starts it, the rest reply to it, and a
 * reply brings the thread back to the bottom of the space.
 */
const orderPost = (order, { space, key, text, mention = [] }) => ({
  space, key, text, orderIds: [idOf(order._id)], mentions: mention.map(idOf), threadOrder: idOf(order._id),
});

/**
 * jobName → how it becomes a chat post. Each returns null when there is nothing
 * worth saying (record gone, order never reached the teams), and never throws on
 * a missing record.
 */
const UPDATES = {
  // Paid (website, payment link or sales panel — all three enqueue this). The
  // workflow starts with a stock check, which is procurement's.
  'send-staff-sales-paid-alert': async ({ orderId }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    return orderPost(order, {
      space: SPACE.procurement,
      key: `order-paid-${orderId}`,
      text: `🟢 Paid order ${orderNumber(order)} — ${inr(order.totalAmount)} — ${customerOf(order)} (${soldBy(order)}). Procurement: please check stock.`,
    });
  },

  // Procurement could not source a line. Only sales may record the customer's answer.
  'send-team-out-of-stock-alert': async ({ orderId, itemId }, { jobId }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const owners = await salesOwners(order);
    return orderPost(order, {
      space: SPACE.sales,
      key: keyOf(`out-of-stock-${orderId}-${itemId}`, jobId),
      mention: owners,
      text: `🟠 Out of stock on ${orderNumber(order)} — ${itemName(order, itemId)}. ${address(owners, 'GTM')}: ask ${customerOf(order)} whether they will wait or want a refund.`,
    });
  },

  // Sales recorded "refund". Accounts approves or sends it back.
  'send-team-refund-requested-alert': async ({ orderId, itemId }, { jobId }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    return orderPost(order, {
      space: SPACE.accounts,
      key: keyOf(`refund-requested-${orderId}-${itemId}`, jobId),
      text: `🔴 Refund requested on ${orderNumber(order)} — ${itemName(order, itemId)} — ${customerOf(order)}. Accounts: please approve or send it back.`,
    });
  },

  // Legacy: approvals used to wait for an admin to pay. Accounts now sends the refund
  // itself, so nothing enqueues this any more; kept so jobs already queued still run.
  'send-admin-team-refund-ready-alert': async ({ orderId, itemId }, { jobId }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const people = await admins();
    return orderPost(order, {
      space: SPACE.accounts,
      key: keyOf(`refund-approved-${orderId}-${itemId}`, jobId),
      mention: people,
      text: `✅ Refund approved on ${orderNumber(order)} — ${itemName(order, itemId)}. ${address(people, 'Admin')}: please pay it from Admin → Refunds.`,
    });
  },

  // The gateway rejected a refund: the customer is still owed money.
  'send-admin-refund-failed-alert': async ({ orderId }, { jobId }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const people = await admins();
    return orderPost(order, {
      space: SPACE.accounts,
      key: keyOf(`refund-failed-${orderId}`, jobId),
      mention: people,
      text: `⚠️ Refund FAILED at the payment gateway on ${orderNumber(order)} — ${customerOf(order)} is still owed money. Accounts (or ${address(people, 'Admin')}): please retry it from the order in the team panel or Admin → Refunds.`,
    });
  },

  // The supplier (or our own warehouse) has dispatched. Operations follows the parcel from here.
  'send-team-shipped-alert': async ({ orderId, shipmentId, fromWarehouse = false }) => {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const parcel = (order.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
    const detail = [parcel?.carrier?.name, parcel?.trackingNumber].filter(Boolean).join(' · ') || 'no tracking yet';
    return orderPost(order, {
      space: SPACE.operations,
      key: `shipped-${orderId}-${shipmentId}`,
      text: `📦 Shipped ${orderNumber(order)}${parcel?.sequence ? ` (parcel ${parcel.sequence})` : ''}${fromWarehouse ? ' from our warehouse' : ''} — ${detail}. Operations: please follow it to delivery.`,
    });
  },

  // A human cancelled the order. Only worth a post once the teams were working it.
  'send-admin-order-cancelled-alert': async ({ orderId }) => {
    const order = await loadOrder(orderId);
    if (!order?.workflow?.enteredAt) return null;
    return orderPost(order, {
      space: SPACE.procurement,
      key: `order-cancelled-${orderId}`,
      text: `⛔ Order ${orderNumber(order)} was cancelled — ${customerOf(order)}. Procurement: stop any supplier order for it.`,
    });
  },

  // A new enquiry from the website.
  'send-admin-consultation-alert': async ({ consultationId }) => {
    const lead = await consultationRepository.findById(consultationId);
    if (!lead) return null;
    const car = lead.vehicleNumber ? ` · ${lead.vehicleNumber}` : '';
    return {
      space: SPACE.sales,
      key: `lead-${consultationId}`,
      text: `💬 New consultation request from ${lead.name}${car}. GTM: please follow up.`,
    };
  },
};

/**
 * Workflow steps that send no email, delivered by the chat-only job
 * `post-team-chat-update` ({ event, orderId, itemId?, by?, supplier?, note? }).
 */
const WORKFLOW_EVENTS = {
  // Procurement ordered it from a supplier — the customer will want to know.
  ordered: async (order, { itemId, supplier, by }, { jobId }) => {
    const owners = await salesOwners(order);
    return orderPost(order, {
      space: SPACE.sales,
      key: keyOf(`ordered-${idOf(order._id)}-${itemId}`, jobId),
      mention: owners,
      text: `🟡 ${orderNumber(order)} — ${itemName(order, itemId)} ordered from ${supplier || 'the supplier'}${by ? ` by ${by}` : ''}. ${address(owners, 'GTM')}: let ${customerOf(order)} know it is on the way to us.`,
    });
  },

  // The customer chose to wait: the line is back in procurement's stock check.
  customer_waits: async (order, { itemId, by }, { jobId }) => orderPost(order, {
    space: SPACE.procurement,
    key: keyOf(`customer-waits-${idOf(order._id)}-${itemId}`, jobId),
    text: `⏳ ${customerOf(order)} will wait for ${itemName(order, itemId)} on ${orderNumber(order)}${by ? ` (recorded by ${by})` : ''}. Procurement: please source it when it is back.`,
  }),

  // Accounts sent the refund back with a reason.
  refund_rejected: async (order, { itemId, by, note }, { jobId }) => {
    const owners = await salesOwners(order);
    const reason = String(note || '').trim().slice(0, 300);
    return orderPost(order, {
      space: SPACE.sales,
      key: keyOf(`refund-rejected-${idOf(order._id)}-${itemId}`, jobId),
      mention: owners,
      text: `↩️ Accounts${by ? ` (${by})` : ''} sent back the refund on ${orderNumber(order)} — ${itemName(order, itemId)}${reason ? `: “${reason}”` : ''}. ${address(owners, 'GTM')}: please follow up with ${customerOf(order)}.`,
    });
  },

  // Accounts approved an out-of-stock refund and it went to Razorpay.
  refund_sent: async (order, { itemId, by, note }, { jobId }) => {
    const owners = await salesOwners(order);
    const detail = String(note || '').trim().slice(0, 200);
    return orderPost(order, {
      space: SPACE.sales,
      key: keyOf(`refund-sent-${idOf(order._id)}-${itemId || 'order'}`, jobId),
      mention: owners,
      text: `💸 Refund sent on ${orderNumber(order)}${itemId ? ` — ${itemName(order, itemId)}` : ''}${by ? ` by ${by}` : ''}${detail ? ` (${detail})` : ''}. ${address(owners, 'GTM')}: let ${customerOf(order)} know — banks usually take 5–7 working days.`,
    });
  },

  // The send was refused (gateway down, nothing captured…): the customer is still owed.
  refund_send_failed: async (order, { itemId, by, note }, { jobId }) => {
    const reason = String(note || '').trim().slice(0, 300);
    return orderPost(order, {
      space: SPACE.accounts,
      key: keyOf(`refund-send-failed-${idOf(order._id)}-${itemId || 'order'}`, jobId),
      text: `⚠️ The refund on ${orderNumber(order)}${itemId ? ` — ${itemName(order, itemId)}` : ''} was approved${by ? ` by ${by}` : ''} but could not be sent${reason ? `: “${reason}”` : ''}. Accounts: please retry it from the order in the team panel.`,
    });
  },

  // Operations confirmed delivery.
  delivered: async (order, { by }, { jobId }) => {
    const owners = await salesOwners(order);
    return orderPost(order, {
      space: SPACE.sales,
      key: keyOf(`delivered-${idOf(order._id)}`, jobId),
      mention: owners,
      text: `🏁 Delivered ${orderNumber(order)} — ${customerOf(order)}${by ? ` (confirmed by ${by})` : ''}. ${address(owners, 'GTM')}: a good moment to check they are happy.`,
    });
  },
};

export const WORKFLOW_CHAT_JOB = 'post-team-chat-update';
export const WORKFLOW_CHAT_EVENTS = Object.freeze(Object.keys(WORKFLOW_EVENTS));

UPDATES[WORKFLOW_CHAT_JOB] = async (data, ctx) => {
  const build = WORKFLOW_EVENTS[data?.event];
  if (!build) return null;
  const order = await loadOrder(data.orderId);
  if (!order) return null;
  return build(order, data, ctx);
};

/** Every space an automatic update may post into — #company is deliberately absent. */
export const UPDATE_SPACES = Object.freeze(Object.values(SPACE));

/** Job names that produce a chat post — cheap check before doing any work. */
export const hasChatUpdate = (jobName) => Object.hasOwn(UPDATES, jobName);

/**
 * Post the chat line for a finished notification job.
 * Always resolves; failures are logged and swallowed so the job still succeeds.
 *
 * @param {string} jobName
 * @param {object} data     the job's data
 * @param {{ jobId?: string|number }} ctx  the queue job id, for events that can recur
 */
export async function postBusinessUpdate(jobName, data = {}, { jobId } = {}) {
  const build = UPDATES[jobName];
  if (!build) return null;
  try {
    const update = await build(data, { jobId: jobId == null ? undefined : String(jobId) });
    if (!update) return null;
    if (!UPDATE_SPACES.includes(update.space)) {
      // A programming error, not a runtime condition: #company stays for people.
      throw new Error(`refusing automatic post to ${update.space}`);
    }
    return await postSystemMessage(update.space, update.text, {
      key: update.key, orderIds: update.orderIds, mentions: update.mentions, threadOrder: update.threadOrder,
    });
  } catch (err) {
    console.error(`[chat] business update for ${jobName} failed (ignored):`, err.message);
    return null;
  }
}
