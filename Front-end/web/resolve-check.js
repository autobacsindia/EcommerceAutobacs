console.log('Resolving @playwright/test:');
try {
  console.log(require.resolve('@playwright/test'));
} catch (e) {
  console.log(e.message);
}

console.log('Resolving playwright:');
try {
  console.log(require.resolve('playwright'));
} catch (e) {
  console.log(e.message);
}
