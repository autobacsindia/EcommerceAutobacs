import { spawn } from 'child_process';

console.log('Checking MongoDB status...');

// Check if MongoDB process is running
const tasklist = spawn('tasklist', ['/fi', 'imagename eq mongod.exe']);

let output = '';

tasklist.stdout.on('data', (data) => {
  output += data.toString();
});

tasklist.on('close', (code) => {
  if (output.includes('mongod.exe')) {
    console.log('✓ MongoDB process is running');
    
    // Extract PID
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('mongod.exe')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          console.log(`  PID: ${parts[1]}`);
        }
        break;
      }
    }
  } else {
    console.log('✗ MongoDB process is not running');
    console.log('\nTo start MongoDB, run:');
    console.log('powershell -ExecutionPolicy Bypass -File "C:\\Main project\\Autobacs\\Back-end\\server\\start-mongodb-final.ps1"');
  }
});