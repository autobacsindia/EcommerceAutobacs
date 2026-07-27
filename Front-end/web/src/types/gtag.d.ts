/**
 * Global type declarations for the Google Tag (gtag.js) loaded in app/layout.tsx.
 *
 * The gtag() function and window.dataLayer are injected at runtime by the
 * googletagmanager.com script, so TypeScript needs to be told they exist.
 * Kept intentionally loose (any[]) to match Google's dynamic-arguments API.
 */
export {};

declare global {
  function gtag(...args: unknown[]): void;

  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
