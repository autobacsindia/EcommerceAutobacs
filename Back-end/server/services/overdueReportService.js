/**
 * The morning "Overdue orders" email — the same check as the team-chat digest
 * (services/chatStuckDigest.js), as an email for the stand-up.
 *
 *   • info@ (OVERDUE_REPORT_TO) gets the whole report every working morning,
 *     including "nothing overdue", so a silent inbox never means "it broke".
 *   • each team with something overdue gets its own section, sent to that team's
 *     active head and members. Staff on internal `.invalid` addresses are skipped
 *     (emailHandler refuses them too).
 *
 * "Overdue" is exactly the chat digest's rule (STUCK_AFTER_HOURS per stage), read
 * from the same bounded scan, so the two can never disagree. Read-only. The cron
 * wrapper (cronService) makes it once per day across replicas.
 */
import emailHandler from './emailHandler.js';
import userRepository from '../repositories/userRepository.js';
import { collectStuck, STUCK_AFTER_HOURS } from './chatStuckDigest.js';
import { orderNumber } from './invoiceService.js';
import { STAGE, STAGE_LABELS } from '../utils/teamWorkflow.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const SITE = 'https://www.autobacsindia.com';
export const DEFAULT_REPORT_TO = 'info@autobacsindia.com';

/** Report sections, in stand-up order. Operations owns parcels in transit. */
export const REPORT_TEAMS = Object.freeze(['sales', 'procurement', 'accounts', 'operations']);
const STAGE_ORDER = [
  STAGE.CUSTOMER_DECISION, STAGE.STOCK_CHECK, STAGE.OWN_STOCK, STAGE.TO_SHIP, STAGE.PAYMENT_PENDING, STAGE.WITH_SUPPLIER,
  STAGE.ACCOUNTS_APPROVAL, STAGE.SHIPPED,
];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageLabel = (stage) => STAGE_LABELS[stage];
const teamLabel = (team) => STAFF_TEAM_LABELS[team] || team;
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')) && !/\.invalid$/i.test(String(e));

const customerOf = (o) => o.shippingAddress?.fullName || o.user?.name || '';
const itemsOf = (o) => {
  const names = (o.items || []).map((i) => i.name).filter(Boolean);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
};

/** byTeam (team → stage → [{order, since}]) → team → rows, most overdue first. */
export function reportRows(byTeam, now = Date.now()) {
  const out = new Map();
  for (const team of REPORT_TEAMS) {
    const stages = byTeam.get(team);
    const rows = [];
    for (const stage of STAGE_ORDER) {
      for (const { order, since } of stages?.get(stage) || []) {
        rows.push({
          orderId: String(order._id),
          order: orderNumber(order),
          customer: customerOf(order),
          items: itemsOf(order),
          stage: stageLabel(stage),
          days: Math.max(1, Math.floor((now - since) / DAY)),
          limitHours: STUCK_AFTER_HOURS[stage],
        });
      }
    }
    rows.sort((a, b) => b.days - a.days);
    out.set(team, rows);
  }
  return out;
}

const dateLine = (now) => new Date(now).toLocaleDateString('en-IN', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
});

function sectionHtml(team, rows) {
  const head = `<h2 style="margin:26px 0 8px;font-size:17px;color:#0F1111;">${esc(teamLabel(team))} — ${rows.length} overdue</h2>`;
  if (!rows.length) return `${head}<p style="margin:0;color:#0A7A3B;font-size:14px;">Clear.</p>`;
  const th = (t) => `<th align="left" style="padding:8px 10px;background:#F1F4F2;font-size:12px;color:#55605A;border-bottom:1px solid #E1E8E3;">${t}</th>`;
  const td = (t, extra = '') => `<td style="padding:8px 10px;font-size:13px;color:#0F1111;border-bottom:1px solid #EDF1EE;${extra}">${t}</td>`;
  const body = rows.map((r) => `<tr>${[
    td(`<a href="${SITE}/admin/orders/${esc(r.orderId)}" style="color:#0A5C33;font-weight:600;text-decoration:none;">${esc(r.order)}</a>`),
    td(esc(r.customer)),
    td(esc(r.items)),
    td(esc(r.stage)),
    td(`${r.days}`, 'color:#C0262D;font-weight:700;text-align:right;'),
  ].join('')}</tr>`).join('');
  return `${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E1E8E3;">
<tr>${th('Order')}${th('Customer')}${th('Product')}${th('Stage')}<th align="right" style="padding:8px 10px;background:#F1F4F2;font-size:12px;color:#55605A;border-bottom:1px solid #E1E8E3;">Days</th></tr>${body}</table>`;
}

