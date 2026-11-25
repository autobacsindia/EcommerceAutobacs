/**
 * Task deadline alerts: "only 2h left", "it's late — say why", then the heads,
 * then the admins. The ladder and every number are in config/taskAlerts.js.
 *
 * One pass (every 5 minutes, office time only — services/cronService.js):
 *   1. walk open, dated tasks due from LOOKBACK days ago up to today (keyset on
 *      staff_task_due_sweep, bounded by maxTasks)
 *   2. per task, work out when each level is due for its CURRENT deadline
 *   3. per page, ONE write for the bookkeeping that sends nothing (a ladder
 *      starting for a new deadline, levels long gone claimed silently); then each
 *      level to send is claimed on the task (compare-and-set on `alerts.<level>`
 *      for that deadline) and sent — so a second pass, a replica or a restart
 *      sends nothing twice, and a new date starts afresh
 *
 * Why not the order follow-up engine (services/followUp/*)? Its rows are order
 * steps (order, stage, line) and its resolve pass closes every open row that is not
 * an order step it just walked. Tasks reuse its office clock and its head/admin
 * gaps instead, so both ladders keep one clock without bending the order code.
 *
 * Personal tasks get nothing (nobody else is on them). A task waiting for a new
 * date to be approved does not go to the heads/admins: the reason is given and
 * the decision is with whoever gave it.
 *
 * Never throws: a failed task is logged and retried by the next pass.
 */
