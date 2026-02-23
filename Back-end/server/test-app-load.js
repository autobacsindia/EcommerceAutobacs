
try {
  await import('./app.js');
  console.log('Successfully imported app.js');
} catch (error) {
  console.error('Failed to import app.js:', error);
}
