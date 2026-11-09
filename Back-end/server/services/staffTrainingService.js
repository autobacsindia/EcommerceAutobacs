/**
 * Training paths, the module test and the head's sign-off.
 *
 * Who may do what:
 *   manage a team's paths, assign, mark, allow a retry, sign off, cancel
 *            admin, or the head of that team. Nobody marks or signs off themselves.
 *   see an assignment
 *            the person, their buddy, the head, admin. Scores and answers never
 *            go to the buddy.
 * Someone who may not see a thing gets 404, not 403, so its existence does not leak.
 *
 * The answer key never leaves the server for the person sitting the test, before
 * or after: they could retry with it. They are told which lessons to re-read.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import repo from '../repositories/staffTrainingRepository.js';
import userRepository from '../repositories/userRepository.js';
import { TRAINING_STAGES } from '../models/StaffTraining.js';
import { STAFF_TEAM_LABELS, STAFF_TEAM_VALUES } from '../config/staff.js';
import { sendToUsers } from './pushService.js';

export const PASS_MARK = 80;
export const ATTEMPTS_ALLOWED = 3;
const PAGE_SIZE = 24;
const ITEMS_MAX = 100;
const QUESTIONS_MAX = 100;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 6;
const TEXT_MAX = 500;
const OPTION_MAX = 200;
const WRITTEN_ANSWER_MAX = 2000;
const LESSON_OPTIONS_MAX = 200;

const fail = (message, status) => new AppError(message, status, { expose: true });
const same = (a, b) => !!a && !!b && String(a) === String(b);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);
const isHeadOf = (u, team) => isActiveStaff(u) && u.staff.isHead === true && u.staff.team === team;

export const canManageTeam = (u, team) => isAdmin(u) || isHeadOf(u, team);
const isManagerAnywhere = (u) => isAdmin(u) || (isActiveStaff(u) && u.staff.isHead === true);
const canSee = (u, a) => canManageTeam(u, a.team) || same(u._id, a.user) || same(u._id, a.buddy);
const canSeeScores = (u, a) => canManageTeam(u, a.team) || same(u._id, a.user);
/** Decide on someone's training: a manager, and never your own. */
const canDecide = (u, a) => canManageTeam(u, a.team) && !same(u._id, a.user);

function decodeCursor(cursor) {
  if (!cursor) return null;
  const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
  if (!mongoose.isValidObjectId(raw)) throw fail('Invalid page cursor.', 400);
  return new mongoose.Types.ObjectId(raw);
}
const encodeCursor = (id) => Buffer.from(String(id)).toString('base64url');
function paged(rows) {
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  return { page, nextCursor: more ? encodeCursor(page[page.length - 1]._id) : null };
}

/** Pop-ups are best effort: the change is already saved, and this never throws. */
async function notify(actor, ids, assignmentId, message) {
  try {
    const wanted = [...new Set(ids.map(String))].filter((x) => x && !same(x, actor._id));
    if (!wanted.length) return;
    const people = await userRepository.findChatUsersByIds(wanted);
    if (!people.length) return;
    await sendToUsers(
      people.map((u) => ({ userId: String(u._id), url: `${isAdmin(u) ? '/admin' : '/team'}/training/${assignmentId}` })),
      { ...message, tag: `training-${assignmentId}` },
    );
  } catch (err) {
    console.error('[StaffTraining] push failed (ignored):', err.message);
  }
}

/** The team's head, or every admin when the team has none. */
async function managersOf(team) {
  const staff = await userRepository.findActiveStaff(team);
  const heads = staff.filter((p) => p.staff.isHead);
  if (heads.length) return heads.map((p) => p._id);
  return (await userRepository.findChatUsers()).filter(isAdmin).map((u) => u._id);
}

// ── Paths ───────────────────────────────────────────────────────────────────

function cleanTitle(raw) {
  const title = String(raw ?? '').trim();
  if (!title) throw fail('Give the training a job title.', 400);
  if (title.length > 100) throw fail('Keep the title under 100 characters.', 400);
  return title;
}