import * as Sentry from '@sentry/node';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import userRepository from '../repositories/userRepository.js';
import { loadTaskAlertConfig, TASK_ALERT_LEVELS } from '../config/taskAlerts.js';
import { addOfficeMinutes, isOfficeTime } from './followUp/officeClock.js';
import { sendTaskAlert, todayIST, peopleOf } from './staffTaskService.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** 'YYYY-MM-DD' + IST minutes after midnight → the UTC instant. */
const istAt = (day, minute = 0) => Date.parse(`${day}T00:00:00+05:30`) + minute * MIN;
const toMinute = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const addDaysYmd = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** "2h 10m", "45m", "3 days". */
export function leftText(ms) {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
  const d = Math.round(m / (24 * 60));
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** The deadline as people read it. */
const dueKey = (t) => (t.dueTime ? `${t.dueOn} ${t.dueTime}` : t.dueOn);
const dueWords = (t) => (t.dueTime ? `${t.dueTime}` : 'today');

/**
 * When each level of `t`'s current deadline is due, and until when it is still
 * worth sending (after that it is claimed silently). Pure.
 *   deadline  timed: the due time; untimed: the end of the due day (IST midnight),
 *             matching the panel, where an untimed task is late from the next day
 *   workEnd   the moment "time left" counts down to: the due time, or office closing
 */
export function ladderFor(t, cfg) {
  const deadline = t.dueTime ? istAt(t.dueOn, toMinute(t.dueTime)) : istAt(addDaysYmd(t.dueOn, 1));
  const workEnd = t.dueTime ? deadline : istAt(t.dueOn, cfg.office.endMinute);
  const soonAt = workEnd - cfg.soonMin * MIN;
  const head = addOfficeMinutes(new Date(deadline), cfg.headAfterMin, cfg.office).getTime();
  const admin = addOfficeMinutes(new Date(deadline), cfg.adminAfterMin, cfg.office).getTime();
  const stale = cfg.staleMin * MIN;
  return {
    deadline,
    workEnd,
    at: { today: istAt(t.dueOn, cfg.office.startMinute), soon: soonAt, late: deadline, head, admin },
    // Past these, a level is history: "due today" once "only Xh left" is due,
    // "only Xh left" once it is late, the rest a day after their moment.
    until: { today: Math.min(soonAt, workEnd), soon: Math.min(deadline, workEnd), late: deadline + stale, head: head + stale, admin: admin + stale },
  };
}

/** Who hears each level, and what. `people` = { heads(teams), admins() } (cached per pass). */
async function messagesFor(level, t, ladder, now, people) {
  const doers = peopleOf(t).map((p) => idOf(p.user)).filter(Boolean);
  const giver = idOf(t.createdBy);
  const doing = doers.length ? doers : [giver];
  const code = `T-${t.number}`;
  const name = (peopleOf(t)[0]?.name || '').trim() || 'The team';
  const left = leftText(ladder.workEnd - now);

  if (level === 'today') {
    return [{ ids: doing, kind: 'due_soon', text: `Due today${t.dueTime ? ` at ${t.dueTime}` : ''} — ${left} left`,
      title: `${code} is due today${t.dueTime ? ` at ${t.dueTime}` : ''}`, body: `${t.title} · ${left} left` }];
  }
  if (level === 'soon') {
    return [{ ids: doing, kind: 'due_soon', text: `Only ${left} left — due ${dueWords(t)}`,
      title: `⏰ Only ${left} left: ${code}`, body: `${t.title} · due ${dueWords(t)}. Finish it, or ask for more time now.` }];
  }
  if (level === 'late') {
    const out = [{ ids: doing, kind: 'due_late', text: `Late — was due ${dueKey(t)}. Say why and give a new date.`,
      title: `${code} is late`, body: `${t.title} · was due ${dueKey(t)}. Say why and give a new date.` }];
    if (doers.length && !doers.includes(giver)) {
      out.push({ ids: [giver], kind: 'due_late', text: `${name}'s task is late — was due ${dueKey(t)}.`,
        title: `${name}'s ${code} is late`, body: `${t.title} · was due ${dueKey(t)}.` });
    }
    return out;
  }
  const lateBy = leftText(now - ladder.deadline);
  const teams = [...new Set([...(t.teams || []), t.team].filter(Boolean))];
  const ids = (level === 'head' ? await people.heads(teams) : await people.admins())
    .filter((x) => !doers.includes(x));
  if (!ids.length) return [];
  return [{ ids, kind: 'due_escalated', text: `${name}'s task is ${lateBy} late — no new date asked yet.`,
    title: `⚠ ${name}'s ${code} is ${lateBy} late`, body: `${t.title} · was due ${dueKey(t)}. No reason or new date yet.` }];
}

/**
 * What one task needs this pass: whether its ladder starts afresh (a new
 * deadline), which due levels are history (claimed silently) and which are sent.
 * Pure.
 */
export function planTask(t, now, cfg) {
  const due = dueKey(t);
  const fresh = t.alerts?.due !== due;
  const claimed = fresh ? {} : t.alerts;
  const ladder = ladderFor(t, cfg);
  const waitingForDecision = t.lateRequest?.status === 'pending';
  const silent = [];
  const live = [];
  for (const level of TASK_ALERT_LEVELS) {
    if (now < ladder.at[level] || claimed[level]) continue;
    if ((level === 'head' || level === 'admin') && waitingForDecision) continue;
    (now >= ladder.until[level] || cfg.mode === 'shadow' ? silent : live).push(level);
  }
  return { due, fresh, silent, live, ladder };
}

/** The levels this pass sends for one task: each claimed first (compare-and-set), then sent. */
async function sendLive(t, plan, ctx) {
  const { now, out, people, deps } = ctx;
  for (const level of plan.live) {
    const won = await staffTaskRepository.claimAlert(t._id, {
      due: plan.due, dueOn: t.dueOn, dueTime: t.dueTime, level, at: new Date(now),
    });
    if (!won) continue;
    const messages = await messagesFor(level, t, plan.ladder, now, people);
    for (const m of messages) {
      await deps.send(t, m.ids, { kind: m.kind, key: `t:${idOf(t._id)}:due:${plan.due}:${level}`, text: m.text, title: m.title, body: m.body });
    }
    out.sent[level] += 1;
  }
}

/** One page: the bookkeeping that sends nothing in one write, then the alerts. */
async function handlePage(page, ctx) {
  const { now, cfg, out } = ctx;
  const plans = page.filter((t) => !t.personal).map((t) => ({ t, plan: planTask(t, now, cfg) }));
  const at = new Date(now);
  const writes = plans
    .filter(({ plan }) => plan.fresh || plan.silent.length)
    .map(({ t, plan }) => ({ id: t._id, due: plan.due, dueOn: t.dueOn, dueTime: t.dueTime, fresh: plan.fresh, levels: plan.silent, at }));
  await staffTaskRepository.settleAlerts(writes);
  out.silent += writes.reduce((n, w) => n + w.levels.length, 0);
  for (const { t, plan } of plans) {
    if (!plan.live.length) continue;
    try {
      await sendLive(t, plan, ctx);
    } catch (err) {
      out.failed += 1;
      console.error(`[TaskAlerts] task ${idOf(t._id)} failed:`, err.message);
      Sentry.captureException(err);
    }
  }
}

/** Heads per team set and the admins, read once per pass. */
function peopleCache() {
  const heads = new Map();
  let admins = null;
  return {
    heads: async (teams) => {
      const k = [...teams].sort().join(',');
      if (!heads.has(k)) heads.set(k, (await userRepository.findTeamHeads(teams)).map((u) => idOf(u._id)));
      return heads.get(k);
    },
    admins: async () => {
      admins ??= (await userRepository.findAdmins()).map((u) => idOf(u._id));
      return admins;
    },
  };
}

/**
 * One pass. `env` and `deps` are for tests (deps.send replaces the Inbox + push).
 * @returns {Promise<object>} counts of what it did
 */
export async function runTaskAlertSweep({ now = new Date(), env = process.env, deps = {} } = {}) {
  const cfg = loadTaskAlertConfig(env);
  const nowMs = now.getTime();
  const out = { mode: cfg.mode, skipped: null, scanned: 0, sent: Object.fromEntries(TASK_ALERT_LEVELS.map((l) => [l, 0])), silent: 0, failed: 0, truncated: false };
  if (cfg.mode === 'off') { out.skipped = 'off'; return out; }
  // Nobody is woken at night for a task: the next office pass picks it up.
  if (!isOfficeTime(now, cfg.office)) { out.skipped = 'outside_office'; return out; }

  const today = todayIST(now);
  const ctx = { now: nowMs, cfg, out, people: peopleCache(), deps: { send: deps.send || sendTaskAlert } };
  let after = null;
  try {
    while (out.scanned < cfg.maxTasks) {
      const limit = Math.min(cfg.pageSize, cfg.maxTasks - out.scanned);
      const page = await staffTaskRepository.dueSweepPage({ from: addDaysYmd(today, -cfg.lookbackDays), to: today, after, limit });
      await handlePage(page, ctx);
      out.scanned += page.length;
      if (page.length < limit) break;
      const last = page[page.length - 1];
      after = { dueOn: last.dueOn, id: last._id };
    }
    out.truncated = out.scanned >= cfg.maxTasks;
    if (out.truncated) console.warn(`[TaskAlerts] stopped after ${out.scanned} tasks — the rest wait for the next pass`);
  } catch (err) {
    out.failed += 1;
    console.error('[TaskAlerts] sweep failed:', err.message);
    Sentry.captureException(err);
  }
  return out;
}
