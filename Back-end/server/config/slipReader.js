/**
 * Payment-slip reader settings (services/slipReader/*).
 *
 * The reader is OFF until ANTHROPIC_API_KEY is set in Railway → Variables. It
 * can also be switched off without removing the key: SLIP_READER_ENABLED=false.
 * Every value is read per call, so a variable change plus a restart is enough.
 *
 * It only ever SUGGESTS values for a person to check. Nothing it reads is saved
 * unless a person presses Save, and nothing is ever approved because of it.
 */

/** Opus 5.5 reads blurry phone photos best; set SLIP_READER_MODEL=claude-haiku-5-5 for the cheapest. */
export const DEFAULT_SLIP_MODEL = 'claude-opus-5-5';

/** How long staff wait before the form falls back to typing (the upload itself never waits on this). */
export const DEFAULT_SLIP_TIMEOUT_MS = 15_000;

/** Reads per person per hour. A busy salesman records a handful; a loop is not that. */
export const SLIP_READS_PER_HOUR = 30;

/** A read stays valid for "read from slip" tagging this long — a form left open over lunch still counts. */
export const SLIP_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const slipReaderConfig = () => ({
  enabled: process.env.SLIP_READER_ENABLED !== 'false' && Boolean(process.env.ANTHROPIC_API_KEY),
  model: String(process.env.SLIP_READER_MODEL || DEFAULT_SLIP_MODEL).trim(),
  timeoutMs: num(process.env.SLIP_READER_TIMEOUT_MS, DEFAULT_SLIP_TIMEOUT_MS),
  // Signs the "this is what the slip said" token. JWT_SECRET is always set (validateEnv);
  // the label below keeps a slip token from ever being valid as anything else.
  signingSecret: process.env.SLIP_READER_SIGNING_SECRET || process.env.JWT_SECRET || '',
});

export default slipReaderConfig;
