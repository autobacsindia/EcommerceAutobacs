/**
 * Admin order status-update mutation helper.
 *
 * Sends the status change as plain JSON via the shared apiClient. When the
 * `shipped` transition carries a courier slip PDF it switches to a multipart
 * request (apiClient JSON-stringifies bodies, which would corrupt the file), so
 * we replicate the established admin upload pattern: raw fetch to the /api/v1
 * proxy path with credentials + the XSRF token header.
 *
 * (Distinct from lib/orderStatus.ts, which holds status *presentation* helpers.)
 */
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// apiClient prefixes API_BASE_URL ('/api/v1') for us; the raw multipart fetch
// must prefix it explicitly to hit the same Next.js → backend proxy path.
const API_PREFIX = '/api/v1';

export interface ShippingInput {
  trackingNumber: string;
  carrierCode: string;
  /** Optional courier slip PDF; when present the request is sent multipart. */
  slipFile?: File | null;
}

export interface StatusUpdateInput {
  status: string;
  note?: string;
  /** Only supplied for the `shipped` transition. */
  shipping?: ShippingInput;
}

const REASON = 'admin_update';

export async function updateOrderStatus(orderId: string, input: StatusUpdateInput): Promise<void> {
  const { status, note, shipping } = input;

  if (shipping?.slipFile) {
    const fd = new FormData();
    fd.append('status', status);
    fd.append('reason', REASON);
    if (note) fd.append('notes', note);
    fd.append('trackingNumber', shipping.trackingNumber);
    fd.append('carrierCode', shipping.carrierCode);
    fd.append('slip', shipping.slipFile);

    const csrfToken =
      document.cookie
        .split('; ')
        .find((c) => c.startsWith('XSRF-TOKEN='))
        ?.split('=')[1] || '';

    const headers: Record<string, string> = { 'X-XSRF-TOKEN': csrfToken };
    // Auth rides httpOnly cookies via credentials:'include'. Keep the optional
    // Authorization header from apiClient, but no localStorage token (FE-2:
    // never store a JWT in localStorage — XSS-stealable).
    const authToken = apiClient.getAuthToken();
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${API_PREFIX}${API_ENDPOINTS.ORDER_UPDATE_STATUS(orderId)}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: fd,
    });

    if (!res.ok) {
      let message = `Failed to update status (${res.status})`;
      try {
        const data = await res.json();
        if (data?.message) message = data.message;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      throw new Error(message);
    }
    return;
  }

  // JSON path — carries tracking/carrier for a slip-less `shipped` update too.
  const body: Record<string, unknown> = { status, reason: REASON, notes: note || undefined };
  if (shipping) {
    body.trackingNumber = shipping.trackingNumber;
    body.carrierCode = shipping.carrierCode;
  }
  await apiClient.put(API_ENDPOINTS.ORDER_UPDATE_STATUS(orderId), body);
}
