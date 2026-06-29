// Simple script to start the import process
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting WordPress product import...');

// Change to the correct directory and run the import script
const importProcess = spawn('node', ['incremental-product-import.js'], {
  cwd: path.resolve(__dirname),
  stdio: 'inherit'
});

importProcess.on('close', (code) => {
  console.log(`Import process exited with code ${code}`);
});

importProcess.on('error', (error) => {
  console.error('Failed to start import process:', error);
});