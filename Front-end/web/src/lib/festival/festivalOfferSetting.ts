import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  FESTIVAL_CUSTOM_PERCENT_MAX,
  FESTIVAL_CUSTOM_PERCENT_MIN,
  isValidCustomPercent,
  type FestivalOfferSetting,
  type FestivalVariantSetting,
} from './festivalOffer';

export type FestivalOfferMode = 'auto' | 'none' | 'custom';

export const CUSTOM_PERCENT_ERROR =
  `Enter a whole number from ${FESTIVAL_CUSTOM_PERCENT_MIN} to ${FESTIVAL_CUSTOM_PERCENT_MAX}`;

/** Parse the admin's typed % — the server re-checks; this only gives an instant message. */
export function parseCustomPercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return isValidCustomPercent(n) ? n : null;
}

/** Short admin label: "Automatic", "No offer", "Custom 7%". */
export function festivalSettingLabel(setting: FestivalOfferSetting | null | undefined): string {
  if (!setting) return 'Automatic';
  if (setting.mode === 'none') return 'No offer';
  return `Custom ${setting.percent}%`;
}

export interface FestivalSettingResult {
  success: boolean;
  requested: number;
  updated: number;
  unchanged: number;
  notFound: string[];
}

export async function saveFestivalOfferSetting(
  productIds: string[],
  mode: FestivalOfferMode,
  percent: number | null,
): Promise<FestivalSettingResult> {
  return apiClient.patch<FestivalSettingResult>(API_ENDPOINTS.PRODUCT_FESTIVAL_OFFER_SETTING, {
    productIds,
    mode,
    ...(mode === 'custom' ? { percent } : {}),
  });
}

/** Admin or marketing team. The server enforces the same rule. */
export function canChangeFestivalOffer(
  user: { role?: string; staff?: { team?: string } | null } | null | undefined,
): boolean {
  return user?.role === 'admin' || user?.staff?.team === 'marketing';
}

/** A model's choice in the admin box. 'inherit' = "Same as product" (no entry stored). */
export type FestivalVariantMode = 'inherit' | FestivalOfferMode;

export interface FestivalVariantChoice { variantId: string; mode: FestivalVariantMode; percent?: number | null }

export interface ProductFestivalOfferResult {
  success: boolean;
  updated: boolean;
  festivalOfferSetting: FestivalOfferSetting | null;
  festivalOfferVariantSettings: FestivalVariantSetting[];
}

/** The model's stored entry → the admin's choice. */
export function variantChoiceFromSetting(entry: FestivalVariantSetting | undefined): { mode: FestivalVariantMode; percentText: string } {
  if (!entry) return { mode: 'inherit', percentText: '' };
  return { mode: entry.mode, percentText: entry.percent != null ? String(entry.percent) : '' };
}

/**
 * Save the product's Diwali box — the product choice and every model's choice in ONE
 * request, so it can never be half-saved. The server validates, purges and audits.
 */
export async function saveProductFestivalOffer(
  productId: string,
  mode: FestivalOfferMode,
  percent: number | null,
  variants: FestivalVariantChoice[],
): Promise<ProductFestivalOfferResult> {
  return apiClient.put<ProductFestivalOfferResult>(API_ENDPOINTS.PRODUCT_FESTIVAL_OFFER(productId), {
    mode,
    ...(mode === 'custom' ? { percent } : {}),
    variants: variants.map((v) => ({
      variantId: v.variantId,
      mode: v.mode,
      ...(v.mode === 'custom' ? { percent: v.percent } : {}),
    })),
  });
}
