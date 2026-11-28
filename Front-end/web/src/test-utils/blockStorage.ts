/**
 * Test helper: make browser storage unusable the way Instagram/Facebook in-app
 * browsers and "block all cookies" settings do ("Failed to read the 'localStorage'
 * property from 'Window': Access is denied for this document").
 *
 * jsdom only honours an overridden `window.localStorage` getter for the bare
 * global name, so we ALSO make every Storage method throw. Either way, any raw
 * use of storage in the code under test throws, as it does in those browsers.
 * Returns a function that restores everything.
 */
export function blockStorage(): () => void {
  const denied = (what: string) =>
    // A plain Error named like the browser's DOMException: jsdom's DOMException is
    // from another realm and is not recognised by expect().toThrow.
    Object.assign(new Error(`Failed to read the '${what}' property from 'Window': Access is denied for this document.`), {
      name: 'SecurityError',
    });

  const kinds = ['localStorage', 'sessionStorage'] as const;
  const savedProps = kinds.map((k) => [k, Object.getOwnPropertyDescriptor(window, k)] as const);
  for (const k of kinds) {
    Object.defineProperty(window, k, { configurable: true, get() { throw denied(k); } });
  }

  const methods = ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const;
  const proto = Storage.prototype as unknown as Record<string, unknown>;
  const savedMethods = methods.map((m) => [m, proto[m]] as const);
  for (const m of methods) proto[m] = () => { throw denied('localStorage'); };

  return () => {
    for (const [k, d] of savedProps) if (d) Object.defineProperty(window, k, d);
    for (const [m, fn] of savedMethods) proto[m] = fn;
  };
}
