/**
 * Training over HTTP. Push is a double; everything else is real.
 *
 * What must hold:
 *   - the answer key reaches nobody sitting the test: not the paper, not the result
 *   - the test stays shut until every lesson is finished; a removed lesson can't block it
 *   - 3 attempts, then only a manager can allow more; two "Start"s cost one attempt
 *   - handing in twice keeps the first answers
 *   - written answers wait for the head, and only then is there a score
 *   - nobody marks or signs off their own training; a buddy never sees scores
 *   - sign-off needs a pass, and a finished training can't be moved
 *   - editing the path changes neither an existing plan nor a past score
 *   - another team gets 404; a member can't read a path's answers
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const pushed = [];
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async (who, msg) => { pushed.push({ who, msg }); return 0; }, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffLesson } = await import('../models/StaffLesson.js');
const { default: StaffLessonProgress } = await import('../models/StaffLessonProgress.js');
const { StaffTrainingAssignment, StaffTrainingAttempt } = await import('../models/StaffTraining.js');

const BASE = '/api/v1/staff/training';
const PW = 'SecurePass123!';
const csrfFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] ?? '';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const c = (r) => r.set('X-XSRF-TOKEN', csrf);
  return {
    get: (u) => agent.get(`${BASE}${u}`),
    post: (u, b = {}) => c(agent.post(`${BASE}${u}`)).send(b),
    patch: (u, b = {}) => c(agent.patch(`${BASE}${u}`)).send(b),
    del: (u) => c(agent.delete(`${BASE}${u}`)),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email), id: String(user._id) };
};
const procurement = (x = {}) => ({ team: 'procurement', active: true, ...x });

describe('Training', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffTrainingAssignment.init(); await StaffTrainingAttempt.init(); await StaffLessonProgress.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let head; let joiner; let buddy; let outsider; let lessons;
  beforeEach(async () => {
    pushed.length = 0;
    admin = await makeUser('Admin', 'admin');
    head = await makeUser('Head', 'staff', procurement({ isHead: true }));
    joiner = await makeUser('Joiner', 'staff', procurement());
    buddy = await makeUser('Buddy', 'staff', procurement());
    outsider = await makeUser('Outsider', 'staff', { team: 'sales', active: true });
    const base = { audience: 'procurement', owner: head.user._id, createdBy: head.user._id, lastCheckedAt: new Date() };
    lessons = await StaffLesson.insertMany([{ ...base, title: 'Raise a PO' }, { ...base, title: 'Supplier calls' }]);
  });

  const choice = (text, right = 'Yes', extra = {}) => ({ type: 'choice', text, options: ['Yes', 'No', 'Maybe'], correct: ['Yes', 'No', 'Maybe'].indexOf(right), ...extra });
  const makePath = async (questions = [choice('Q1'), choice('Q2')]) => {
    const res = await head.s.post('/paths', {
      title: 'Procurement executive', team: 'procurement',
      items: [{ stage: 'day1', lessonId: String(lessons[0]._id) }, { stage: 'week1', lessonId: String(lessons[1]._id) }],
      questions,
    });
    expect(res.status).toBe(201);
    return res.body.path;
  };
  const assign = async (path) => {
    const res = await head.s.post(`/paths/${path.id}/assign`, { userId: joiner.id, buddyId: buddy.id });
    expect(res.status).toBe(201);
    return res.body.assignment;
  };
  const finishLessons = () => StaffLessonProgress.insertMany(lessons.map((l) => ({ lesson: l._id, user: joiner.user._id, completedAt: new Date() })));
  const ready = async (questions) => { const a = await assign(await makePath(questions)); await finishLessons(); return a; };
  const start = async (a) => { const r = await joiner.s.post(`/assignments/${a.id}/test`); expect(r.status).toBe(200); return r.body.attempt; };
  /** Answers everything right (or wrong), looking up the key the server stored. */
  const hand = async (a, attempt, right = true, written = 'My answer') => {
    const stored = await StaffTrainingAttempt.findById(attempt.id).lean();
    const answers = Object.fromEntries(stored.questions.map((q) => [q.qid, q.type === 'written' ? written : (right ? q.correct : (q.correct + 1) % q.options.length)]));
    return joiner.s.post(`/assignments/${a.id}/test/submit`, { attemptId: attempt.id, answers });
  };

  describe('setting up', () => {
    test('a head sets up their own team only; a member cannot', async () => {
      await makePath();
      expect((await head.s.post('/paths', { title: 'x', team: 'sales' })).status).toBe(403);
      expect((await joiner.s.post('/paths', { title: 'x', team: 'procurement' })).status).toBe(403);
    });

    test('a member cannot read a path or its answers', async () => {
      const p = await makePath();
      expect((await joiner.s.get(`/paths/${p.id}`)).status).toBe(404);
      expect((await joiner.s.get('/paths')).status).toBe(403);
      expect((await outsider.s.get(`/paths/${p.id}`)).status).toBe(404);
      expect((await head.s.get(`/paths/${p.id}`)).body.path.questions[0].correct).toBe(0);
    });

    test.each([
      ['no right answer', { type: 'choice', text: 'Q', options: ['a', 'b'] }],
      ['one option', { type: 'choice', text: 'Q', options: ['a'], correct: 0 }],
      ['a repeated option', { type: 'choice', text: 'Q', options: ['a', 'a'], correct: 0 }],
      ['no text', { type: 'written', text: ' ' }],
    ])('refuses a question with %s', async (_n, q) => {
      expect((await head.s.post('/paths', { title: 'x', team: 'procurement', questions: [q] })).status).toBe(400);
    });

    test('a lesson the team cannot open is refused', async () => {
      const other = await StaffLesson.create({ title: 'Sales only', audience: 'sales', owner: head.user._id, createdBy: head.user._id, lastCheckedAt: new Date() });
      expect((await head.s.post('/paths', { title: 'x', team: 'procurement', items: [{ stage: 'day1', lessonId: String(other._id) }] })).status).toBe(400);
    });

    test('of two editors, the second is told', async () => {
      const p = await makePath();
      expect((await head.s.patch(`/paths/${p.id}`, { rev: p.rev, title: 'A' })).status).toBe(200);
      expect((await admin.s.patch(`/paths/${p.id}`, { rev: p.rev, title: 'B' })).status).toBe(409);
    });
  });

  describe('assigning', () => {
    test('needs a lesson and a question', async () => {
      const r = await head.s.post('/paths', { title: 'Empty', team: 'procurement' });
      expect((await head.s.post(`/paths/${r.body.path.id}/assign`, { userId: joiner.id, buddyId: buddy.id })).status).toBe(400);
    });
    test('must be someone in the team, with a different buddy', async () => {
      const p = await makePath();
      expect((await head.s.post(`/paths/${p.id}/assign`, { userId: outsider.id, buddyId: buddy.id })).status).toBe(400);
      expect((await head.s.post(`/paths/${p.id}/assign`, { userId: joiner.id, buddyId: joiner.id })).status).toBe(400);
      expect((await head.s.post(`/paths/${p.id}/assign`, { userId: head.id, buddyId: buddy.id })).status).toBe(400);
    });
    test('a double click assigns once; both people are told', async () => {
      const p = await makePath();
      await assign(p);
      expect((await head.s.post(`/paths/${p.id}/assign`, { userId: joiner.id, buddyId: buddy.id })).status).toBe(409);
      expect(await StaffTrainingAssignment.countDocuments({})).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(pushed.map((p2) => p2.who[0].userId).sort()).toEqual([joiner.id, buddy.id].sort());
    });
    test('editing the path later does not change the plan', async () => {
      const p = await makePath();
      const a = await assign(p);
      await head.s.patch(`/paths/${p.id}`, { rev: p.rev, items: [] });
      expect((await joiner.s.get(`/assignments/${a.id}`)).body.assignment.items).toHaveLength(2);
    });
  });

  describe('who sees what', () => {
    test('the team head and admin see all; another team gets nothing', async () => {
      const a = await ready();
      expect((await head.s.get('/assignments?view=team')).body.assignments).toHaveLength(1);
      expect((await admin.s.get('/assignments?view=team')).body.assignments).toHaveLength(1);
      expect((await outsider.s.get(`/assignments/${a.id}`)).status).toBe(404);
      expect((await joiner.s.get('/assignments?view=team')).status).toBe(403);
    });
    test('the list counts finished lessons', async () => {
      await ready();
      const [row] = (await joiner.s.get('/assignments')).body.assignments;
      expect(row).toMatchObject({ lessonsDone: 2, lessonsTotal: 2 });
    });
    test('a buddy sees progress, never scores', async () => {
      const a = await ready();
      await hand(a, await start(a));
      const seen = (await buddy.s.get(`/assignments/${a.id}`)).body.assignment;
      expect(seen.lessonsDone).toBe(2);
      expect(seen.attempts).toEqual([]);
      expect(seen.attemptsUsed).toBeUndefined();
      expect(JSON.stringify(seen)).not.toContain('"score"');
    });
  });

  describe('the test', () => {
    test('stays shut until every lesson is finished', async () => {
      const a = await assign(await makePath());
      expect((await joiner.s.post(`/assignments/${a.id}/test`)).status).toBe(409);
      expect((await joiner.s.get(`/assignments/${a.id}`)).body.assignment.can.startTest).toBe(false);
    });
    test('a lesson removed from the library cannot block it', async () => {
      const a = await assign(await makePath());
      await StaffLessonProgress.create({ lesson: lessons[0]._id, user: joiner.user._id, completedAt: new Date() });
      await StaffLesson.updateOne({ _id: lessons[1]._id }, { archivedAt: new Date() });
      expect((await joiner.s.get(`/assignments/${a.id}`)).body.assignment.can.startTest).toBe(true);
    });
    test('only the person can sit it', async () => {
      const a = await ready();
      expect((await buddy.s.post(`/assignments/${a.id}/test`)).status).toBe(403);
      expect((await head.s.post(`/assignments/${a.id}/test`)).status).toBe(403);
    });
    test('the paper and the result never carry the answers', async () => {
      const a = await ready();
      const paper = await start(a);
      expect(JSON.stringify(paper)).not.toContain('correct');
      const res = await hand(a, paper, false);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('correct');
      expect(text).not.toContain('"right"');
      expect(JSON.stringify((await joiner.s.get(`/assignments/${a.id}`)).body)).not.toContain('correct');
    });
    test('options are shuffled but still mark correctly', async () => {
      const qs = Array.from({ length: 20 }, (_, i) => choice(`Q${i}`, 'No'));
      const a = await ready(qs);
      const paper = await start(a);
      const orders = new Set(paper.questions.map((q) => q.options.join()));
      expect(orders.size).toBeGreaterThan(1);
      const answers = Object.fromEntries(paper.questions.map((q) => [q.id, q.options.indexOf('No')]));
      const res = await joiner.s.post(`/assignments/${a.id}/test/submit`, { attemptId: paper.id, answers });
      expect(res.body.result).toMatchObject({ score: 100, passed: true });
    });
    test('two presses of Start cost one attempt; coming back resumes', async () => {
      const a = await ready();
      const [x, y] = await Promise.all([joiner.s.post(`/assignments/${a.id}/test`), joiner.s.post(`/assignments/${a.id}/test`)]);
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      expect(x.body.attempt.id).toBe(y.body.attempt.id);
      expect(await StaffTrainingAttempt.countDocuments({})).toBe(1);
    });
    test('handing in twice keeps the first answers', async () => {
      const a = await ready();
      const paper = await start(a);
      const first = await hand(a, paper, false);
      expect(first.body.result.passed).toBe(false);
      const second = await hand(a, paper, true);
      expect(second.body.result).toMatchObject({ passed: false, score: first.body.result.score });
    });
    test('exactly 80% passes', async () => {
      const qs = Array.from({ length: 5 }, (_, i) => choice(`Q${i}`));
      const a = await ready(qs);
      const paper = await start(a);
      const stored = await StaffTrainingAttempt.findById(paper.id).lean();
      const answers = Object.fromEntries(stored.questions.map((q, i) => [q.qid, i === 0 ? (q.correct + 1) % 3 : q.correct]));
      const res = await joiner.s.post(`/assignments/${a.id}/test/submit`, { attemptId: paper.id, answers });
      expect(res.body.result).toMatchObject({ score: 80, passed: true });
    });
    test('blank answers are wrong, and a nonsense answer cannot crash it', async () => {
      const a = await ready();
      const paper = await start(a);
      const res = await joiner.s.post(`/assignments/${a.id}/test/submit`, { attemptId: paper.id, answers: { [paper.questions[0].id]: 99 } });
      expect(res.body.result).toMatchObject({ score: 0, passed: false });
    });
    test('a failure names the lessons to re-read', async () => {
      const a = await ready([choice('Q1', 'Yes', { lessonId: String(lessons[1]._id) })]);
      const res = await hand(a, await start(a), false);
      expect(res.body.result.toReview).toEqual(['Supplier calls']);
    });
    test('editing the test later never changes a past score', async () => {
      const p = await makePath();
      const a = await assign(p);
      await finishLessons();
      await hand(a, await start(a));
      await head.s.patch(`/paths/${p.id}`, { rev: p.rev, questions: [choice('New')] });
      const [t] = (await head.s.get(`/assignments/${a.id}`)).body.assignment.attempts;
      expect(t.score).toBe(100);
      expect(t.questions.map((q) => q.text).sort()).toEqual(['Q1', 'Q2']);
    });
  });

  describe('attempts', () => {
    const fail = async (a) => hand(a, await start(a), false);
    test('3 attempts, then the head must allow another', async () => {
      const a = await ready();
      await fail(a); await fail(a); await fail(a);
      const after = (await joiner.s.get(`/assignments/${a.id}`)).body.assignment;
      expect(after.status).toBe('needs_help');
      expect(after.can.startTest).toBe(false);
      expect((await joiner.s.post(`/assignments/${a.id}/test`)).status).toBe(409);
      expect((await joiner.s.post(`/assignments/${a.id}/allow-retry`)).status).toBe(403);
      const allowed = await head.s.post(`/assignments/${a.id}/allow-retry`);
      expect(allowed.body.assignment.status).toBe('learning');
      expect((await joiner.s.post(`/assignments/${a.id}/test`)).status).toBe(200);
    });
    test('a retry cannot be granted while attempts remain', async () => {
      const a = await ready();
      expect((await head.s.post(`/assignments/${a.id}/allow-retry`)).status).toBe(409);
    });
  });

  describe('written answers', () => {
    const qs = () => [choice('Q1'), { type: 'written', text: 'Explain' }];
    test('wait for the head, then count', async () => {
      const a = await ready(qs());
      const res = await hand(a, await start(a));
      expect(res.body.result).toMatchObject({ status: 'marking', score: null, passed: null });
      const view = (await head.s.get(`/assignments/${a.id}`)).body.assignment;
      expect(view.status).toBe('marking');
      const written = view.attempts[0].questions.find((q) => q.type === 'written');
      expect(written.answer).toBe('My answer');
      const marked = await head.s.post(`/assignments/${a.id}/test/mark`, { attemptId: view.attempts[0].id, marks: { [written.id]: true } });
      expect(marked.body.assignment.status).toBe('ready_for_signoff');
      expect(marked.body.assignment.attempts[0].score).toBe(100);
    });
    test('must all be marked, once, and only by a manager', async () => {
      const a = await ready(qs());
      const paper = await start(a);
      await hand(a, paper);
      expect((await head.s.post(`/assignments/${a.id}/test/mark`, { attemptId: paper.id, marks: {} })).status).toBe(400);
      expect((await buddy.s.post(`/assignments/${a.id}/test/mark`, { attemptId: paper.id, marks: {} })).status).toBe(403);
      const q = paper.questions.find((x) => x.type === 'written');
      expect((await head.s.post(`/assignments/${a.id}/test/mark`, { attemptId: paper.id, marks: { [q.id]: false } })).status).toBe(200);
      expect((await head.s.post(`/assignments/${a.id}/test/mark`, { attemptId: paper.id, marks: { [q.id]: true } })).status).toBe(409);
    });
    test('a written answer left blank is wrong with nothing to mark', async () => {
      const a = await ready(qs());
      const res = await hand(a, await start(a), true, '');
      expect(res.body.result).toMatchObject({ status: 'graded', score: 50, passed: false });
    });
  });

  describe('sign-off', () => {
    test('needs a pass', async () => {
      const a = await ready();
      expect((await head.s.post(`/assignments/${a.id}/sign-off`)).status).toBe(409);
    });
    test('a pass can be signed off once, and frees the path for a later reassign', async () => {
      const a = await ready();
      await hand(a, await start(a));
      expect((await buddy.s.post(`/assignments/${a.id}/sign-off`)).status).toBe(403);
      const res = await head.s.post(`/assignments/${a.id}/sign-off`);
      expect(res.body.assignment).toMatchObject({ status: 'signed_off', signedOffByName: 'Head' });
      expect((await head.s.post(`/assignments/${a.id}/sign-off`)).status).toBe(409);
      expect((await head.s.post(`/assignments/${a.id}/cancel`)).status).toBe(409);
      const [row] = (await head.s.get('/paths')).body.paths;
      expect((await head.s.post(`/paths/${row.id}/assign`, { userId: joiner.id, buddyId: buddy.id })).status).toBe(201);
    });
    test('nobody signs off their own, even a head', async () => {
      const p = await makePath();
      const a = await admin.s.post(`/paths/${p.id}/assign`, { userId: head.id, buddyId: buddy.id });
      await StaffLessonProgress.insertMany(lessons.map((l) => ({ lesson: l._id, user: head.user._id, completedAt: new Date() })));
      await StaffTrainingAssignment.updateOne({ _id: a.body.assignment.id }, { status: 'ready_for_signoff' });
      expect((await head.s.post(`/assignments/${a.body.assignment.id}/sign-off`)).status).toBe(403);
      expect((await admin.s.post(`/assignments/${a.body.assignment.id}/sign-off`)).status).toBe(200);
    });
  });

  test('a crash after saving an attempt heals on the next read', async () => {
    const a = await ready();
    await hand(a, await start(a));
    await StaffTrainingAssignment.updateOne({ _id: a.id }, { status: 'learning' });
    expect((await head.s.get(`/assignments/${a.id}`)).body.assignment.status).toBe('ready_for_signoff');
  });

  test('cursor pages are complete and never overlap', async () => {
    const owner = head.user._id;
    await StaffTrainingAssignment.insertMany(Array.from({ length: 30 }, () => ({
      path: owner, pathTitle: 'x', team: 'procurement', user: joiner.user._id, buddy: owner, assignedBy: owner, active: false,
    })));
    const first = (await joiner.s.get('/assignments')).body;
    const second = (await joiner.s.get(`/assignments?cursor=${first.nextCursor}`)).body;
    expect(first.assignments).toHaveLength(24);
    expect(second.assignments).toHaveLength(6);
    expect(new Set([...first.assignments, ...second.assignments].map((a) => a.id)).size).toBe(30);
  });
});
