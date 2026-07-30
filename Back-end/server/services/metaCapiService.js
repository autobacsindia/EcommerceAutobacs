/**
 * Meta Conversions API (CAPI) — server-side event forwarding.
 *
 * Why server-side: the browser Pixel loses 20–40% of Purchase events to iOS
 * tracking prevention and ad-blockers. CAPI fires the same event from our
 * backend, independent of the browser, so Advantage+/catalogue-ads optimisation
 * sees the real conversion signal. The client Pixel still fires too — Meta
 * DEDUPES the pair by (event_name, event_id), and we use the order id as event_id
 * on BOTH sides so a purchase is never double-counted.
 *
 * Content ids come from utils/metaCatalogId.js — the exact same retailer_ids as
 * the catalogue feed — so events attribute to the right catalogue items.
 *
 * Config (all backend secrets, set in Railway; unset = silently disabled):
 *   META_PIXEL_ID              numeric pixel/dataset id
 *   META_CAPI_ACCESS_TOKEN     system-user token from Events Manager
 *   META_CAPI_TEST_EVENT_CODE  optional — routes events to the "Test events" tab
 *   META_GRAPH_VERSION         optional — defaults to a pinned version
 */
import crypto from 'crypto';
import { contentIdForLineItem } from '../utils/metaCatalogId.js';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const REQUEST_TIMEOUT_MS = 4000;

/** True only when a real pixel id + token are configured. */
export function isEnabled() {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN);
}

/** SHA-256 hex of a normalized string, or undefined for empty input. */
function hash(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  return crypto.createHash('sha256').update(v).digest('hex');
}

/**
 * Normalize a phone to digits-only E.164 (country code, no '+') then hash, so it
 * matches how Meta stores numbers. Handles the common Indian input shapes:
 * '+91 98765 43210', '098765 43210', '00919876543210', bare '9876543210'.
 */
function hashPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('00')) d = d.slice(2);              // 00 intl dialling prefix
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // trunk-0 local (0XXXXXXXXXX)
  if (d.length === 10) d = `91${d}`;                   // bare local → add India country code
  return hash(d);
}

/**
 * Build the CAPI Purchase event from a POPULATED order (items.product populated,
 * user populated). All money is RUPEES (Order model) — no /100.
 */
export function buildPurchaseEvent(order) {
  const t = order.tracking || {};
  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const phone = order.shippingAddress?.phone || user?.phone;

  const contents = [];
  const contentIds = [];
  for (const item of order.items || []) {
    const product = item.product && typeof item.product === 'object' ? item.product : null;
    const id = contentIdForLineItem(product, item.variantId);
    if (!id) continue;
    contentIds.push(id);
    contents.push({ id, quantity: item.quantity || 1, item_price: Number(item.price) || 0 });
  }

  // Only include user_data keys that have a value — Meta rejects empty hashes.
  const userData = {};
  const em = hash(user?.email);
  if (em) userData.em = [em];
  const ph = hashPhone(phone);
  if (ph) userData.ph = [ph];
  const ext = hash(order.user?._id?.toString?.() || order.user?.toString?.());
  if (ext) userData.external_id = [ext];
  if (t.clientIp) userData.client_ip_address = t.clientIp;
  if (t.userAgent) userData.client_user_agent = t.userAgent;
  if (t.fbp) userData.fbp = t.fbp;
  if (t.fbc) userData.fbc = t.fbc;

  return {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: order._id.toString(), // dedup key shared with the client Pixel
    action_source: 'website',
    ...(t.eventSourceUrl && { event_source_url: t.eventSourceUrl }),
    user_data: userData,
    custom_data: {
      currency: 'INR',
      value: Number(order.totalAmount) || 0, // rupees — no /100
      content_type: 'product',
      content_ids: contentIds,
      contents,
      order_id: order._id.toString(),
    },
  };
}

/**
 * Send a Purchase event to Meta. Best-effort: never throws, never blocks the
 * order flow. Safe to call for an order that has no email/ids — it just sends a
 * weaker-match event. No-op when CAPI is not configured.
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string}>}
 */
export async function sendPurchaseEvent(order) {
  if (!isEnabled()) return { ok: false, skipped: true };
  if (!order?._id) return { ok: false, error: 'missing order' };

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.META_PIXEL_ID}` +
    `/events?access_token=${encodeURIComponent(process.env.META_CAPI_ACCESS_TOKEN)}`;

  const body = {
    data: [buildPurchaseEvent(order)],
    ...(process.env.META_CAPI_TEST_EVENT_CODE && {
      test_event_code: process.env.META_CAPI_TEST_EVENT_CODE,
    }),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[MetaCAPI] Purchase ${order._id} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[MetaCAPI] Purchase ${order._id} error:`, err.message);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export default { isEnabled, buildPurchaseEvent, sendPurchaseEvent };
