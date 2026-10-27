/**
 * Chat and Order updates are read separately (models/ChatReadState.js).
 *
 * What must hold:
 *   - a space reports unread per tab: unreadChat + unreadUpdates = unread
 *   - reading one tab never clears the other
 *   - a person's reply inside an order's update thread belongs to Order updates
 *     (for everyone else's count, and for the sender's own read position)
 *   - a read row from before the split keeps exactly its old meaning: nothing
 *     already read becomes unread, and moving Chat forward does not clear updates
 *   - a page from before the split (no `part`) still marks everything read
 */
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatReadState from '../models/ChatReadState.js';
import { postSystemMessage } from '../services/chatService.js';

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
  };
}

const staff = (team) => ({ team, isHead: false, active: true });
const createUser = async ({ name, email, role = 'staff', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});

describe('Team chat — separate unread for Chat and Order updates', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let sam, ravi, samUser, sales;
  let n = 0;
  beforeEach(async () => {
    samUser = await createUser({ name: 'Sam', email: 'sam@example.com', staff: staff('sales') });
    await createUser({ name: 'Ravi', email: 'ravi@example.com', staff: staff('sales') });
    sam = await signIn('sam@example.com');
    ravi = await signIn('ravi@example.com');
    sales = (await sam.get('/chat/channels')).body.channels.find((c) => c.key === 'team:sales').id;
  });

  const say = (who, text, extra = {}) => who.post(`/chat/channels/${sales}/messages`, { text, clientId: randomUUID(), ...extra });
  const update = (text, extra = {}) => postSystemMessage('team:sales', text, { key: `k-${++n}`, ...extra });
  const space = async (who) => (await who.get('/chat/channels')).body.channels.find((c) => c.id === sales);
  const read = (who, seq, part) => who.post(`/chat/channels/${sales}/read`, { seq, ...(part ? { part } : {}) });

  it('counts each tab separately, and the total is their sum', async () => {
    await say(ravi, 'hello');
    await update('Order #A1 paid');
    await update('Order #A2 paid');
    expect(await space(sam)).toMatchObject({ unreadChat: 1, unreadUpdates: 2, unread: 3 });
  });

  it('reading Chat leaves Order updates unread, and the other way round', async () => {
    await say(ravi, 'hello');
    await update('Order #A1 paid');
    const top = (await space(sam)).lastMessageSeq;

    expect((await read(sam, top, 'chat')).status).toBe(200);
    expect(await space(sam)).toMatchObject({ unreadChat: 0, unreadUpdates: 1 });

    await say(ravi, 'again');
    expect((await read(sam, (await space(sam)).lastMessageSeq, 'updates')).status).toBe(200);
    expect(await space(sam)).toMatchObject({ unreadChat: 1, unreadUpdates: 0, unread: 1 });
  });

  it('a reply inside an order\'s update thread is an order update — for others and for the sender', async () => {
    const root = await update('Order #A1 paid', { threadOrder: new mongoose.Types.ObjectId() });
    await read(sam, (await space(sam)).lastMessageSeq);
    await read(ravi, (await space(ravi)).lastMessageSeq);
    await say(ravi, 'a chat line');
    const reply = await say(sam, 'Customer will wait', { threadRoot: root.id });
    expect(reply.status).toBe(201);

    // Ravi: Sam's reply is an unread order update; his own chat line is not unread.
    expect(await space(ravi)).toMatchObject({ unreadChat: 0, unreadUpdates: 1 });
    // Sam's own reply marks Sam's Order updates read — but not Ravi's chat line.
    expect(await space(sam)).toMatchObject({ unreadChat: 1, unreadUpdates: 0 });
  });

  it('a read row from before the split keeps its meaning, and Chat moving on does not clear updates', async () => {
    await say(ravi, 'old');
    await update('Order #A1 paid'); // read already, under the old single position
    const readUpTo = (await space(sam)).lastMessageSeq;
    await update('Order #A2 paid'); // not read yet
    await say(ravi, 'new');
    await ChatReadState.updateOne(
      { user: samUser._id, channel: sales },
      { $set: { lastReadSeq: readUpTo }, $unset: { lastReadUpdatesSeq: '' } },
      { upsert: true },
    );
    expect(await space(sam)).toMatchObject({ unreadChat: 1, unreadUpdates: 1 });

    await read(sam, (await space(sam)).lastMessageSeq, 'chat');
    expect(await space(sam)).toMatchObject({ unreadChat: 0, unreadUpdates: 1 });
  });

  it('a page from before the split (no part) marks both tabs read', async () => {
    await say(ravi, 'hello');
    await update('Order #A1 paid');
    await read(sam, (await space(sam)).lastMessageSeq);
    expect(await space(sam)).toMatchObject({ unreadChat: 0, unreadUpdates: 0, unread: 0 });
  });

  it('never moves backwards, and refuses an unknown part', async () => {
    await update('Order #A1 paid');
    const top = (await space(sam)).lastMessageSeq;
    await read(sam, top, 'updates');
    await read(sam, 0, 'updates');
    expect((await space(sam)).unreadUpdates).toBe(0);
    expect((await read(sam, top, 'everything')).status).toBe(400);
  });
});
