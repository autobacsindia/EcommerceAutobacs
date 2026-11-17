/**
 * Project IDs (PRJ-0007): models/StaffProject.js numbers every new project,
 * scripts/lib/backfillProjectNumbers.js numbers the ones from before, and
 * services/staffProjectService.js projectForLink resolves a typed code.
 *
 * What must hold:
 *   - every new project gets the next number, also when made outside the service
 *   - two creates at the same moment never share a number; a double-click makes one
 *   - the number never changes once set
 *   - the backfill numbers old projects oldest first, only those, and can be re-run
 *   - a typed code links only to a live project the person may see
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const { default: User } = await import('../models/User.js');
const { default: Counter } = await import('../models/Counter.js');
const { default: StaffProject, projectCode, projectNumberIn } = await import('../models/StaffProject.js');
const projects = await import('../services/staffProjectService.js');
const { backfillProjectNumbers, rollbackProjectNumbers } = await import('../scripts/lib/backfillProjectNumbers.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `pn${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const start = async (actor, input = {}) => (await projects.createProject(await as(actor), { name: 'Diwali launch', ...input }, req)).project;

let admin, mkHead, prMember;
beforeAll(async () => { await StaffProject.init(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Owner');
  mkHead = await person('staff', { team: 'marketing', isHead: true }, 'Meera');
  prMember = await person('staff', { team: 'procurement' }, 'Arun');
});

describe('the code', () => {
  it('formats and reads back', () => {
    expect(projectCode(7)).toBe('PRJ-0007');
    expect(projectCode(12345)).toBe('PRJ-12345');
    expect(projectCode(undefined)).toBeNull();
    for (const typed of ['PRJ-0007', 'prj7', 'PRJ 7', ' prj-07 ', '7']) expect(projectNumberIn(typed)).toBe(7);
    for (const typed of ['', 'PRJ-', 'PRJ-0', 'T-7', 'x7', '7a', '-7', '1.5', null, undefined, {}]) expect(projectNumberIn(typed)).toBeNull();
  });
});

describe('numbering new projects', () => {
  it('gives each new project the next number and shows it', async () => {
    const a = await start(mkHead);
    const b = await start(admin, { name: 'Website' });
    expect(a.code).toMatch(/^PRJ-\d{4}$/);
    expect(projectNumberIn(b.code)).toBe(projectNumberIn(a.code) + 1);
    expect((await projects.getProject(await as(mkHead), a.id)).code).toBe(a.code);
    expect((await projects.listProjects(await as(admin))).projects.map((p) => p.code)).toEqual(expect.arrayContaining([a.code, b.code]));
    expect((await projects.pickableProjects(await as(admin))).projects[0].code).toMatch(/^PRJ-/);
  });

  it('numbers a project saved outside the service too (the ClickUp importer path)', async () => {
    const doc = await new StaffProject({
      name: 'Imported', owner: { user: admin._id, name: 'Owner' }, rank: '9999-12-31', createdBy: admin._id,
    }).save();
    expect(doc.number).toBeGreaterThan(0);
  });

  it('never gives two projects created at the same moment the same number', async () => {
    const made = await Promise.all(Array.from({ length: 12 }, (_, i) => start(admin, { name: `P${i}` })));
    expect(new Set(made.map((p) => p.code)).size).toBe(12);
  });

  it('a double-clicked create makes one project and uses one number', async () => {
    const [x, y] = await Promise.all([start(mkHead, { clientId: 'create-abc-123' }), start(mkHead, { clientId: 'create-abc-123' })]);
    expect(x.id).toBe(y.id);
    expect(x.code).toBe(y.code);
    expect(await StaffProject.countDocuments({ clientId: 'create-abc-123' })).toBe(1);
  });

  it('the number cannot be changed afterwards', async () => {
    const p = await start(mkHead);
    const doc = await StaffProject.findById(p.id);
    doc.number = 999999;
    await doc.save();
    expect((await StaffProject.findById(p.id).lean()).number).toBe(projectNumberIn(p.code));
  });

  it('the unique index refuses a duplicate number', async () => {
    const p = await start(mkHead);
    await expect(StaffProject.collection.insertOne({ name: 'dup', number: projectNumberIn(p.code), rank: 'x' })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('backfill for projects from before IDs', () => {
  const raw = (name, createdAt) => StaffProject.collection.insertOne({
    name, owner: { user: admin._id, name: 'Owner' }, people: [], teams: [], rank: '9999-12-31', rev: 1, archivedAt: null,
    createdBy: admin._id, createdAt, updatedAt: createdAt,
  });

  it('dry run changes nothing; --apply numbers oldest first; a re-run does nothing; rollback undoes only its own', async () => {
    await Counter.deleteOne({ _id: 'staffProject' });
    await StaffProject.deleteMany({});
    const newer = await raw('Newer', new Date('2026-05-02'));
    const older = await raw('Older', new Date('2026-01-10'));

    const dry = await backfillProjectNumbers({ StaffProject, Counter });
    expect(dry.numbered.map((r) => [r.name, r.code])).toEqual([['Older', 'PRJ-0001'], ['Newer', 'PRJ-0002']]);
    expect(await StaffProject.countDocuments({ number: { $type: 'number' } })).toBe(0);

    await backfillProjectNumbers({ StaffProject, Counter }, { apply: true });
    expect((await StaffProject.findById(older.insertedId).lean()).number).toBe(1);
    expect((await StaffProject.findById(newer.insertedId).lean()).number).toBe(2);

    const fresh = await start(admin, { name: 'After' });
    expect(fresh.code).toBe('PRJ-0003');
    expect((await backfillProjectNumbers({ StaffProject, Counter }, { apply: true })).numbered).toEqual([]);

    expect((await rollbackProjectNumbers({ StaffProject }, { apply: true })).count).toBe(2);
    expect((await StaffProject.findById(older.insertedId).lean()).number).toBeUndefined();
    expect((await StaffProject.findById(fresh.id).lean()).number).toBe(3);
  });
});

describe('linking by code (projectForLink)', () => {
  it('empty means no project; junk, unknown, hidden and deleted projects are refused', async () => {
    const p = await start(mkHead);
    expect(await projects.projectForLink(await as(mkHead), '')).toBeNull();
    expect(await projects.projectForLink(await as(mkHead), null)).toBeNull();
    expect((await projects.projectForLink(await as(mkHead), p.code.toLowerCase().replace('-', ''))).name).toBe('Diwali launch');
    await expect(projects.projectForLink(await as(mkHead), 'hello')).rejects.toMatchObject({ statusCode: 400, message: /like PRJ-0007/ });
    await expect(projects.projectForLink(await as(mkHead), 'PRJ-99999')).rejects.toMatchObject({ statusCode: 400, message: /PRJ-99999 was not found/ });
    // Not in the project: as if it did not exist — unless accounts / the admin.
    await expect(projects.projectForLink(await as(prMember), p.code)).rejects.toMatchObject({ statusCode: 400, message: /not found/ });
    expect((await projects.projectForLink(await as(prMember), p.code, { seesAll: true })).name).toBe('Diwali launch');

    await projects.updateProject(await as(mkHead), p.id, { rev: p.rev, archived: true }, req);
    await expect(projects.projectForLink(await as(admin), p.code, { seesAll: true })).rejects.toMatchObject({ statusCode: 400, message: /deleted/ });
  });
});
