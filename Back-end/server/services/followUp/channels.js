/**
 * How a follow-up alert reaches people. The sweep builds ONE alert per ladder
 * level and hands it to every registered channel; it never knows which exist.
 *
 *   inbox   a StaffTaskInbox line (kinds followup_due / followup_escalated) —
 *           /notifications/summary `alerts` → the panel's pop-up card
 *           (NewWorkPopup.tsx). Keyed per person per level per cycle, so a
 *           replayed alert can never make a second line.
 *   push    the phone/computer notification (pushService). Not for `remind`:
 *           a reminder is panel-only.
 *
 * Wave 2 piece E adds staff WhatsApp with registerFollowUpChannel(), without
 * touching the sweep. A channel is { name, send(alert) → Promise<number> }; a
 * channel that throws is logged and skipped — the others still go out.
 *
 * alert = { level, kind, delay (the row), cycle, recipients: [{ _id, role, name }],
 *           title, text, push: { title, body, tag } }
 */
import crypto from 'crypto';
import staffTaskInboxRepository from '../../repositories/staffTaskInboxRepository.js';
import { sendToUsers } from '../pushService.js';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** The Inbox key for one person's line of one level in one cycle (< 120 chars, stable). */
export const inboxKey = (delayKey, level, cycle) => `fu:${crypto.createHash('sha1')
  .update(`${delayKey}|${level}|${new Date(cycle).getTime()}`).digest('hex')}`;

/** Where the line / notification opens: the order, in the panel the person uses. */
export const orderHref = (orderId, role) => (role === 'admin'
  ? `/admin/orders?order=${encodeURIComponent(idOf(orderId))}` : '/team/orders');

export const inboxChannel = Object.freeze({
  name: 'inbox',
  async send(alert) {
    const key = inboxKey(alert.delay.key, alert.level, alert.cycle);
    return staffTaskInboxRepository.insertMany(alert.recipients.map((u) => ({
      user: u._id,
      key,
      kind: alert.kind,
      order: alert.delay.order,
      state: 'alert', // never in the task Inbox list or its badge (models/StaffTaskInbox.js)
      title: alert.title.slice(0, 200),
      text: alert.text.slice(0, 200),
    })));
  },
});

export const pushChannel = Object.freeze({
  name: 'push',
  async send(alert) {
    if (alert.level === 'remind') return 0;
    return sendToUsers(
      alert.recipients.map((u) => ({ userId: idOf(u._id), url: orderHref(alert.delay.order, u.role) })),
      alert.push,
    );
  },
});

const registry = new Map([[inboxChannel.name, inboxChannel], [pushChannel.name, pushChannel]]);

/** Add (or replace, by name) a channel. */
export function registerFollowUpChannel(channel) {
  if (!channel || typeof channel.name !== 'string' || !channel.name || typeof channel.send !== 'function') {
    throw new Error('A follow-up channel needs a name and a send(alert) function.');
  }
  registry.set(channel.name, channel);
}

/** Test / rollback hook: remove a channel by name. */
export const unregisterFollowUpChannel = (name) => registry.delete(name);
export const followUpChannels = () => [...registry.values()];

/** Send through every channel. Returns { [channel]: count }; never throws. */
export async function dispatchAlert(alert, log = console.error) {
  const out = {};
  for (const ch of registry.values()) {
    try {
      out[ch.name] = Number(await ch.send(alert)) || 0;
    } catch (err) {
      out[ch.name] = 0;
      log(`[FollowUp] channel ${ch.name} failed for ${alert.delay.key} ${alert.level}:`, err.message);
    }
  }
  return out;
}

/** The pop-up lines of a finished step, taken off the panel (they stay nowhere else). */
export async function clearAlertsFor(row) {
  const reached = row.levelsReached || [];
  if (!reached.length) return 0;
  const keys = [...new Set(reached.map((r) => inboxKey(row.key, r.level, r.cycle)))];
  const users = [...new Set(reached.flatMap((r) => (r.recipients || []).map(idOf)))];
  return staffTaskInboxRepository.clearAlertKeys(users, keys);
}
