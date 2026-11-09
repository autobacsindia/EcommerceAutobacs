import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  FESTIVAL_CUSTOM_PERCENT_MAX,
  FESTIVAL_CUSTOM_PERCENT_MIN,
  isValidCustomPercent,
  type FestivalOfferSetting,
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

/** Admin, or the active head of marketing. The server enforces the same rule. */
export function canChangeFestivalOffer(
  user: { role?: string; staff?: { team?: string; isHead?: boolean } | null } | null | undefined,
): boolean {
  return user?.role === 'admin' || (user?.staff?.team === 'marketing' && user.staff.isHead === true);
}
