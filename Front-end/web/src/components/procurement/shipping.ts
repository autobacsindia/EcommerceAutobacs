import apiClient from '@/lib/api-client';

/** The procurement panel's delivery-charge estimate (POST /supplier-enquiries/shipping-estimate). */
export type ShippingEstimate = {
  pin: string;
  weightKg: number;
  items: { productId: string; name: string; qty: number; weightKg: number | null }[];
  missingWeight: string[];
} & (
  | { found: true; zone: { name: string; type: string }; deliveryDays: { min: number | null; max: number | null };
      basePaise: number; perKgPaise: number; weightPaise: number; totalPaise: number }
  | { found: false; zonesConfigured: number }
);

export type ShippingInput = { pin: string; weightKg: string; items: { productId: string; qty: number }[] };

export const estimateShipping = (body: ShippingInput) =>
  apiClient.post<{ estimate: ShippingEstimate }>('/supplier-enquiries/shipping-estimate', body);

/** Same check the server makes — lets the button say what is wrong before a round trip. */
export const isPincode = (s: string) => /^[1-9]\d{5}$/.test(s.replace(/\s/g, ''));
