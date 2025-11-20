/**
 * Utility functions for generating deterministic IDs to prevent hydration errors
 */

let counter = 0;

/**
 * Generates a deterministic ID based on a prefix and counter
 * @param prefix Optional prefix for the ID
 * @returns A deterministic ID string
 */
export function generateDeterministicId(prefix: string = 'id'): string {
  counter = (counter + 1) % 1000000; // Prevent counter from growing too large
  return `${prefix}-${counter}`;
}

/**
 * Generates a deterministic ID that's safe for SSR
 * @param prefix Optional prefix for the ID
 * @returns A deterministic ID string
 */
export function generateSSRSafeId(prefix: string = 'ssr'): string {
  // Use a simple counter-based approach that's consistent between server and client
  // In a real application, you might want to use a more sophisticated approach
  return `${prefix}-${Math.abs(prefix.length * 1000 + counter) % 1000000}`;
}

/**
 * Resets the ID counter (useful for testing)
 */
export function resetIdCounter(): void {
  counter = 0;
}