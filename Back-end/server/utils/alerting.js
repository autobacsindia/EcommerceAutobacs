import * as Sentry from '@sentry/node';

// In-memory dedupe: suppress repeated alerts for the same issue within the window.
// Resets on process restart — good enough for transient spikes without Redis dependency.
const lastAlertTime = new Map();
const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicate(key) {
  const now = Date.now();
  const last = lastAlertTime.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  lastAlertTime.set(key, now);
  return false;
}

/**
 * Send a P1 (critical / immediate action required) alert to Slack.
 *
 * Only fires in production and only when SLACK_WEBHOOK_URL is set.
 * Deduplicates by title — same alert fires at most once per 5 minutes.
 *
 * @param {{ title: string, errorId?: string, url?: string, method?: string,
 *           statusCode?: number, message?: string, context?: Record<string,any> }} opts
 */
export async function sendP1Alert({ title, errorId, url, method, statusCode, message, context = {} }) {
  if (process.env.NODE_ENV !== 'production') return;

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  if (isDuplicate(title)) return;

  const fields = [
    { title: 'Error ID',    value: errorId || 'N/A',                          short: true  },
    { title: 'Status',      value: String(statusCode || 'N/A'),                short: true  },
    { title: 'Endpoint',    value: `${method || ''} ${url || ''}`.trim(),      short: false },
    { title: 'Message',     value: (message || 'No message').slice(0, 300),    short: false },
    { title: 'Time (UTC)',  value: new Date().toISOString(),                   short: true  },
    ...Object.entries(context).map(([k, v]) => ({ title: k, value: String(v), short: true })),
  ];

  const payload = {
    text: `🚨 *P1 ALERT — ${title}*`,
    attachments: [{ color: '#cc0000', fields }],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[Alerting] Slack webhook returned', res.status);
    }
  } catch (err) {
    // Never let alerting crash the app
    console.error('[Alerting] Failed to send Slack P1 alert:', err.message);
  }
}

/**
 * Send a P1 alert AND capture the error in Sentry with a 'p1' tag.
 * Use this for critical errors caught outside the Express error handler
 * (e.g. database connection loss, payment gateway failures).
 */
export async function reportP1({ title, error, context = {} }) {
  if (process.env.NODE_ENV !== 'production') return;

  // Tag in Sentry
  try {
    Sentry.withScope((scope) => {
      scope.setTag('alert_level', 'p1');
      scope.setTag('p1_title', title);
      scope.setExtras(context);
      Sentry.captureException(error || new Error(title));
    });
  } catch (_) { /* never let Sentry crash */ }

  // Notify Slack
  await sendP1Alert({
    title,
    message: error?.message,
    context,
  });
}