function sectionText(team, rows) {
  const head = `${teamLabel(team)} — ${rows.length} overdue`;
  if (!rows.length) return `${head}\n  Clear.`;
  return [head, ...rows.map((r) => `  ${r.order} · ${r.customer} · ${r.items} · ${r.stage} · ${r.days} day${r.days === 1 ? '' : 's'}`)].join('\n');
}

/**
 * The email for `teams` (all of them for info@, one for a team).
 * @returns {{ subject, text, html, total }}
 */
export function buildReport(rowsByTeam, teams, now = Date.now()) {
  const total = teams.reduce((n, t) => n + (rowsByTeam.get(t)?.length || 0), 0);
  const scope = teams.length === 1 ? `${teamLabel(teams[0])}: ` : '';
  const subject = total
    ? `Overdue orders — ${scope}${total} item${total === 1 ? '' : 's'} need action`
    : `Overdue orders — ${scope}nothing overdue today`;
  const day = dateLine(now);
  const footer = 'Sent automatically by the Autobacs India website every working morning. '
    + 'Overdue = waiting at one step longer than its limit (new order 1 day, customer decision 2 days, '
    + 'in stock 2 days, payment pending 1 day, ordered from supplier 5 days, refund approval 1 day, dispatched 7 days). Clear these before the 09:30 stand-up.';

  const text = [
    'Overdue orders',
    `${day} · ${total} overdue`,
    '',
    ...teams.map((t) => sectionText(t, rowsByTeam.get(t) || [])).flatMap((s) => [s, '']),
    `Open the team panel: ${SITE}/team`,
    '',
    footer,
  ].join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overdue orders</title></head>
<body style="margin:0;padding:0;background:#EEF2EF;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2EF;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">
<tr><td style="background:#0B0F0D;padding:18px 28px;"><img src="${SITE}/images/roavion-logo.png" width="120" alt="ROAVION" style="display:block;width:120px;height:auto;border:0;color:#fff;font-weight:700;"></td></tr>
<tr><td style="background:#0F7A43;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 28px;">
<h1 style="margin:0;font-size:22px;color:#0F1111;">Overdue orders</h1>
<p style="margin:6px 0 0;font-size:13px;color:#6B756F;">${esc(day)} · ${total} overdue</p>
${teams.map((t) => sectionHtml(t, rowsByTeam.get(t) || [])).join('\n')}
<p style="margin:26px 0 0;"><a href="${SITE}/team" style="display:inline-block;background:#0A5C33;color:#FFFFFF;padding:11px 22px;border-radius:999px;font-size:14px;font-weight:700;text-decoration:none;">Open the team panel →</a></p>
<p style="margin:22px 0 0;font-size:11px;line-height:17px;color:#97A09A;">${esc(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject, text, html, total };
}

/**
 * Collect what is overdue and send today's emails.
 * @returns {{ summarySent: boolean, total: number, teams: Record<string, number> }}
 */
export async function sendOverdueReport(now = Date.now()) {
  const rowsByTeam = reportRows(await collectStuck(now), now);
  const to = String(process.env.OVERDUE_REPORT_TO || DEFAULT_REPORT_TO).trim();

  const summary = buildReport(rowsByTeam, REPORT_TEAMS, now);
  let summarySent = false;
  if (validEmail(to)) {
    const res = await emailHandler.sendEmail({ to, subject: summary.subject, text: summary.text, html: summary.html });
    summarySent = !!res?.success;
  }

  const teams = {};
  for (const team of REPORT_TEAMS) {
    const rows = rowsByTeam.get(team) || [];
    if (!rows.length) continue;
    const people = (await userRepository.findActiveStaff(team))
      .map((u) => String(u.email || '').trim().toLowerCase())
      .filter((e) => validEmail(e) && e !== to.toLowerCase());
    const unique = [...new Set(people)];
    if (!unique.length) continue;
    const mail = buildReport(rowsByTeam, [team], now);
    // One message per person: a shared To: line would show every address to all.
    const results = await Promise.allSettled(unique.map((addr) =>
      emailHandler.sendEmail({ to: addr, subject: mail.subject, text: mail.text, html: mail.html })));
    teams[team] = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
  }

  return { summarySent, total: summary.total, teams };
}

export default { sendOverdueReport, buildReport, reportRows };
