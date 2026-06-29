import { preFlightIPCheck } from '../../config/db.js';

console.log('Testing enhanced pre-flight IP check...');

preFlightIPCheck()
  .then((result) => {
    console.log('Pre-flight check result:', result);
    if (result) {
      console.log('✓ Pre-flight check passed - IP is whitelisted');
    } else {
      console.log('⚠ Pre-flight check detected issues - see above for details');
    }
  })
  .catch((error) => {
    console.error('✗ Pre-flight check failed with error:', error.message);
  });