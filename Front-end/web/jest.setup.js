require('@testing-library/jest-dom');

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