import Anthropic from '@anthropic-ai/sdk';

/**
 * The one place that talks to the Claude API for slip reading. It returns the
 * raw fields as printed on the slip; slipReaderService cleans and checks them.
 *
 * Never logs the slip or what was read — only that a read happened, how long
 * it took and how many tokens it used.
 */

const SYSTEM = [
  'You read Indian payment receipts and screenshots: Google Pay, PhonePe, Paytm, BHIM and other UPI apps,',
  'net-banking / NEFT / RTGS / IMPS confirmations, bank statements and PDF payment advices.',
  'Copy values exactly as printed. Never guess, never calculate, never fill in a value that is not visible.',
  'Use "" for any text that is not on the slip and 0 for an amount that is not on the slip.',
  'reference: the bank UTR or the UPI reference / UPI transaction ID (usually 12 digits for UPI).',
  'If the slip shows several IDs, put the UTR / UPI reference in reference and every other ID',
  '(app transaction ID, order ID, Google transaction ID) in otherReferences.',
  'referenceLabel: the label printed beside the reference, e.g. "UTR", "UPI Ref No", "Transaction ID".',
  'amount: the amount that was paid, as a number in rupees (no symbol, no commas).',
  'date: YYYY-MM-DD. time: HH:MM in 24-hour time, as printed (Indian slips are in IST).',
  'paymentStatus: "success", "failed", "pending" or "unknown", from what the slip says.',
  'readable: false when the image is not a payment slip or is too unclear to read the reference or the amount.',
].join(' ');

/** Plain strings and numbers (no nulls) keep the schema simple for every model. */
export const SLIP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'readable', 'reference', 'referenceLabel', 'otherReferences', 'amount', 'currency', 'date', 'time',
    'paymentStatus', 'payerName', 'payeeName', 'payeeAccount', 'appOrBank',
  ],
  properties: {
    readable: { type: 'boolean' },
    reference: { type: 'string' },
    referenceLabel: { type: 'string' },
    otherReferences: { type: 'array', items: { type: 'string' } },
    amount: { type: 'number' },
    currency: { type: 'string' },
    date: { type: 'string' },
    time: { type: 'string' },
    paymentStatus: { type: 'string', enum: ['success', 'failed', 'pending', 'unknown'] },
    payerName: { type: 'string' },
    payeeName: { type: 'string' },
    payeeAccount: { type: 'string' },
    appOrBank: { type: 'string' },
  },
});

/** A reason the read did not work. The form then just asks for typing. */
export class SlipReadError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'SlipReadError';
    this.reason = reason; // 'timeout' | 'unavailable' | 'refused' | 'bad_output' | 'config'
  }
}

let client = null;
let clientKey = '';
const getClient = () => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key });
    clientKey = key;
  }
  return client;
};

// Server-side fallback (a declined read re-runs on a sibling model) exists on these.
const SUPPORTS_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5)/;

/**
 * @param {{ data: string, mediaType: string, isPdf: boolean, model: string, timeoutMs: number }} input base64 bytes
 * @returns {Promise<object>} the fields as printed (see SLIP_SCHEMA)
 */
export async function extractSlipFields({ data, mediaType, isPdf, model, timeoutMs }) {
  const source = { type: 'base64', media_type: mediaType, data };
  const params = {
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SLIP_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        isPdf ? { type: 'document', source } : { type: 'image', source },
        { type: 'text', text: 'Read this payment slip.' },
      ],
    }],
  };
  const fallback = SUPPORTS_FALLBACK.test(model);
  const started = Date.now();
  let response;
  try {
    // One attempt within the time limit: staff are waiting, and they can always type.
    const options = { timeout: timeoutMs, maxRetries: 0 };
    response = fallback
      ? await getClient().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options)
      : await getClient().messages.create(params, options);
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new SlipReadError('timeout');
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error('[SlipReader] the API key was refused — check ANTHROPIC_API_KEY in Railway');
      throw new SlipReadError('config');
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[SlipReader] API error ${err.status ?? 'network'}`);
      throw new SlipReadError('unavailable');
    }
    throw new SlipReadError('unavailable');
  }
  const ms = Date.now() - started;
  const usage = response?.usage || {};
  console.info(`[SlipReader] read in ${ms}ms model=${response?.model || model} in=${usage.input_tokens ?? '?'} out=${usage.output_tokens ?? '?'} stop=${response?.stop_reason}`);

  if (response?.stop_reason === 'refusal') throw new SlipReadError('refused');
  if (response?.stop_reason === 'max_tokens') throw new SlipReadError('bad_output');
  const text = (response?.content || []).find((b) => b.type === 'text')?.text;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return { ...parsed, model: response?.model || model };
  } catch {
    throw new SlipReadError('bad_output');
  }
}

export default { extractSlipFields, SlipReadError, SLIP_SCHEMA };
