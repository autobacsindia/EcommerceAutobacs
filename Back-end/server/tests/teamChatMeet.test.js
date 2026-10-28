/**
 * Google Meet call links (chatService.setMeetLink). Calls happen in Meet; chat
 * keeps a conversation's standing link so "📞 Call" is one tap.
 *
 * What must hold:
 *   - only a real meet.google.com meeting link is ever saved (the button must
 *     never send people anywhere else);
 *   - in a space only admins and team heads set it; in a DM or group, anyone in it;
 *   - nobody outside the conversation can read or change it.
 */
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
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}
const staff = (team) => ({ team, isHead: false, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});

describe('Meet call links', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let sam, head, admin, anu, users, sales;
  beforeEach(async () => {
    users = {
      sam: await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') }),
      head: await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: { team: 'sales', isHead: true, active: true } }),
      anu: await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts') }),
    };
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    sam = await signIn('sam@example.com');
    head = await signIn('sana@example.com');
    anu = await signIn('anu@example.com');
    admin = await signIn('owner@example.com');
    sales = (await sam.get('/chat/channels')).body.channels.find((c) => c.key === 'team:sales');
  });

  const MEET = 'https://meet.google.com/abc-defg-hij';
  const setMeet = (who, id, url) => who.put(`/chat/channels/${id}/meet`, { url });
  const channel = async (who, id) => (await who.get('/chat/channels')).body.channels.find((c) => c.id === id);

  it('a team head saves the space’s link; everyone in the space sees it', async () => {
    expect(sales).toMatchObject({ meetUrl: null, canSetMeet: false });
    const res = await setMeet(head, sales.id, MEET);
    expect(res.status).toBe(200);
    expect(res.body.meetUrl).toBe(MEET);
    expect(await channel(sam, sales.id)).toMatchObject({ meetUrl: MEET, canSetMeet: false });
    expect((await channel(head, sales.id)).canSetMeet).toBe(true);
  });

  it('a member cannot change a space’s link; an admin can, and can remove it', async () => {
    expect((await setMeet(sam, sales.id, MEET)).status).toBe(403);
    expect((await setMeet(admin, sales.id, MEET)).status).toBe(200);
    expect((await setMeet(admin, sales.id, null)).body.meetUrl).toBeNull();
    expect((await channel(sam, sales.id)).meetUrl).toBeNull();
  });

  it('in a direct message, either person can set it', async () => {
    const dm = (await sam.post('/chat/dm', { userId: String(users.anu._id) })).body.channel.id;
    expect((await channel(sam, dm)).canSetMeet).toBe(true);
    expect((await setMeet(anu, dm, `${MEET}?authuser=1`)).status).toBe(200);
    expect((await channel(sam, dm)).meetUrl).toBe(`${MEET}?authuser=1`);
  });

  it.each([
    'https://meet.google.com.evil.example/abc-defg-hij',
    'http://meet.google.com/abc-defg-hij',
    'https://meet.google.com/new',
    'https://zoom.us/j/123',
    'javascript:alert(1)',
    'https://meet.google.com/abc-defg-hij/../../evil',
  ])('refuses %s', async (url) => {
    expect((await setMeet(admin, sales.id, url)).status).toBe(400);
    expect((await channel(admin, sales.id)).meetUrl).toBeNull();
  });

  it('nobody outside the conversation can change it', async () => {
    expect((await setMeet(anu, sales.id, MEET)).status).toBe(404);
    const dm = (await sam.post('/chat/dm', { userId: String(users.anu._id) })).body.channel.id;
    expect((await setMeet(admin, dm, MEET)).status).toBe(404);
  });
});