async function cleanItems(raw, team) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > ITEMS_MAX) throw fail(`A training can hold at most ${ITEMS_MAX} lessons.`, 400);
  const ids = raw.map((i) => String(i?.lessonId ?? ''));
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw fail('Choose a lesson for every row.', 400);
  if (new Set(ids).size !== ids.length) throw fail('A lesson can only be in the training once.', 400);
  const live = new Map((await repo.liveLessons(ids)).map((l) => [String(l._id), l]));
  return raw.map((item) => {
    const lesson = live.get(String(item.lessonId));
    // The person being trained has to be able to open it.
    if (!lesson || !['company', team].includes(lesson.audience)) throw fail('A lesson in this training is not available to this team.', 400);
    if (!TRAINING_STAGES.includes(item.stage)) throw fail('Choose Day 1, Week 1 or Month 1 for every lesson.', 400);
    return { stage: item.stage, lesson: lesson._id, title: lesson.title };
  });
}

async function cleanQuestions(raw, team) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > QUESTIONS_MAX) throw fail(`A test can have at most ${QUESTIONS_MAX} questions.`, 400);
  const linked = raw.map((q) => q?.lessonId).filter(Boolean).map(String);
  if (linked.some((id) => !mongoose.isValidObjectId(id))) throw fail('A question points at a lesson that does not exist.', 400);
  const live = new Map((linked.length ? await repo.liveLessons(linked) : []).map((l) => [String(l._id), l]));
  return raw.map((q, n) => {
    const where = `Question ${n + 1}`;
    const text = String(q?.text ?? '').trim();
    if (!text) throw fail(`${where} needs some text.`, 400);
    if (text.length > TEXT_MAX) throw fail(`${where} is too long.`, 400);
    let lesson = null;
    if (q.lessonId) {
      lesson = live.get(String(q.lessonId));
      if (!lesson || !['company', team].includes(lesson.audience)) throw fail(`${where} points at a lesson this team can't open.`, 400);
    }
    const base = {
      ...(mongoose.isValidObjectId(q.id) ? { _id: q.id } : {}),
      text, lesson: lesson?._id ?? null, lessonTitle: lesson?.title ?? '',
    };
    if (q.type === 'written') return { ...base, type: 'written', options: [], correct: null };
    if (q.type !== 'choice') throw fail(`${where} needs a type.`, 400);
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim());
    if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) throw fail(`${where} needs ${OPTIONS_MIN} to ${OPTIONS_MAX} options.`, 400);
    if (options.some((o) => !o || o.length > OPTION_MAX)) throw fail(`${where} has an empty or very long option.`, 400);
    if (new Set(options).size !== options.length) throw fail(`${where} has the same option twice.`, 400);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= options.length) throw fail(`${where} needs the right answer marked.`, 400);
    return { ...base, type: 'choice', options, correct: q.correct };
  });
}

function shapePath(p, full) {
  return {
    id: String(p._id),
    title: p.title,
    team: p.team,
    teamLabel: STAFF_TEAM_LABELS[p.team] || p.team,
    rev: p.rev,
    lessonCount: (p.items || []).length,
    questionCount: (p.questions || []).length,
    createdByName: p.createdByName,
    createdAt: p.createdAt,
    ...(full ? {
      items: p.items.map((i) => ({ stage: i.stage, lessonId: String(i.lesson), title: i.title })),
      questions: p.questions.map((q) => ({
        id: String(q._id), type: q.type, text: q.text, options: q.options, correct: q.correct, lessonId: q.lesson ? String(q.lesson) : '', lessonTitle: q.lessonTitle,
      })),
    } : {}),
  };
}

async function loadManagedPath(actor, id) {
  const path = await repo.findLivePath(id);
  if (!path || !canManageTeam(actor, path.team)) throw fail('Training not found.', 404);
  return path;
}

export function trainingMeta(actor) {
  const teams = isAdmin(actor) ? [...STAFF_TEAM_VALUES] : (isManagerAnywhere(actor) ? [actor.staff.team] : []);
  return {
    teams: teams.map((key) => ({ key, label: STAFF_TEAM_LABELS[key] || key })),
    passMark: PASS_MARK,
    attemptsAllowed: ATTEMPTS_ALLOWED,
  };
}

export async function listPaths(actor, { team, cursor } = {}) {
  if (!isManagerAnywhere(actor)) throw fail('Only team heads and admins can see this.', 403);
  if (team && !canManageTeam(actor, team)) throw fail('You can only see your own team’s training.', 403);
  const filter = team ? { team } : (isAdmin(actor) ? {} : { team: actor.staff.team });
  const rows = await repo.pagePaths(filter, { before: decodeCursor(cursor), limit: PAGE_SIZE + 1 });
  const { page, nextCursor } = paged(rows);
  return { paths: page.map((p) => shapePath(p, false)), nextCursor };
}

