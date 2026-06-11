export const API_BASE_URL = '/api/v1';
export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_RETRIES = 2; // 3 total attempts: 1 initial + 2 retries
export const DEFAULT_RETRY_DELAY = 1000;

// These endpoints call external geocoding services and need extra tolerance
export const LOCATION_ENDPOINTS = ['/location/current', '/location/select', '/location/estimate'];
export const LOCATION_RETRIES = 5;
export const LOCATION_RETRY_DELAY = 2000;
