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

export async function fetchOrder(id: string, signal?: AbortSignal): Promise<Order> {
  const res = await api.get<{ order?: RawOrder } & RawOrder>(`/orders/${id}`, signal);
  return toOrder((res.order ?? res) as RawOrder);
}