export async function lessonOptions(actor, team) {
  if (!canManageTeam(actor, team)) throw fail('You can only set up your own team’s training.', 403);
  const rows = await repo.lessonOptions(team, LESSON_OPTIONS_MAX);
  return { lessons: rows.map((l) => ({ id: String(l._id), title: l.title })) };
}

export async function getPath(actor, id) {
  return shapePath(await loadManagedPath(actor, id), true);
}

export async function createPath(actor, input = {}, req) {
  const team = String(input.team ?? '');
  if (!STAFF_TEAM_VALUES.includes(team)) throw fail('Choose a team.', 400);
  if (!canManageTeam(actor, team)) throw fail('You can only set up your own team’s training.', 403);
  const doc = await repo.createPath({
    title: cleanTitle(input.title),
    team,
    items: await cleanItems(input.items, team),
    questions: await cleanQuestions(input.questions, team),
    createdBy: actor._id,
    createdByName: actor.name || '',
  });
  auditLogger.logAction(req, 'CREATE', 'StaffTrainingPath', doc._id, { team });
  return shapePath(doc, true);
}

export async function updatePath(actor, id, input = {}, req) {
  const path = await loadManagedPath(actor, id);
  const set = {};
  if (input.title !== undefined) set.title = cleanTitle(input.title);
  if (input.items !== undefined) set.items = await cleanItems(input.items, path.team);
  if (input.questions !== undefined) set.questions = await cleanQuestions(input.questions, path.team);
  if (!Object.keys(set).length) return shapePath(path, true);
  const updated = await repo.updatePathIfRev(path._id, Number(input.rev), set);
  if (!updated) throw fail('Someone else changed this training. Reload and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTrainingPath', path._id, { fields: Object.keys(set) });
  return shapePath(updated, true);
}

export async function archivePath(actor, id, req) {
  const path = await loadManagedPath(actor, id);
  if (!await repo.archivePath(path._id, new Date())) throw fail('Training not found.', 404);
  auditLogger.logAction(req, 'DELETE', 'StaffTrainingPath', path._id, { title: path.title });
  return { archived: true };
}

// ── Assignments ─────────────────────────────────────────────────────────────

/** Lessons on the plan that still count: one since removed from the library can't block anyone. */
async function planOf(a) {
  const ids = a.items.map((i) => i.lesson);
  const [live, done] = await Promise.all([repo.liveLessons(ids), repo.finished([a.user], ids)]);
  const liveIds = new Set(live.filter((l) => ['company', a.team].includes(l.audience)).map((l) => String(l._id)));
  const doneIds = new Set(done.map((d) => String(d.lesson)));
  const items = a.items.map((i) => ({
    stage: i.stage,
    lessonId: String(i.lesson),
    title: i.title,
    available: liveIds.has(String(i.lesson)),
    done: doneIds.has(String(i.lesson)),
  }));
  const required = items.filter((i) => i.available);
  return { items, required, allDone: required.every((i) => i.done) };
}

function shapeSummary(a, viewer, counts) {
  return {
    id: String(a._id),
    pathTitle: a.pathTitle,
    team: a.team,
    teamLabel: STAFF_TEAM_LABELS[a.team] || a.team,
    user: { id: String(a.user), name: a.userName },
    buddy: { id: String(a.buddy), name: a.buddyName },
    status: a.status,
    lessonsDone: counts?.done ?? 0,
    lessonsTotal: counts?.total ?? a.items.length,
    signedOffByName: a.signedOffByName,
    signedOffAt: a.signedOffAt,
    createdAt: a.createdAt,
  };
}

function shapeAttemptSummary(t) {
  const toReview = [...new Set(t.questions.filter((q) => q.right === false && q.lessonTitle).map((q) => q.lessonTitle))];
  return {
    id: String(t._id), number: t.number, status: t.status, score: t.score, passed: t.passed, submittedAt: t.submittedAt,
    toReview: t.status === 'graded' && !t.passed ? toReview : [],
  };
}

/** For a manager: everything, including what the right answer was. */
function shapeAttemptFull(t) {
  return {
    ...shapeAttemptSummary(t),
    markedByName: t.markedByName,
    questions: t.questions.map((q) => ({
      id: q.qid, type: q.type, text: q.text, options: q.options, correct: q.correct, answer: q.answer, right: q.right,
    })),
  };
}

/** For the person sitting it: never the right answers. */
function shapeOpenAttempt(t) {
  return {
    id: String(t._id), number: t.number,
    questions: t.questions.map((q) => ({ id: q.qid, type: q.type, text: q.text, options: q.options })),
  };
}

