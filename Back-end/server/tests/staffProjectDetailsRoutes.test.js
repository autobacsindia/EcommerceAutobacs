/**
 * Project details, slips and the reminder over HTTP (routes/staffTasks.js).
 * The rules themselves are in tests/staffProjectDetails.test.js; this proves
 * the wiring: the fixed paths are not swallowed by /projects/:projectId, the
 * slip comes back as a PDF, nobody signed out gets anything (never a 200).
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
const pushMock = {
  pushConfigured: () => true, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (targets) => targets.length, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffProject } = await import('../models/StaffProject.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`).buffer(true),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, id: String(user._id), session: await signIn(email) };
};

describe('Project details over HTTP', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffProject.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  it('Vicky’s Hilux: details saved, delivery slip PDF, reminder answers', async () => {
    const admin = await makeUser('Vyshnav', 'admin');
    const nevin = await makeUser('Nevin', 'staff', { team: 'operations', active: true, isHead: true });

    const t = await admin.session.get('/staff/tasks/projects/templates');
    expect(t.status).toBe(200);
    expect(t.body.templates.map((x) => x.key)).toEqual(['general', 'sales']);

    const created = await admin.session.post('/staff/tasks/projects', { name: 'Vicky’s Hilux', ownerId: nevin.id });
    expect(created.status).toBe(201);
    const { id, rev } = created.body.project;

    const saved = await nevin.session.put(`/staff/tasks/projects/${id}/details`, {
      rev, template: 'sales', values: { customerName: 'Vicky', vehicleModel: 'Toyota Hilux', amountQuoted: 85000, advancePaid: 25000 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.project.details).toMatchObject({ template: 'sales', balance: 60000 });
    expect(saved.body.project.rev).toBe(rev + 1);

    const bad = await nevin.session.put(`/staff/tasks/projects/${id}/details`, { rev: rev + 1, template: 'nope' });
    expect(bad.status).toBe(400);

    const slip = await nevin.session.get(`/staff/tasks/projects/${id}/slip/delivery`);
    expect(slip.status).toBe(200);
    expect(slip.headers['content-type']).toBe('application/pdf');
    expect(slip.headers['content-disposition']).toMatch(/^inline; filename="Delivery-slip-[0-9A-F]{6}-Vicky-s-Hilux\.pdf"$/);
    expect(slip.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(slip.body).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await nevin.session.get(`/staff/tasks/projects/${id}/slip/whatever`)).status).toBe(404);

    const r = await nevin.session.get('/staff/tasks/projects/reminder');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('reminder');
    const d = await nevin.session.post('/staff/tasks/projects/reminder/dismiss', { day: '2030-03-10' });
    expect(d.status).toBe(200);
  });

  it('slip boxes and the admin’s Slip templates screen', async () => {
    const admin = await makeUser('Vyshnav', 'admin');
    const nevin = await makeUser('Nevin', 'staff', { team: 'operations', active: true, isHead: true });
    const created = await admin.session.post('/staff/tasks/projects', { name: 'Office supplies', ownerId: nevin.id });
    const { id, rev } = created.body.project;

    const one = await nevin.session.get(`/staff/tasks/projects/${id}`);
    expect(one.body.project.slips.map((s) => s.key)).toEqual(['office_supplies', 'summary']);

    const saved = await nevin.session.put(`/staff/tasks/projects/${id}/slips/office_supplies`, {
      rev, values: { month: 'November 2026', items: [{ name: 'A4 paper', qty: 2, rate: 250 }] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.project.slips[0]).toMatchObject({ key: 'office_supplies', missing: [], values: { month: 'November 2026' } });
    const pdf = await nevin.session.get(`/staff/tasks/projects/${id}/slip/office_supplies`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    // Staff never reach the admin screen.
    expect((await nevin.session.get('/admin/slip-templates')).status).toBe(403);
    expect((await nevin.session.post('/admin/slip-templates/preview', {})).status).toBe(403);

    const list = await admin.session.get('/admin/slip-templates');
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.templates.map((t) => t.key)).toContain('rto_letter');
    expect(list.body.options.forms.map((f) => f.key)).toEqual(['general', 'sales']);

    const draft = {
      key: 'gate_pass', label: 'Gate pass', title: 'GATE PASS', forms: [],
      fields: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', upper: true }],
      blocks: [{ type: 'paragraph', text: 'Allow {{vehicleNo}} out of the workshop.' }], needs: ['vehicleNo'], signatures: ['Security'],
    };
    const preview = await admin.session.post('/admin/slip-templates/preview', draft);
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect((await admin.session.post('/admin/slip-templates/preview', { ...draft, blocks: [] })).status).toBe(400);

    const made = await admin.session.post('/admin/slip-templates', draft);
    expect(made.status).toBe(201);
    const changed = await admin.session.patch(`/admin/slip-templates/${made.body.template.id}`, { ...draft, rev: 1, label: 'Gate pass (exit)' });
    expect(changed.status).toBe(200);
    expect(changed.body.template).toMatchObject({ label: 'Gate pass (exit)', rev: 2 });
    expect((await admin.session.patch(`/admin/slip-templates/${made.body.template.id}`, { ...draft, rev: 1 })).status).toBe(409);
    const menu = (await nevin.session.get(`/staff/tasks/projects/${id}`)).body.project.slips.map((s) => s.key);
    expect(menu).toEqual(['office_supplies', 'gate_pass', 'summary']);
  });

  it('signed out: nothing, and never a 200', async () => {
    const anon = request(app);
    for (const url of ['/staff/tasks/projects/templates', '/staff/tasks/projects/reminder', `/staff/tasks/projects/${'a'.repeat(24)}/slip/delivery`, '/admin/slip-templates']) {
      const res = await anon.get(`${BASE}${url}`);
      expect(res.status).toBe(401);
    }
  });

  it('a customer account cannot reach any of it', async () => {
    const shopper = await makeUser('Shopper', 'customer');
    expect((await shopper.session.get('/staff/tasks/projects/templates')).status).toBe(403);
    expect((await shopper.session.get('/staff/tasks/projects/reminder')).status).toBe(403);
  });
});
