/**
 * Read-only Google Sheets access with a service account ("robot" account the
 * sheet is shared with as Viewer). Signs its own token with node's crypto: two
 * REST calls do not justify the googleapis package.
 *
 * Credentials come only from GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON (the key file's
 * JSON, or that JSON base64-encoded). Errors carry a status, never response
 * bodies: a sheet full of customers must not end up in the logs.
 */
import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TIMEOUT_MS = 30_000;
const TOKEN_LIFETIME_S = 3600;
const RANGES_PER_CALL = 50;

let cached = { token: null, expiresAt: 0, email: null };

/** Test seam: forget the cached token. */
export const resetGoogleSheetsToken = () => { cached = { token: null, expiresAt: 0, email: null }; };

export function readServiceAccount(raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!parsed.client_email || !parsed.private_key) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
  return { email: parsed.client_email, key: parsed.private_key };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function call(url, init, what) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google ${what} failed (HTTP ${res.status})`);
  return res.json();
}

async function accessToken(account) {
  if (cached.token && cached.email === account.email && Date.now() < cached.expiresAt) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: account.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + TOKEN_LIFETIME_S })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.key).toString('base64url');
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` });
  const { access_token: token, expires_in: ttl } = await call(TOKEN_URL, { method: 'POST', body }, 'sign-in');
  cached = { token, email: account.email, expiresAt: Date.now() + (Number(ttl) - 60) * 1000 };
  return token;
}

const quoteTab = (name) => `'${String(name).replace(/'/g, "''")}'`;

/** Every tab: [{ name, gid, values }]. Throws on any failure, so a partial read is never mistaken for the whole sheet. */
export async function readAllTabs(spreadsheetId, account = readServiceAccount()) {
  if (!account) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not set');
  const token = await accessToken(account);
  const headers = { Authorization: `Bearer ${token}` };
  const id = encodeURIComponent(spreadsheetId);

  const meta = await call(`${API}/${id}?fields=sheets.properties(sheetId,title,hidden,sheetType)`, { headers }, 'sheet list');
  const tabs = (meta.sheets ?? []).map((s) => s.properties).filter((p) => (p.sheetType ?? 'GRID') === 'GRID');

  const out = [];
  for (let i = 0; i < tabs.length; i += RANGES_PER_CALL) {
    const group = tabs.slice(i, i + RANGES_PER_CALL);
    const qs = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' });
    group.forEach((t) => qs.append('ranges', quoteTab(t.title)));
    const { valueRanges = [] } = await call(`${API}/${id}/values:batchGet?${qs}`, { headers }, 'sheet read');
    if (valueRanges.length !== group.length) throw new Error('Google sheet read returned the wrong number of tabs');
    group.forEach((t, n) => out.push({ name: t.title, gid: t.sheetId, values: valueRanges[n].values ?? [] }));
  }
  return out;
}
