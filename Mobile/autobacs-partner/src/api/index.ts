/**
 * Which API the screens use. The mock is reachable ONLY in a development build
 * with EXPO_PUBLIC_PARTNER_MOCK=1; `__DEV__` is false in every release build,
 * so a shipped app always talks to the real server.
 */
import { mockApi } from './mock';
import { partnerApi } from './partner';
import type { PartnerApi } from './types';

export const IS_MOCK = __DEV__ && process.env.EXPO_PUBLIC_PARTNER_MOCK === '1';
export const api: PartnerApi = IS_MOCK ? mockApi : partnerApi;

export * from './types';
export { ApiError, errorMessage, OFFLINE_MESSAGE } from './client';
