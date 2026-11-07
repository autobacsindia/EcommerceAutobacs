/**
 * Prove the Shiprocket API user works: log in, then list the pickup addresses.
 *
 *   npm run verify-shiprocket                 # local .env
 *   railway run npm run verify-shiprocket     # production variables
 *
 * Read-only: it books nothing and writes nothing except the cached login token
 * (Redis key `shiprocket:token`, which the server would write anyway). Never
 * prints the password or the token. Exits non-zero on any failure, so it can
 * gate the next booking steps.
 */
import dotenv from 'dotenv';

dotenv.config();

// Imported AFTER dotenv: the Redis client reads REDIS_URL when it loads.
const { default: shiprocket, ShiprocketError } = await import('../services/shiprocketClient.js');
const { getRedisClient } = await import('../services/redisClient.js');

let exitCode = 0;
try {
  if (!shiprocket.isConfigured()) {
    console.error('❌ SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD are not set.');
    exitCode = 1;
  } else {
    await shiprocket.getToken({ forceLogin: true });
    console.log('✅ Logged in to Shiprocket.');
    const pickups = await shiprocket.listPickupLocations();
    if (pickups.length === 0) {
      console.warn('⚠️  No pickup address saved in Shiprocket yet — add the warehouse under Settings → Pickup Addresses.');
      exitCode = 2;
    } else {
      console.log(`✅ ${pickups.length} pickup address(es):`);
      for (const p of pickups) {
        console.log(`   • ${p.name} — ${p.city}, ${p.state} ${p.pincode}${p.primary ? '  (primary)' : ''}`);
      }
    }
  }
} catch (err) {
  const msg = err instanceof ShiprocketError ? `${err.message} [${err.code}]` : err.message;
  console.error(`❌ ${msg}`);
  exitCode = 1;
} finally {
  await getRedisClient()?.quit().catch(() => {});
}
process.exit(exitCode);
