/**
 * Google Sheets access with a service account ("robot" account the sheet is
 * shared with). Reading needs Viewer; writing the panel's follow-ups back
 * (services/metaLeadSheetWriter.js) needs Editor. Signs its own token with
 * node's crypto: a few REST calls do not justify the googleapis package.
 *
 * Credentials come only from GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON (the key file's
 * JSON, or that JSON base64-encoded). Errors carry a status, never response
 * bodies: a sheet full of customers must not end up in the logs.
 */
import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Read AND write. What the robot may actually do is still decided by how the
// sheet is shared with it (Viewer → every write is a 403).
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TIMEOUT_MS = 30_000;
const TOKEN_LIFETIME_S = 3600;
const RANGES_PER_CALL = 50;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 2000];

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

/** Fetch JSON, trying again after a short wait when Google says "busy" or the network blips. */
async function call(url, init, what) {
  for (let attempt = 0; ; attempt += 1) {
    const retrying = attempt < RETRY_DELAYS_MS.length;
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (!retrying) throw err;
    }
    if (res?.ok) return res.json();
    if (res && !(retrying && RETRY_STATUSES.has(res.status))) {
      const err = new Error(`Google ${what} failed (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    await new Promise((resolve) => { setTimeout(resolve, RETRY_DELAYS_MS[attempt]); });
  }
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

  const meta = await call(`${API}/${id}?fields=sheets(properties(sheetId,title,hidden,sheetType,gridProperties(columnCount,frozenRowCount)),protectedRanges(protectedRangeId,description))`, { headers }, 'sheet list');
  const tabs = (meta.sheets ?? [])
    .map((s) => ({ ...s.properties, protectedRanges: s.protectedRanges ?? [] }))
    .filter((p) => (p.sheetType ?? 'GRID') === 'GRID');

  const out = [];
  for (let i = 0; i < tabs.length; i += RANGES_PER_CALL) {
    const group = tabs.slice(i, i + RANGES_PER_CALL);
    const qs = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' });
    group.forEach((t) => qs.append('ranges', quoteTab(t.title)));
    const { valueRanges = [] } = await call(`${API}/${id}/values:batchGet?${qs}`, { headers }, 'sheet read');
    if (valueRanges.length !== group.length) throw new Error('Google sheet read returned the wrong number of tabs');
    group.forEach((t, n) => out.push({
      name: t.title, gid: t.sheetId, values: valueRanges[n].values ?? [],
      ...(t.gridProperties?.columnCount && { columnCount: t.gridProperties.columnCount }),
      ...(t.gridProperties && { frozenRows: t.gridProperties.frozenRowCount ?? 0 }),
      ...(t.protectedRanges.length && { protections: t.protectedRanges.map((r) => ({ id: r.protectedRangeId, description: r.description ?? '' })) }),
    }));
  }
  return out;
}

const json = (token, body) => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Write cells. `grow` = [{ gid, columns }]: add columns to a tab first (writing
 * past a tab's last column is refused by Google). `data` = [{ range, values }].
 * RAW, never USER_ENTERED: a note typed as "=IMPORTXML(…)" must land as text,
 * not run as a formula inside the team's sheet.
 */
export async function writeCells(spreadsheetId, { grow = [], data = [] }, account = readServiceAccount()) {
  if (!account) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not set');
  if (!grow.length && !data.length) return { updatedCells: 0 };
  const token = await accessToken(account);
  const id = encodeURIComponent(spreadsheetId);
  if (grow.length) {
    const requests = grow.map((g) => ({ appendDimension: { sheetId: g.gid, dimension: 'COLUMNS', length: g.columns } }));
    await call(`${API}/${id}:batchUpdate`, json(token, { requests }), 'sheet columns');
  }
  if (!data.length) return { updatedCells: 0 };
  const res = await call(`${API}/${id}/values:batchUpdate`, json(token, { valueInputOption: 'RAW', data }), 'sheet write');
  return { updatedCells: res.totalUpdatedCells ?? 0 };
}

/**
 * Sheet structure and formatting in one call (spreadsheets.batchUpdate): adding,
 * moving and styling the panel's columns. Google applies the requests in order,
 * all or nothing.
 */
export async function updateLayout(spreadsheetId, requests, account = readServiceAccount()) {
  if (!account) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not set');
  if (!requests.length) return { replies: 0 };
  const token = await accessToken(account);
  const res = await call(`${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, json(token, { requests }), 'sheet layout');
  return { replies: (res.replies ?? []).length };
}

/** The robot's address (not secret): shown so the owner knows whom to share the sheet with. */
export function serviceAccountEmail() {
  try { return readServiceAccount()?.email ?? null; } catch { return null; }
}

export const a1Column = (index) => {
  let n = index + 1;
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
export const a1Cell = (tab, row, col) => `${quoteTab(tab)}!${a1Column(col)}${row}`;
