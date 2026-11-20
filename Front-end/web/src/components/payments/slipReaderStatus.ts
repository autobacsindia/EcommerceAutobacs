/** Is the slip reader switched on? (backend: GET /slip-reader/status) */
// Asked once per page load: when reading is off, no slip is ever sent to be read.
let enabledOnce: Promise<boolean> | null = null;
export function slipReaderEnabled(): Promise<boolean> {
  if (!enabledOnce) {
    enabledOnce = typeof fetch !== 'function'
      ? Promise.resolve(false)
      : fetch('/api/v1/slip-reader/status', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { enabled: false }))
        .then((b) => Boolean(b?.enabled))
        .catch(() => false);
  }
  return enabledOnce;
}
/** Tests only. */
export const resetSlipReaderForTests = () => { enabledOnce = null; };