async function shapeDetail(actor, a, attempts) {
  const plan = await planOf(a);
  const seesScores = canSeeScores(actor, a);
  const manager = canDecide(actor, a);
  const open = same(actor._id, a.user) ? attempts.find((t) => t.status === 'open') : null;
  const used = attempts.length;
  const closed = attempts.filter((t) => t.status !== 'open');
  return {
    ...shapeSummary(a, actor, { done: plan.required.filter((i) => i.done).length, total: plan.required.length }),
    items: plan.items,
    passMark: PASS_MARK,
    attemptsUsed: seesScores ? used : undefined,
    attemptsAllowed: seesScores ? a.attemptsAllowed : undefined,
    attempts: seesScores ? closed.map(manager ? shapeAttemptFull : shapeAttemptSummary) : [],
    openAttempt: open ? shapeOpenAttempt(open) : null,
    can: {
      startTest: same(actor._id, a.user) && a.status === 'learning' && plan.allDone && !open && used < a.attemptsAllowed,
      mark: manager && a.status === 'marking',
      allowRetry: manager && a.status === 'needs_help',
      signOff: manager && a.status === 'ready_for_signoff',
      cancel: manager && a.active,
    },
  };
}

async function loadAssignment(actor, id) {
  const a = await repo.findAssignment(id);
  if (!a || !canSee(actor, a)) throw fail('Training not found.', 404);
  return a;
}

const statusFrom = (a, attempts) => {
  const last = attempts[attempts.length - 1];
  if (!last || last.status === 'open') return 'learning';
  if (last.status === 'marking') return 'marking';
  if (last.passed) return 'ready_for_signoff';
  return attempts.length >= a.attemptsAllowed ? 'needs_help' : 'learning';
};

/** Make the assignment match its attempts. Idempotent; never moves a finished one. */
async function syncAssignment(a, attempts) {
  const status = statusFrom(a, attempts);
  if (status === a.status || !a.active) return a;
  return (await repo.moveAssignment(a._id, ['learning', 'marking', 'ready_for_signoff', 'needs_help'], { status })) ?? a;
}

export async function assign(actor, pathId, { userId, buddyId } = {}, req) {
  const path = await loadManagedPath(actor, pathId);
  if (!path.items.length || !path.questions.length) throw fail('Add at least one lesson and one test question first.', 400);
  const [user, buddy] = await Promise.all([
    mongoose.isValidObjectId(userId) ? userRepository.findById(userId) : null,
    mongoose.isValidObjectId(buddyId) ? userRepository.findById(buddyId) : null,
  ]);
  if (!isActiveStaff(user) || user.staff.team !== path.team) throw fail('Choose someone in this team.', 400);
  if (same(actor._id, user._id)) throw fail('Someone else has to assign your training.', 400);
  if (!inPanel(buddy)) throw fail('Choose a buddy.', 400);
  if (same(buddy._id, user._id)) throw fail('A person can’t be their own buddy.', 400);

  let doc;
  try {
    doc = await repo.createAssignment({
      path: path._id, pathTitle: path.title, team: path.team,
      user: user._id, userName: user.name || '', buddy: buddy._id, buddyName: buddy.name || '',
      items: path.items, attemptsAllowed: ATTEMPTS_ALLOWED,
      assignedBy: actor._id, assignedByName: actor.name || '',
    });
  } catch (err) {
    if (err?.code === 11000) throw fail('This person is already on this training.', 409);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'StaffTrainingAssignment', doc._id, { path: path._id, user: user._id });
  void notify(actor, [user._id], doc._id, { title: 'You have new training', body: path.title });
  void notify(actor, [buddy._id], doc._id, { title: `You are ${user.name || 'a new joiner'}'s buddy`, body: path.title });
  return shapeDetail(actor, doc, []);
}

export async function listAssignments(actor, { view = 'mine', status, cursor } = {}) {
  const filter = {};
  if (view === 'mine') filter.user = actor._id;
  else if (view === 'buddy') filter.buddy = actor._id;
  else if (view === 'team') {
    if (!isManagerAnywhere(actor)) throw fail('Only team heads and admins can see this.', 403);
    if (!isAdmin(actor)) filter.team = actor.staff.team;
  }
  if (status) filter.status = status;
  const rows = await repo.pageAssignments(filter, { before: decodeCursor(cursor), limit: PAGE_SIZE + 1 });
  const { page, nextCursor } = paged(rows);

  // One query for every row's progress, never one per row.
  const lessonIds = [...new Set(page.flatMap((a) => a.items.map((i) => String(i.lesson))))];
  const done = lessonIds.length ? await repo.finished(page.map((a) => a.user), lessonIds) : [];
  const finished = new Set(done.map((d) => `${d.user}:${d.lesson}`));
  return {
    assignments: page.map((a) => shapeSummary(a, actor, {
      total: a.items.length,
      done: a.items.filter((i) => finished.has(`${a.user}:${i.lesson}`)).length,
    })),
    nextCursor,
  };
}

