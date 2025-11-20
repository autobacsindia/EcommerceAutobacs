/**
 * Utility functions for testing hydration issues
 */

export function isServer() {
  return typeof window === 'undefined';
}

export function isClient() {
  return typeof window !== 'undefined';
}

export function getServerTime() {
  // Return a fixed time for server-side rendering to prevent hydration mismatches
  return '2025-01-01T00:00:00.000Z';
}

export function getClientTime() {
  if (typeof window !== 'undefined') {
    return new Date().toISOString();
  }
  return getServerTime();
}

export function safeDateFormatter(date: Date | string, locale: string = 'en-US') {
  // Use consistent formatting to prevent hydration mismatches
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    // Fallback to prevent errors
    return 'Invalid Date';
  }
}

export function safeNumberFormatter(value: number, locale: string = 'en-US') {
  // Use consistent number formatting to prevent hydration mismatches
  try {
    return value.toLocaleString(locale);
  } catch (error) {
    // Fallback to prevent errors
    return value.toString();
  }
}