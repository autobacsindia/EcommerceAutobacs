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

// jsdom has no PointerEvent, so `fireEvent.pointerMove(el, { clientX })` builds a
// bare Event and every coordinate arrives as `undefined` — tests for
// pointer-driven UI then assert against NaN instead of failing honestly.
// MouseEvent already implements the coordinate model; this just gives it the
// pointer identity fields.
if (typeof window !== 'undefined' && typeof window.PointerEvent !== 'function') {
  class PointerEvent extends window.MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
    }
  }
  window.PointerEvent = PointerEvent;
  global.PointerEvent = PointerEvent;
}

// jsdom (26.x) ships the <dialog> ELEMENT but none of its modal behaviour —
// `showModal`/`close` are simply absent, so a component that opens a native
// dialog throws on mount. Polyfill the open/closed state only; focus trapping,
// the top layer and ::backdrop are real-browser concerns and belong in the
// Playwright suite, not here. Production code still feature-detects these, so
// this makes tests representative rather than papering over a crash.
if (typeof window !== 'undefined' && window.HTMLDialogElement) {
  const proto = window.HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal() {
      this.open = true;
    };
  }
  if (typeof proto.show !== 'function') {
    proto.show = function show() {
      this.open = true;
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(returnValue) {
      if (!this.open) return;
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new window.Event('close'));
    };
  }
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