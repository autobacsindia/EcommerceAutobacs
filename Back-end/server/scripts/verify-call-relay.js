/**
 * Check the call relay (Cloudflare TURN) keys work, without placing a call.
 *
 *   railway run -s EcommerceAutobacs npm run verify-call-relay
 *
 * Mints one set of short-lived relay credentials with CALL_CF_TURN_KEY_ID /
 * CALL_CF_TURN_API_TOKEN and prints which relay addresses browsers will get.
 * Never prints the token or the credentials. Exit 0 = relay ready, 1 = not.
 * No database, no side effects beyond one credential mint (which simply expires).
 */
import { cloudflareTurnConfigured, cloudflareTurnServers } from '../services/callRelay.js';

if (!cloudflareTurnConfigured()) {
  console.error('✗ Relay is OFF: set CALL_CF_TURN_KEY_ID and CALL_CF_TURN_API_TOKEN on the backend service.');
  process.exit(1);
}

const servers = await cloudflareTurnServers();
if (!servers.length) {
  console.error('✗ Cloudflare refused or did not answer (see the warning above). Check the key id and token.');
  process.exit(1);
}
const urls = servers.flatMap((s) => s.urls);
console.log(`✓ Relay ready: ${urls.length} relay address(es) for browsers`);
for (const u of urls) console.log(`  ${u}`);
process.exit(0);
