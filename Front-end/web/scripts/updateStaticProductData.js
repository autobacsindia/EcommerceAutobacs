#!/usr/bin/env node

// Script to update static product data in the frontend
// This script copies the latest clean product data to the public directory

const fs = require('fs');
const path = require('path');

// Get the project root directory
const projectRoot = path.resolve(__dirname, '..');

// Define paths
const sourceDataPath = path.join(projectRoot, '..', '..', '..', 'final-clean-autobacs-products.min.json');
const destinationDataPath = path.join(projectRoot, 'public', 'data', 'products.json');

console.log('=== Static Product Data Update Script ===\n');

// Check if source file exists
if (!fs.existsSync(sourceDataPath)) {
  console.error(`❌ Source file not found: ${sourceDataPath}`);
  console.log('Please ensure the clean product data file exists at the expected location.');
  console.log('Expected location: C:\\Main project\\final-clean-autobacs-products.min.json');
  process.exit(1);
}

try {
  console.log(`📁 Reading product data from: ${sourceDataPath}`);
  
  // Read the source file
  const data = fs.readFileSync(sourceDataPath, 'utf8');
  
  // Validate JSON
  try {
    JSON.parse(data);
    console.log('✅ JSON validation successful');
  } catch (parseError) {
    console.error('❌ Invalid JSON in source file:', parseError.message);
    process.exit(1);
  }
  
  console.log(`📁 Writing product data to: ${destinationDataPath}`);
  
  // Ensure destination directory exists
  const destinationDir = path.dirname(destinationDataPath);
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
    console.log('📁 Created destination directory');
  }
  
  // Write to destination
  fs.writeFileSync(destinationDataPath, data);
  
  // Get file sizes
  const sourceStats = fs.statSync(sourceDataPath);
  const destStats = fs.statSync(destinationDataPath);
  
  console.log(`✅ Successfully updated static product data!`);
  console.log(`📊 Source file size: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📊 Destination file size: ${(destStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🕒 Updated at: ${new Date().toLocaleString()}`);
  
  // Verify the copy
  const sourceData = fs.readFileSync(sourceDataPath, 'utf8');
  const destData = fs.readFileSync(destinationDataPath, 'utf8');
  
  if (sourceData === destData) {
    console.log('✅ Verification successful - files match');
  } else {
    console.warn('⚠️  Warning: Source and destination files do not match exactly');
  }
  
  console.log('\n🚀 Static product data is now ready for use in the frontend!');
  console.log('💡 Restart your development server to see the changes take effect.');
  
} catch (error) {
  console.error('❌ Error updating static product data:', error.message);
  process.exit(1);
}