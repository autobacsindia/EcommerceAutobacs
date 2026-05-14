const invalidPatterns = [
  /^$/,
  /^undefined$/,
  /^null$/,
  /^0\.0\.0\.0$/,
  /^random-/i,
  /^test-/i,
  /^fake-/i,
];

const ipv4Pattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

export function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  if (invalidPatterns.some(pattern => pattern.test(ip))) return false;
  if (ipv4Pattern.test(ip)) return true;
  if (ipv6Pattern.test(ip)) return true;
  // Accept Cloudflare/Proxy IPs that may include port
  if (ip.includes(':') && ip.split(':').length <= 2) return true;
  return false;
}