export async function getAssignment(actor, id) {
  let a = await loadAssignment(actor, id);
  const attempts = await repo.attemptsOf(a._id);
  a = await syncAssignment(a, attempts);
  return shapeDetail(actor, a, attempts);
}

const shuffled = (n) => {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

function snapshotQuestions(questions) {
  return shuffled(questions.length).map((qi) => {
    const q = questions[qi];
    const base = { qid: String(q._id), type: q.type, text: q.text, lessonTitle: q.lessonTitle };
    if (q.type === 'written') return { ...base, options: [], correct: null };
    const order = shuffled(q.options.length);
    return { ...base, options: order.map((o) => q.options[o]), correct: order.indexOf(q.correct) };
  });
}

/** Start the test, or come back to the one already open. Costs one attempt, once. */
export async function startAttempt(actor, id) {
  const a = await loadAssignment(actor, id);
  if (!same(actor._id, a.user)) throw fail('Only the person being trained can take this test.', 403);
  const attempts = await repo.attemptsOf(a._id);
  const open = attempts.find((t) => t.status === 'open');
  if (open) return shapeOpenAttempt(open);
  if (a.status !== 'learning') throw fail('The test isn’t open right now.', 409);
  if (attempts.length >= a.attemptsAllowed) throw fail('No attempts are left. Your head can allow another.', 409);
  const plan = await planOf(a);
  if (!plan.allDone) throw fail('Finish every lesson first.', 409);
  const path = await repo.findPath(a.path);
  if (!path?.questions?.length) throw fail('This test has no questions yet. Ask your head to add some.', 409);
  try {
    return shapeOpenAttempt(await repo.createAttempt({
      assignment: a._id, number: attempts.length + 1, questions: snapshotQuestions(path.questions), startedAt: new Date(),
    }));
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two presses at once: the other one started it.
    const winner = (await repo.attemptsOf(a._id)).find((t) => t.status === 'open');
    if (!winner) throw fail('The test isn’t open right now.', 409);
    return shapeOpenAttempt(winner);
  }
}

const scoreOf = (questions) => {
  const right = questions.filter((q) => q.right === true).length;
  return questions.length ? Math.round((right / questions.length) * 100) : 0;
};

function applyAnswers(attempt, answers) {
  const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  return attempt.questions.map((q) => {
    const raw = given[q.qid];
    if (q.type === 'written') {
      const answer = typeof raw === 'string' ? raw.trim().slice(0, WRITTEN_ANSWER_MAX) : '';
      // Left blank is simply wrong; nothing for the head to read.
      return { ...q, answer, right: answer ? null : false };
    }
    const answer = Number.isInteger(raw) && raw >= 0 && raw < q.options.length ? raw : null;
    return { ...q, answer, right: answer === q.correct };
  });
}

async function afterResult(actor, a, attempts, attempt) {
  const synced = await syncAssignment(a, attempts);
  if (synced.status === a.status) return synced;
  const body = `${a.userName} · ${a.pathTitle}`;
  if (synced.status === 'marking') void notify(actor, await managersOf(a.team), a._id, { title: 'A training test needs marking', body });
  if (synced.status === 'ready_for_signoff') void notify(actor, await managersOf(a.team), a._id, { title: `Passed with ${attempt.score}%: ready for sign-off`, body });
  if (synced.status === 'needs_help') void notify(actor, await managersOf(a.team), a._id, { title: 'Someone has used all their test attempts', body });
  return synced;
}

/** Hand in. A second press changes nothing; the first answers stand. */
export async function submitAttempt(actor, id, { attemptId, answers } = {}) {
  const a = await loadAssignment(actor, id);
  if (!same(actor._id, a.user)) throw fail('Only the person being trained can take this test.', 403);
  const attempt = mongoose.isValidObjectId(attemptId) ? await repo.findAttempt(attemptId) : null;
  if (!attempt || !same(attempt.assignment, a._id)) throw fail('Test not found.', 404);
  let result = attempt;
  if (attempt.status === 'open') {
    const questions = applyAnswers(attempt, answers);
    const needsMarking = questions.some((q) => q.right === null);
    const score = needsMarking ? null : scoreOf(questions);
    result = await repo.finishAttempt(attempt._id, 'open', {
      questions,
      status: needsMarking ? 'marking' : 'graded',
      submittedAt: new Date(),
      score,
      passed: needsMarking ? null : score >= PASS_MARK,
    }) ?? await repo.findAttempt(attempt._id);
  }
  const attempts = await repo.attemptsOf(a._id);
  const synced = await afterResult(actor, a, attempts, result);
  return { result: shapeAttemptSummary(result), assignment: await shapeDetail(actor, synced, attempts) };
}

/** The head marks written answers; `marks` is { questionId: true|false }. */
export async function markAttempt(actor, id, { attemptId, marks } = {}, req) {
  const a = await loadAssignment(actor, id);
  if (!canDecide(actor, a)) throw fail('Only the team head or an admin can mark this.', 403);
  const attempt = mongoose.isValidObjectId(attemptId) ? await repo.findAttempt(attemptId) : null;
  if (!attempt || !same(attempt.assignment, a._id)) throw fail('Test not found.', 404);
  if (attempt.status !== 'marking') throw fail('This test has already been marked.', 409);
  const given = marks && typeof marks === 'object' ? marks : {};
  const questions = attempt.questions.map((q) => {
    if (q.right !== null) return q;
    if (typeof given[q.qid] !== 'boolean') throw fail('Mark every written answer.', 400);
    return { ...q, right: given[q.qid] };
  });
  const score = scoreOf(questions);
  const marked = await repo.finishAttempt(attempt._id, 'marking', {
    questions, status: 'graded', score, passed: score >= PASS_MARK, markedByName: actor.name || '',
  });
  if (!marked) throw fail('This test has already been marked.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTrainingAttempt', attempt._id, { change: 'marked', score });
  const attempts = await repo.attemptsOf(a._id);
  const synced = await afterResult(actor, a, attempts, marked);
  void notify(actor, [a.user], a._id, { title: `Your test was marked: ${score}%`, body: a.pathTitle });
  return shapeDetail(actor, synced, attempts);
}

export async function allowRetry(actor, id, req) {
  const a = await loadAssignment(actor, id);
  if (!canDecide(actor, a)) throw fail('Only the team head or an admin can do this.', 403);
  const updated = await repo.allowAnotherAttempt(a._id, 'learning');
  if (!updated) throw fail('This person still has attempts left.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTrainingAssignment', a._id, { change: 'retry_allowed' });
  void notify(actor, [a.user], a._id, { title: 'You can take the test again', body: a.pathTitle });
  return shapeDetail(actor, updated, await repo.attemptsOf(a._id));
}

export async function signOff(actor, id, req) {
  const a = await loadAssignment(actor, id);
  if (!canDecide(actor, a)) throw fail('Only the team head or an admin can sign this off, and not their own.', 403);
  const updated = await repo.moveAssignment(a._id, ['ready_for_signoff'], {
    status: 'signed_off', active: false, signedOffBy: actor._id, signedOffByName: actor.name || '', signedOffAt: new Date(),
  });
  if (!updated) throw fail('This training isn’t ready to sign off.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTrainingAssignment', a._id, { change: 'signed_off' });
  void notify(actor, [a.user, a.buddy], a._id, { title: 'Training signed off', body: `${a.userName} · ${a.pathTitle}` });
  return shapeDetail(actor, updated, await repo.attemptsOf(a._id));
}

export async function cancelAssignment(actor, id, req) {
  const a = await loadAssignment(actor, id);
  if (!canDecide(actor, a)) throw fail('Only the team head or an admin can do this.', 403);
  const updated = await repo.moveAssignment(a._id, ['learning', 'marking', 'ready_for_signoff', 'needs_help'], { status: 'cancelled', active: false });
  if (!updated) throw fail('This training has already finished.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTrainingAssignment', a._id, { change: 'cancelled' });
  return shapeDetail(actor, updated, await repo.attemptsOf(a._id));
}

/** The bell: heads see their team's, admin sees everyone's. */
export async function countTrainingForBell(user) {
  if (isAdmin(user)) return repo.countWaiting(null);
  if (isActiveStaff(user) && user.staff.isHead) return repo.countWaiting(user.staff.team);
  return 0;
}
