/**
 * The ClickUp import (scripts/lib/clickupImport.js) against a made-up sample
 * workspace (tests/fixtures/clickup-sample.json) and a real in-memory Mongo.
 *
 * What must hold:
 *   - folders → projects with their lists; folder-less lists → their own project
 *   - ClickUp statuses → the project's own statuses by kind, every task on the right one
 *   - people matched by email (any case); unmatched ones listed, their tasks with
 *     the owner and their names kept in the notes
 *   - original dates kept: created, due (with time only when ClickUp had one), done
 *   - comments keep their author (or the author's name) and their time
 *   - re-running creates nothing twice and changes no imported task;
 *     a comment added in ClickUp since is the only thing a re-run adds
 *   - nothing is sent (no inbox lines)
 *   - rollback removes exactly the import; a hand-made task in an imported project stays
 *   - the API client keeps the token in the header, waits on 429, and says what a 401 means
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';

jest.setTimeout(120000);

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: Counter } = await import('../models/Counter.js');
const { reconcileProjectTasks } = await import('../services/staffProjectService.js');
const lib = await import('../scripts/lib/clickupImport.js');

const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/clickup-sample.json', import.meta.url), 'utf8'));
const sample = () => structuredClone(SAMPLE);
const models = { StaffProject, StaffTask, StaffTaskComment, Counter };

let owner, jenna, amar;
let usersByEmail;
beforeAll(async () => { await Promise.all([StaffTask.init(), StaffProject.init(), StaffTaskComment.init()]); });
beforeEach(async () => {
  const mk = (name, email, role, staff) => User.create({ name, email, phone: '9000000001', passwordHash: 'x', role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  owner = await mk('Vyshnav', `owner${Date.now()}@autobacs.test`, 'staff', { team: 'developer', isHead: true });
  jenna = await mk('Jenna', 'jenna@clickup.test', 'staff', { team: 'marketing' });
  amar = await mk('Amarnath', 'amar@clickup.test', 'staff', { team: 'marketing' });
  usersByEmail = new Map([owner, jenna, amar].map((u) => [u.email, u.toObject()]));
});
afterEach(async () => {
  await Promise.all([User.deleteMany({}), StaffTask.deleteMany({}), StaffProject.deleteMany({}), StaffTaskComment.deleteMany({}), StaffTaskInbox.deleteMany({})]);
});

const plan = (snap = sample()) => lib.buildPlan(snap, { usersByEmail, owner: owner.toObject() });
const apply = (p) => lib.applyPlan(p, { models, owner: owner.toObject(), reconcile: reconcileProjectTasks });
const byKey = (k) => StaffTask.findOne({ importKey: `clickup:${k}` }).lean();

describe('the plan (no database)', () => {
  it('maps folders, lists, statuses, people, dates and fields', () => {
    const p = plan();
    expect(p.projects.map((x) => x.name)).toEqual(['Black Friday 2026', 'Office admin']);
    const bf = p.projects[0];
    expect(bf.lists.map((l) => l.name)).toEqual(['Ads', 'Website']);
    // The Ads list's statuses first, then the space's (Website uses the space's), each once.
    expect(bf.stages.map((s) => [s.name, s.type])).toEqual([
      ['To do', 'todo'], ['In review', 'in_progress'], ['Complete', 'done'], ['Backlog', 'todo'], ['Doing', 'in_progress'], ['Shipped', 'done'],
    ]);
    const banners = bf.tasks.find((t) => t.key === 'clickup:cu1');
    expect(banners).toMatchObject({
      title: 'Design the Black Friday banners', priority: 'high', status: 'in_progress', dueOn: '2026-11-20', dueTime: '10:30', startOn: '2026-11-16',
      tags: ['design', 'bf2026'], estimateMinutes: 90, checklist: [{ text: 'Square', done: true }, { text: 'Wide', done: false }],
    });
    expect(banners.stage.name).toBe('In review');
    expect(banners.people.map((u) => u.name)).toEqual(['Jenna']);
    expect(banners.description).toMatch(/assigned to Old Freelancer/);
    expect(banners.description).toMatch(/brief\.pdf — https:\/\/example\.test\/brief\.pdf/);
    expect(banners.comments.map((c) => c.text)).toEqual(['First draft is up.', 'Old Freelancer (in ClickUp): Use the red logo.']);
    // No time in ClickUp → no time here; a start after the due day is dropped; nobody → the owner.
    const meta = bf.tasks.find((t) => t.key === 'clickup:cu3');
    expect(meta).toMatchObject({ dueOn: '2026-11-25', dueTime: null, startOn: null, priority: 'normal' });
    expect(meta.people.map((u) => u.name)).toEqual(['Vyshnav']);
    // Parents first.
    expect(bf.tasks.findIndex((t) => t.key === 'clickup:cu2')).toBeGreaterThan(bf.tasks.findIndex((t) => t.key === 'clickup:cu1'));
    expect(p.unmatched).toEqual([expect.objectContaining({ name: 'Old Freelancer', email: 'freelancer@gone.test' })]);
    expect(p.counts).toMatchObject({ projects: 2, lists: 2, tasks: 5, subtasks: 1, comments: 2 });
  });

  it('small helpers: kinds, priorities, colours, IST days', () => {
    expect(['open', 'custom', 'done', 'closed', 'whatever'].map(lib.stageType)).toEqual(['todo', 'in_progress', 'done', 'done', 'in_progress']);
    expect([{ id: '1' }, { id: '4' }, null, 'high'].map(lib.priorityOf)).toEqual(['urgent', 'low', 'normal', 'high']);
    expect(['#d3d3d3', '#6bc950', '#f9d900', '#4194f6', 'nope'].map(lib.colourOf)).toEqual(['gray', 'green', 'amber', 'blue', 'gray']);
    // 23:30 UTC is already the next day in India.
    expect(lib.istDay(String(Date.UTC(2026, 10, 15, 23, 30)))).toBe('2026-11-16');
    // At most 12 statuses, always keeping a not-started and a done one.
    const many = Array.from({ length: 14 }, (_, i) => ({ status: `s${i}`, type: i === 13 ? 'closed' : 'custom', orderindex: i }));
    const kept = lib.stagesFrom([many]);
    expect(kept).toHaveLength(12);
    expect(kept.some((s) => s.type === 'todo')).toBe(true);
    expect(kept.some((s) => s.type === 'done')).toBe(true);
  });
});

describe('writing the plan', () => {
  it('creates the projects and tasks with their original dates, people, statuses and comments — and sends nothing', async () => {
    const did = await apply(plan());
    expect(did).toMatchObject({ projectsCreated: 2, tasksCreated: 5, commentsCreated: 2 });
    const bf = await StaffProject.findOne({ importKey: 'clickup:folder:f1' }).lean();
    expect(bf.lists.map((l) => l.name)).toEqual(['Ads', 'Website']);
    expect(bf.people.map((x) => x.name).sort()).toEqual(['Amarnath', 'Jenna', 'Vyshnav']);

    const banners = await byKey('cu1');
    expect(banners).toMatchObject({ title: 'Design the Black Friday banners', status: 'in_progress', stageName: 'In review', bucket: 'open', dueTime: '10:30', commentCount: 2 });
    expect(String(banners.project)).toBe(String(bf._id));
    expect(String(banners.projectList)).toBe(String(bf.lists[0]._id));
    expect(banners.createdAt.toISOString()).toBe('2026-11-01T03:30:00.000Z');
    expect(banners.assignees.map((a) => a.name)).toEqual(['Jenna']);
    expect(banners.createdBy.equals(amar._id)).toBe(true);
    expect(banners.subtasks).toEqual({ total: 1, done: 1 });

    const square = await byKey('cu2');
    expect(square).toMatchObject({ status: 'done', bucket: 'done', stageName: 'Complete', parent: { number: banners.number } });
    expect(square.completedAt.toISOString()).toBe('2026-11-08T11:30:00.000Z');

    // A list with no statuses of its own uses the space's.
    expect(await byKey('cu4')).toMatchObject({ stageName: 'Doing', priority: 'urgent', status: 'in_progress' });
    // A folder-less list became its own project; its unmatched person's task is the owner's.
    const domain = await byKey('cu5');
    expect(domain).toMatchObject({ status: 'done', bucket: 'done', stageName: 'Shipped' });
    expect(domain.assignees.map((a) => a.name)).toEqual(['Vyshnav']);

    const comments = await StaffTaskComment.find({ task: banners._id }).sort({ createdAt: 1 }).lean();
    expect(comments.map((c) => [c.byName, c.text, c.createdAt.toISOString()])).toEqual([
      ['Jenna', 'First draft is up.', '2026-11-05T05:30:00.000Z'],
      ['Vyshnav', 'Old Freelancer (in ClickUp): Use the red logo.', '2026-11-06T06:30:00.000Z'],
    ]);
    expect(await StaffTaskInbox.countDocuments({})).toBe(0);
  });

  it('a second run creates nothing and changes no imported task; only a new ClickUp comment is added', async () => {
    await apply(plan());
    // Someone works on an imported task in the panel.
    await StaffTask.updateOne({ importKey: 'clickup:cu1' }, { $set: { title: 'Banners (edited here)' } });
    const before = await StaffTask.countDocuments({});
    const again = await apply(plan());
    expect(again).toMatchObject({ projectsCreated: 0, projectsReused: 2, tasksCreated: 0, tasksSkipped: 5, commentsCreated: 0, commentsSkipped: 2 });
    expect(await StaffTask.countDocuments({})).toBe(before);
    expect((await byKey('cu1')).title).toBe('Banners (edited here)');

    const later = sample();
    later.spaces[0].folders[0].lists[0].tasks[0].comments.push({ id: 'c3', comment_text: 'Approved.', user: { id: 102, username: 'Amarnath', email: 'amar@clickup.test' }, date: String(Date.UTC(2026, 10, 12)) });
    const third = await apply(plan(later));
    expect(third).toMatchObject({ tasksCreated: 0, commentsCreated: 1, commentsSkipped: 2 });
    expect((await byKey('cu1')).commentCount).toBe(3);
  });

  it('rollback counts first, then removes exactly the import; a hand-made task in an imported project stays', async () => {
    await apply(plan());
    const bf = await StaffProject.findOne({ importKey: 'clickup:folder:f1' }).lean();
    const mine = await StaffTask.create({
      number: 999999, title: 'Made by hand', status: 'todo', priority: 'normal', assignee: owner._id, assignees: [{ user: owner._id, name: 'Vyshnav' }],
      createdBy: owner._id, project: bf._id, projectList: bf.lists[0]._id, bucket: 'open', rank: '9999-12-31',
    });
    const counted = await lib.rollback({ models, apply: false });
    expect(counted).toMatchObject({ projects: 2, tasks: 5, comments: 2, importedComments: 2, otherTasksInProjects: 1 });
    expect(await StaffTask.countDocuments({})).toBe(6);
    await lib.rollback({ models, apply: true });
    expect(await StaffProject.countDocuments({})).toBe(0);
    expect(await StaffTaskComment.countDocuments({})).toBe(0);
    const left = await StaffTask.find({}).lean();
    expect(left.map((t) => t.title)).toEqual(['Made by hand']);
    expect(left[0].project).toBeUndefined();
    expect(left[0].projectList).toBeUndefined();
    expect(String(left[0]._id)).toBe(String(mine._id));
  });
});

describe('reading ClickUp', () => {
  const response = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  });

  it('sends the token only in the header, waits on 429, and explains a 401', async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return calls.length === 1 ? response(429, {}, { 'retry-after': '0' }) : response(200, { teams: [] });
    });
    const get = lib.clickupClient('pk_test_token', { fetchImpl, paceMs: 0 });
    await expect(get('/team')).resolves.toEqual({ teams: [] });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === 'pk_test_token' && !c.url.includes('pk_test_token'))).toBe(true);
    const denied = lib.clickupClient('bad', { fetchImpl: async () => response(401, {}), paceMs: 0 });
    await expect(denied('/team')).rejects.toThrow(/refused the token/);
    expect(() => lib.clickupClient('')).toThrow(/CLICKUP_API_TOKEN/);
  });

  it('reads every page of tasks and every comment, oldest comment first', async () => {
    const comments = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, date: String(1000 - i), comment_text: `n${i}` })); // newest first
    const get = async (path, params = {}) => {
      if (path === '/team') return { teams: [{ id: 9, name: 'W', members: [{ user: { id: 1, username: 'J', email: 'J@X.TEST' } }] }] };
      if (path === '/team/9/space') return { spaces: [{ id: 's', name: 'S', statuses: [] }] };
      if (path === '/space/s/folder') return { folders: [] };
      if (path === '/space/s/list') return { lists: [{ id: 'l', name: 'L', statuses: [] }] };
      if (path === '/list/l/task') return params.page === 0 ? { tasks: [{ id: 't1' }], last_page: false } : { tasks: [{ id: 't2' }], last_page: true };
      if (path.endsWith('/comment')) {
        if (path !== '/task/t1/comment') return { comments: [] };
        return params.start ? { comments: comments.slice(25) } : { comments: comments.slice(0, 25) };
      }
      throw new Error(`unexpected ${path}`);
    };
    const snap = await lib.fetchSnapshot(get, {});
    const tasks = snap.spaces[0].lists[0].tasks;
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tasks[0].comments).toHaveLength(30);
    expect(tasks[0].comments[0].id).toBe('c29');
    expect(snap.members[0].email).toBe('j@x.test');
    await expect(lib.fetchSnapshot(async () => ({ teams: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }), {})).rejects.toThrow(/--workspace/);
  });
});
