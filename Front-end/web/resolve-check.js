try {
  const pwTest = require.resolve('@playwright/test');
  console.log('Resolved @playwright/test to:', pwTest);
} catch (e) {
  console.error('Failed to resolve @playwright/test', e);
}
