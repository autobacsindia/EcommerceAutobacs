/**
 * The signed-in customer's saved delivery addresses.
 *
 * Backed by GET/PUT /profile/addresses, which exist precisely so an address can
 * be saved without touching the customer's name or email (see the backend's
 * utils/addressBook.js). The PUT replaces the whole list, so every change here
 * is read-modify-write against the server's CURRENT list rather than the copy
 * on screen — otherwise an address added on the website a minute ago would be
 * erased by the next save from the phone.
 *
 * The server owns the rules (valid PIN and mobile, at most 10, exactly one
 * default) and answers with the cleaned list; the app always shows that
 * answer, never its own guess.
 */
import { api } from './client';

export interface SavedAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
}

type Raw = Partial<SavedAddress>;

const clean = (a: Raw): SavedAddress => ({
  fullName: a.fullName ?? '',
  phone: a.phone ?? '',
  addressLine1: a.addressLine1 ?? '',
  addressLine2: a.addressLine2 ?? '',
  city: a.city ?? '',
  state: a.state ?? '',
  postalCode: a.postalCode ?? '',
  isDefault: !!a.isDefault,
});

export async function fetchAddresses(signal?: AbortSignal): Promise<SavedAddress[]> {
  const res = await api.get<{ addresses?: Raw[] }>('/profile/addresses', signal);
  return (res.addresses ?? []).map(clean);
}

async function replaceAll(list: SavedAddress[]): Promise<SavedAddress[]> {
  const res = await api.put<{ addresses?: Raw[] }>('/profile/addresses', { addresses: list });
  return (res.addresses ?? []).map(clean);
}

const FIELDS = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'] as const;

/**
 * A stable identity for an address, built from its contents.
 *
 * The backend stores addresses WITHOUT ids (AddressSchema is `{ _id: false }`,
 * and the website relies on that shape), so the app cannot select one by id.
 * Index would break the moment the list is edited on the website mid-checkout.
 * The contents are what make an address that address, so they are the key.
 */
export const addressKey = (a: SavedAddress): string =>
  FIELDS.map((k) => a[k].trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

const samePlace = (a: SavedAddress, b: SavedAddress) => addressKey(a) === addressKey(b);

/**
 * Add an address, unless the same place is already saved.
 *
 * Checkout saves the address used for each order; without the duplicate check
 * a customer who orders five times to the same house would end up with five
 * identical entries.
 */
export async function addAddress(a: SavedAddress, makeDefault = false): Promise<SavedAddress[]> {
  const current = await fetchAddresses();
  if (current.some((c) => samePlace(c, a))) return current;
  const next = makeDefault
    ? [...current.map((c) => ({ ...c, isDefault: false })), { ...a, isDefault: true }]
    : [...current, { ...a, isDefault: current.length === 0 }];
  return replaceAll(next);
}

export async function removeAddress(key: string): Promise<SavedAddress[]> {
  const current = await fetchAddresses();
  return replaceAll(current.filter((c) => addressKey(c) !== key));
}

export async function setDefaultAddress(key: string): Promise<SavedAddress[]> {
  const current = await fetchAddresses();
  return replaceAll(current.map((c) => ({ ...c, isDefault: addressKey(c) === key })));
}
