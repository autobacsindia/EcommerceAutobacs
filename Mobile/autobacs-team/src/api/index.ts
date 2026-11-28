/**
 * The API the screens import. EXPO_PUBLIC_TEAM_MOCK=1 swaps in demo data (dev
 * previews only; the app shows a DEMO DATA ribbon). Production builds never set it.
 */
import { Platform } from 'react-native';
import { createHrApi, type HrApi } from './hr';
import { createMockApi } from './mock';
import { downloadToCache } from '../punch/storage';

export const IS_MOCK = process.env.EXPO_PUBLIC_TEAM_MOCK === '1';

function realApi(): HrApi {
  // Imported lazily so the demo build needs no API URL.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { http, API_URL } = require('./client') as typeof import('./client');
  return createHrApi({ http, isWeb: Platform.OS === 'web', downloadPdf: downloadToCache, baseUrl: API_URL });
}

export const api: HrApi = IS_MOCK ? createMockApi() : realApi();

export { ApiError, errorMessage } from './http';
export type * from './types';
