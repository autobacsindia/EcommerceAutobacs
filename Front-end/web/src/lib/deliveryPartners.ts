import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { trackingKeys } from '@/hooks/queries/keys';

/**
 * The "Delivery partner" dropdown. The courier list itself (names, codes, tracking
 * pages) lives ONCE, on the server (orderTrackingService CARRIERS) and is read from
 * GET /orders/tracking/carriers — this file only shapes it for the form and checks
 * links before they become an <a href>.
 */

export const OTHER_PARTNER = 'OTHER';
export const MAX_PARTNER_NAME = 60;
export const MAX_PARTNER_URL = 500;

export interface DeliveryPartnerOption {
  code: string;
  name: string;
  custom?: boolean;
  deliveryPartner?: boolean;
}

/** What the form holds: a partner code, plus the typed name and page for "Other". */
export interface DeliveryPartnerValue {
  code: string;
  name: string;
  url: string;
}

export const EMPTY_PARTNER: DeliveryPartnerValue = { code: '', name: '', url: '' };

/** The partners for the dropdown, in the server's order ("Other" last). */
export function useDeliveryPartners() {
  return useQuery({
    queryKey: trackingKeys.carriers(),
    queryFn: () => apiClient.get<{ carriers?: DeliveryPartnerOption[] }>('/orders/tracking/carriers'),
    // A config list: fetched once per visit is plenty.
    staleTime: Infinity,
    select: (res) => {
      const partners = (res.carriers || []).filter((c) => c.deliveryPartner);
      // "Other" must always be there, even from an older server.
      return partners.some((c) => c.code === OTHER_PARTNER)
        ? partners
        : [...partners, { code: OTHER_PARTNER, name: 'Other courier', custom: true, deliveryPartner: true }];
    },
  });
}

/**
 * The link when it is an absolute http(s) URL, else null. Rendered links pass
 * through here as well as the server check, so `javascript:`/`data:` never reach
 * an href even from an old or odd record.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw || raw.length > MAX_PARTNER_URL) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}

/** Why the form can't be sent yet, or '' when it can. `required`: a partner must be chosen. */
export function partnerProblem(v: DeliveryPartnerValue, { required = false } = {}): string {
  if (!v.code) return required ? 'Choose the delivery partner.' : '';
  if (v.code !== OTHER_PARTNER) return '';
  if (!v.name.trim()) return 'Enter the delivery partner’s name.';
  if (v.url.trim() && !safeHttpUrl(v.url)) return 'The tracking page must be a web link starting with http:// or https://';
  return '';
}

/**
 * The form fields for a staff dispatch request. `courierName` is always sent (the
 * partner's own name for a listed one) so a server without the dropdown still
 * records who carries the parcel.
 */
export function appendPartner(form: FormData, v: DeliveryPartnerValue, options: DeliveryPartnerOption[]) {
  if (!v.code) return;
  const isOther = v.code === OTHER_PARTNER;
  const name = isOther ? v.name.trim() : options.find((o) => o.code === v.code)?.name || v.name.trim();
  form.append('courierCode', v.code);
  if (name) form.append('courierName', name);
  if (isOther && v.url.trim()) form.append('courierUrl', v.url.trim());
}

/**
 * The form's starting value for a parcel already recorded. A listed partner by its
 * code; a courier typed before the dropdown existed by name if it matches one,
 * otherwise as "Other" with that name (and its saved page, if any).
 */
export function partnerFromParcel(
  parcel: { courier?: string; courierCode?: string; courierUrl?: string | null },
  options: DeliveryPartnerOption[],
): DeliveryPartnerValue {
  const name = (parcel.courier || '').trim();
  const byCode = parcel.courierCode && options.find((o) => o.code === parcel.courierCode && o.code !== OTHER_PARTNER);
  if (byCode) return { code: byCode.code, name: byCode.name, url: '' };
  const byName = !parcel.courierCode && options.find((o) => o.code !== OTHER_PARTNER && o.name.toLowerCase() === name.toLowerCase());
  if (byName) return { code: byName.code, name: byName.name, url: '' };
  if (!name) return EMPTY_PARTNER;
  // Only a saved "Other" page belongs to the typed name; a derived link is a listed partner's.
  const url = parcel.courierCode === OTHER_PARTNER ? parcel.courierUrl || '' : '';
  return { code: OTHER_PARTNER, name, url };
}
