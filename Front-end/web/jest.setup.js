require('@testing-library/jest-dom');
const { configure } = require('@testing-library/dom');

// Raise the async-util ceiling (waitFor/findBy*) from the 1000ms default. Under
// the parallel Jest worker pool, CPU contention can stall a component's fetch →
// state → re-render cycle past 1s of wall time even though it needs far less CPU,
// surfacing as spurious "Unable to find element / stuck on Loading..." failures.
// This is a wall-clock guard only: a genuinely-missing element still fails, just
// after 5s instead of 1s. Stays well under jest.config's testTimeout (15000).
configure({ asyncUtilTimeout: 5000 });

// jsdom lacks IntersectionObserver / ResizeObserver, which framer-motion's
// `whileInView` (used by the storefront <Reveal> primitive) and various UI libs
// rely on. Provide no-op polyfills so components mount without crashing in tests.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
if (typeof global.IntersectionObserver === 'undefined') {
  global.IntersectionObserver = MockObserver;
}
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = MockObserver;
}

// Suppress specific console errors that are known issues in test environment
const originalConsoleError = console.error;
console.error = (...args) => {
  const msg = args.map(a => String(a)).join(' ');
  if (
    msg.includes('Received `true` for a non-boolean attribute `jsx`') ||
    msg.includes('Received `true` for a non-boolean attribute `priority`') ||
    (msg.includes('non-boolean attribute') && msg.includes('jsx')) ||
    (msg.includes('non-boolean attribute') && msg.includes('priority'))
  ) {
    return;
  }
  originalConsoleError(...args);
};