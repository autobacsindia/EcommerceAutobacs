/**
 * Price formatting utilities
 * Provides functions for formatting prices with currency support
 */

/**
 * Format price in INR (Indian Rupees)
 * @param price - Price amount in INR
 * @returns Formatted price string with ₹ symbol
 */
export function formatPriceINR(price: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(price);
}

/**
 * Format price in USD (US Dollars)
 * @param price - Price amount in USD
 * @returns Formatted price string with $ symbol
 */
export function formatPriceUSD(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(price);
}

/**
 * Convert INR to USD
 * @param priceInINR - Price amount in INR
 * @param exchangeRate - Exchange rate (1 USD = x INR)
 * @returns Price in USD
 */
export function convertINRToUSD(priceInINR: number, exchangeRate: number = 83): number {
  return priceInINR / exchangeRate;
}

/**
 * Convert USD to INR
 * @param priceInUSD - Price amount in USD
 * @param exchangeRate - Exchange rate (1 USD = x INR)
 * @returns Price in INR
 */
export function convertUSDToINR(priceInUSD: number, exchangeRate: number = 83): number {
  return priceInUSD * exchangeRate;
}

/**
 * Format price based on currency type
 * @param price - Price amount (assumed to be in INR by default)
 * @param currency - Currency type ('INR' or 'USD')
 * @param exchangeRate - Exchange rate for conversion
 * @returns Formatted price string
 */
export function formatPrice(
  price: number,
  currency: 'INR' | 'USD' = 'INR',
  exchangeRate: number = 83
): string {
  if (currency === 'USD') {
    const priceInUSD = convertINRToUSD(price, exchangeRate);
    return formatPriceUSD(priceInUSD);
  }
  return formatPriceINR(price);
}

/**
 * Get currency symbol
 * @param currency - Currency type
 * @returns Currency symbol
 */
export function getCurrencySymbol(currency: 'INR' | 'USD'): string {
  return currency === 'INR' ? '₹' : '$';
}

/**
 * Parse price string to number
 * Removes currency symbols and formatting
 * @param priceString - Formatted price string
 * @returns Numeric price value
 */
export function parsePriceString(priceString: string): number {
  // Remove currency symbols, commas, and spaces
  const cleaned = priceString.replace(/[₹$,\s]/g, '');
  return parseFloat(cleaned) || 0;
}
