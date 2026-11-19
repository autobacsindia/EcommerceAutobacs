/**
 * The WhatsApp consent fields to store on a new order.
 *
 * Only a real boolean counts. Anything else — the field missing because an older
 * checkout bundle sent the request, a string, null — stores NOTHING, and an order
 * with no recorded consent is never messaged. A `false` is stored too: "the customer
 * unticked the box" is worth keeping as evidence, not just the yeses.
 *
 * @param {unknown} value - the request's `whatsappOptIn`
 * @param {'customer'|'staff'} by - who ticked it: the shopper at checkout, or a staff
 *   member who asked the customer (sales panel / admin offline order)
 * @param {Date} [now]
 * @returns {{whatsappOptIn?: boolean, whatsappOptInAt?: Date, whatsappOptInBy?: string}}
 */
export function whatsappConsentFields(value, by, now = new Date()) {
  if (typeof value !== 'boolean') return {};
  return { whatsappOptIn: value, whatsappOptInAt: now, whatsappOptInBy: by };
}

export default { whatsappConsentFields };
