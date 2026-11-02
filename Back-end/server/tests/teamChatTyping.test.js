/**
 * "Ravi is typing…" (POST /chat/channels/:id/typing → SSE `typing`).
 *
 * What must hold: the event reaches only people who can read the conversation;
 * one person announces at most once per few seconds per conversation/thread;
 * nothing is written to MongoDB; outsiders get "not found".
 */
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import { onChatEvent } from '../services/chatEvents.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';

const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}

const staff = (team, isHead = false) => ({ team, isHead, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});

describe('Typing indicator', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, sam, anu, ravi, samUser, anuUser, company, sales;
  let events, off;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    samUser = await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') });
    anuUser = await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts') });
    await createUser({ name: 'Ravi', email: 'ravi@example.com', role: 'staff', staff: staff('sales') });
    admin = await signIn('owner@example.com');
    sam = await signIn('sam@example.com');
    anu = await signIn('anu@example.com');
    ravi = await signIn('ravi@example.com');
    const channels = (await admin.get('/chat/channels')).body.channels;
    company = channels.find((c) => c.key === 'company').id;
    sales = channels.find((c) => c.key === 'team:sales').id;
    events = [];
    off = onChatEvent((e) => { if (e.type === 'typing') events.push(e); });
  });
  afterEach(() => off());

  const typing = (who, channel, body = {}) => who.post(`/chat/channels/${channel}/typing`, body);

  it('announces who is typing where, routed to the conversation’s readers', async () => {
    const res = await typing(sam, sales);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'typing', channelId: sales, threadRoot: null, userId: String(samUser._id), name: 'Sam',
      route: { audience: 'team', team: 'sales' },
    });
  });

  it('is throttled: a second announcement within seconds sends nothing', async () => {
    expect((await typing(sam, company)).body.sent).toBe(true);
    expect((await typing(sam, company)).body.sent).toBe(false);
    expect(events).toHaveLength(1);
    // Other people, other conversations and threads have their own allowance.
    expect((await typing(ravi, company)).body.sent).toBe(true);
    expect((await typing(sam, sales)).body.sent).toBe(true);
    expect((await typing(sam, company, { threadRoot: '64b000000000000000000001' })).body.sent).toBe(true);
    expect(events).toHaveLength(4);
    expect(events[3].threadRoot).toBe('64b000000000000000000001');
  });

  it('writes nothing to MongoDB', async () => {
    const before = {};
    for (const [name, coll] of Object.entries(mongoose.connection.collections)) before[name] = await coll.countDocuments();
    const channelBefore = await mongoose.connection.collection('chatchannels').findOne({ _id: new mongoose.Types.ObjectId(company) });
    await typing(sam, company);
    await typing(anu, company);
    for (const [name, coll] of Object.entries(mongoose.connection.collections)) {
      if (name === 'ratelimitevents' || name === 'rate_limit_events') continue;
      expect([name, await coll.countDocuments()]).toEqual([name, before[name]]);
    }
    const channelAfter = await mongoose.connection.collection('chatchannels').findOne({ _id: new mongoose.Types.ObjectId(company) });
    expect(channelAfter).toEqual(channelBefore);
  });

  it('a DM’s typing goes to its two people only', async () => {
    const dm = (await sam.post('/chat/dm', { userId: String(anuUser._id) })).body.channel.id;
    await typing(sam, dm);
    expect(events[0].route).toMatchObject({ kind: 'dm' });
    expect(events[0].route.members.sort()).toEqual([String(samUser._id), String(anuUser._id)].sort());
  });

  it('someone who cannot read the conversation gets "not found" and announces nothing', async () => {
    expect((await typing(anu, sales)).status).toBe(404);
    const dm = (await sam.post('/chat/dm', { userId: String(anuUser._id) })).body.channel.id;
    expect((await typing(admin, dm)).status).toBe(404);
    expect((await typing(ravi, dm)).status).toBe(404);
    expect(events).toHaveLength(0);
  });

  it('rejects a malformed thread id or channel id', async () => {
    expect((await typing(sam, company, { threadRoot: 'nope' })).status).toBe(400);
    expect((await sam.post('/chat/channels/nope/typing', {})).status).toBe(400);
  });

  it('customers and signed-out callers are turned away', async () => {
    await createUser({ name: 'Cust', email: 'cust@example.com' });
    const cust = await signIn('cust@example.com');
    expect((await typing(cust, company)).status).toBe(403);
    expect((await request(app).post(`${BASE}/chat/channels/${company}/typing`)).status).toBeGreaterThanOrEqual(401);
  });
});
