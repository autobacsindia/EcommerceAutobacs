require('@testing-library/jest-dom');

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