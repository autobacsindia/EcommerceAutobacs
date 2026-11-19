import { isValidIndianMobile, isValidPinCode } from '@/lib/utils';

/** The checkout delivery-address fields a customer types. */
export interface CheckoutAddressInput {
  fullName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
}

export type AddressField = keyof CheckoutAddressInput;
export type AddressErrors = Partial<Record<AddressField, string>>;

/** Display order — also the order errors are reported in. */
export const ADDRESS_FIELDS: readonly AddressField[] = ['fullName', 'street', 'city', 'state', 'postalCode', 'phone'];

const REQUIRED: Record<AddressField, string> = {
  fullName: 'Enter the name of the person receiving the parcel',
  street: 'Enter the house / street address',
  city: 'Enter the city',
  state: 'Enter the state',
  postalCode: 'Enter the PIN code',
  phone: 'Enter a mobile number',
};

/**
 * One message per wrong field, so the form can mark exactly that box.
 * Mirrors the backend (Back-end/server/middleware/validators/order.js): the
 * server re-checks, this only saves the customer a round trip.
 */
export function validateCheckoutAddress(a: CheckoutAddressInput): AddressErrors {
  const errors: AddressErrors = {};
  for (const field of ADDRESS_FIELDS) {
    if (!String(a[field] ?? '').trim()) errors[field] = REQUIRED[field];
  }
  if (!errors.postalCode && !isValidPinCode(a.postalCode)) errors.postalCode = 'Enter a valid 6-digit PIN code';
  if (!errors.phone && !isValidIndianMobile(a.phone)) errors.phone = 'Enter a valid 10-digit mobile number';
  return errors;
}

/** The first message in display order, for the toast. */
export function firstAddressError(errors: AddressErrors): string | undefined {
  const field = ADDRESS_FIELDS.find((f) => errors[f]);
  return field ? errors[field] : undefined;
}
