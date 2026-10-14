/**
 * Sign-in, the signed-in customer, and their orders.
 *
 * The API sets httpOnly cookies on login, which React Native's networking layer
 * stores per app install — so after logging in, later calls are authenticated
 * without the app ever handling a token. If the backend also returns a token in
 * the body (its documented mobile path), we keep it as a belt-and-braces header.
 */
import { api, resetGuestSession, setAccessToken } from './client';

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'customer' | 'staff' | 'admin';
  isVerified?: boolean;
}

interface AuthResponse {
  user?: { _id?: string; id?: string; name?: string; email?: string; phone?: string; role?: string; isVerified?: boolean };
  accessToken?: string;
  token?: string;
}

const toCustomer = (u: AuthResponse['user']): Customer => ({
  id: String(u?._id ?? u?.id ?? ''),
  name: u?.name ?? '',
  email: u?.email ?? '',
  phone: u?.phone,
  role: (u?.role as Customer['role']) ?? 'customer',
  isVerified: u?.isVerified,
});

async function keepToken(res: AuthResponse) {
  const token = res.accessToken ?? res.token;
  if (token) await setAccessToken(token);
}

export async function login(email: string, password: string): Promise<Customer> {
  const res = await api.post<AuthResponse>('/auth/login', { email: email.trim().toLowerCase(), password });
  await keepToken(res);
  return toCustomer(res.user);
}

export async function register(name: string, email: string, password: string, phone?: string): Promise<Customer> {
  const res = await api.post<AuthResponse>('/auth/register', {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    ...(phone ? { phone: phone.trim() } : {}),
  });
  await keepToken(res);
  return toCustomer(res.user);
}

/** Who am I? Resolves to null when nobody is signed in — never throws for 401. */
export async function fetchMe(signal?: AbortSignal): Promise<Customer | null> {
  try {
    const res = await api.get<AuthResponse>('/auth/me', signal);
    const customer = toCustomer(res.user);
    return customer.id ? customer : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', {});
  } catch {
    // Signing out locally must succeed even if the call fails.
  }
  await setAccessToken(null);
  // A fresh guest id, so the next person on this phone starts with an empty cart.
  await resetGuestSession();
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
}

// ── orders ───────────────────────────────────────────────────────────────────

export interface OrderLine {
  name: string;
  quantity: number;
  price: number;
  image: string;
}

export interface Order {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  total: number;
  placedAt: string;
  items: OrderLine[];
}

export interface OrderAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface OrderStep {
  status: string;
  at: string;
}

/**
 * Everything the order page shows, which is more than the list needs.
 *
 * Kept as a separate type rather than making every field optional on `Order`:
 * the list is a cheap `/orders` read and genuinely does not have an address or
 * a status history, and a type that pretends otherwise invites a screen to read
 * a field that is always undefined there.
 */
export interface OrderDetail extends Order {
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  couponCode: string | null;
  paymentMethod: string;
  address: OrderAddress | null;
  trackingNumber: string;
  carrier: string;
  history: OrderStep[];
}

interface RawOrder {
  _id: string;
  wpId?: number;
  status?: string;
  paymentStatus?: string;
  totalAmount?: number;
  createdAt?: string;
  items?: { name?: string; quantity?: number; price?: number; image?: string;
    product?: { images?: { url?: string; isPrimary?: boolean }[] } }[];
}

/** The extra fields `/orders/:id` carries. All optional — ~1,500 migrated
 *  orders predate parts of this schema, so nothing here may be assumed. */
interface RawOrderDetail extends RawOrder {
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  couponCode?: string | null;
  /* The server projects the Payment row down to a safe summary — but only when
     it was populated. An unpopulated order carries the raw id STRING here, so
     this has to be read defensively rather than assumed to be an object. */
  payment?: { paymentMethod?: string; emiPlanLabel?: string } | string | null;
  shippingAddress?: {
    fullName?: string; phone?: string; addressLine1?: string; addressLine2?: string;
    city?: string; state?: string; postalCode?: string; country?: string;
  } | null;
  trackingNumber?: string;
  carrier?: string;
  statusHistory?: { status?: string; timestamp?: string }[];
  shipments?: { trackingNumber?: string; carrier?: string }[];
}

/** Matches invoiceService.orderNumber on the server, so app and email agree. */
const orderCode = (o: RawOrder) => (o.wpId ? `#${o.wpId}` : `#${o._id.slice(-8).toUpperCase()}`);

const toOrder = (o: RawOrder): Order => ({
  id: o._id,
  code: orderCode(o),
  status: o.status ?? 'processing',
  paymentStatus: o.paymentStatus ?? 'pending',
  total: o.totalAmount ?? 0,
  placedAt: o.createdAt ?? '',
  items: (o.items ?? []).map((i) => ({
    name: i.name ?? 'Item',
    quantity: i.quantity ?? 1,
    price: i.price ?? 0,
    image: i.image || (i.product?.images?.find((x) => x.isPrimary) ?? i.product?.images?.[0])?.url || '',
  })),
});

export async function fetchOrders(signal?: AbortSignal): Promise<Order[]> {
  const res = await api.get<{ orders?: RawOrder[] }>('/orders?limit=30', signal);
  return (res.orders ?? []).map(toOrder);
}

const toAddress = (a: RawOrderDetail['shippingAddress']): OrderAddress | null =>
  a && (a.addressLine1 || a.city)
    ? {
        fullName: a.fullName ?? '',
        phone: a.phone ?? '',
        line1: a.addressLine1 ?? '',
        line2: a.addressLine2 ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        postalCode: a.postalCode ?? '',
        country: a.country ?? 'India',
      }
    : null;

export async function fetchOrder(id: string, signal?: AbortSignal): Promise<OrderDetail> {
  const res = await api.get<{ order?: RawOrderDetail } & RawOrderDetail>(`/orders/${id}`, signal);
  const o = (res.order ?? res) as RawOrderDetail;

  // Tracking lives in two places: a legacy order-level pair, and per-parcel on
  // `shipments` for orders split across more than one. The first parcel that
  // has a number is the one worth showing on a phone.
  const parcel = (o.shipments ?? []).find((sh) => sh.trackingNumber);

  return {
    ...toOrder(o),
    subtotal: o.subtotal ?? 0,
    shipping: o.shippingCost ?? 0,
    tax: o.tax ?? 0,
    discount: o.discount ?? 0,
    couponCode: o.couponCode ?? null,
    // The EMI label is pre-rendered by the server ("Credit Card EMI · HDFC ·
    // 6 months @ 14%") precisely so every surface describes a plan the same
    // way; prefer it over the bare method when there is one.
    paymentMethod:
      typeof o.payment === 'object' && o.payment
        ? o.payment.emiPlanLabel || o.payment.paymentMethod || ''
        : '',
    address: toAddress(o.shippingAddress),
    trackingNumber: o.trackingNumber || parcel?.trackingNumber || '',
    carrier: o.carrier || parcel?.carrier || '',
    // Oldest first, and only entries that carry both a status and a time —
    // a step with no timestamp cannot be placed on a timeline.
    history: (o.statusHistory ?? [])
      .filter((h): h is { status: string; timestamp: string } => !!h.status && !!h.timestamp)
      .map((h) => ({ status: h.status, at: h.timestamp }))
      .sort((a, b) => +new Date(a.at) - +new Date(b.at)),
  };
}
