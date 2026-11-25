/**
 * Team chat text limits (services/chatService.js MESSAGE_MAX_LENGTH).
 *
 * A staff member lost the end of a long message: the box stopped at 4,000
 * characters and the server quietly cut anything longer. The rule now:
 *   - a long message (well past the old 4,000) is saved WORD FOR WORD;
 *   - one over the cap is REFUSED with a clear message — never shortened;
 *   - editing follows the same rule (it used to cut silently too);
 *   - a space's "what is it for?" line likewise.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { MESSAGE_MAX_LENGTH, SPACE_DESCRIPTION_MAX } from '../services/chatService.js';

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
  };
}

const staff = (team, isHead = false) => ({ team, isHead, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});
const spaceId = (channels, key) => channels.find((c) => c.key === key)?.id;

/** A realistic long message: many lines, Hindi and emoji, exactly `n` characters. */
const longText = (n) => {
  const line = 'Customer wants the Creta seat covers in beige — बेज रंग, delivery Tuesday 🚗\n';
  return line.repeat(Math.ceil(n / line.length)).slice(0, n - 1) + '.';
};

describe('Team chat text limits', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, member, company;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') });
    admin = await signIn('owner@example.com');
    member = await signIn('sam@example.com');
    company = spaceId((await admin.get('/chat/channels')).body.channels, 'company');
  });

  it('the cap is 20,000 characters', () => {
    expect(MESSAGE_MAX_LENGTH).toBe(20000);
  });

  it('a long message (past the old 4,000) is saved and read back word for word', async () => {
    const text = longText(12000);
    const res = await member.post(`/chat/channels/${company}/messages`, { text });
    expect(res.status).toBe(201);
    expect(res.body.message.text).toBe(text);
    const stored = await ChatMessage.findById(res.body.message.id).lean();
    expect(stored.text).toBe(text);
    const page = (await admin.get(`/chat/channels/${company}/messages`)).body.messages;
    expect(page.find((m) => m.id === res.body.message.id).text).toBe(text);
  });

  it('a message of exactly the cap is accepted', async () => {
    const res = await member.post(`/chat/channels/${company}/messages`, { text: longText(MESSAGE_MAX_LENGTH) });
    expect(res.status).toBe(201);
    expect(res.body.message.text).toHaveLength(MESSAGE_MAX_LENGTH);
  });

  it('one character over is refused with a clear message, and nothing is saved', async () => {
    const res = await member.post(`/chat/channels/${company}/messages`, { text: longText(MESSAGE_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long.*20,000/i);
    expect(await ChatMessage.countDocuments({ sender: { $ne: null } })).toBe(0);
  });

  it('editing to a long text keeps every word', async () => {
    const sent = (await member.post(`/chat/channels/${company}/messages`, { text: 'short' })).body.message;
    const text = longText(15000);
    const res = await member.patch(`/chat/messages/${sent.id}`, { text });
    expect(res.status).toBe(200);
    expect((await ChatMessage.findById(sent.id).lean()).text).toBe(text);
  });

  it('editing past the cap is refused, never cut — the old text stays', async () => {
    const sent = (await member.post(`/chat/channels/${company}/messages`, { text: 'keep me' })).body.message;
    const res = await member.patch(`/chat/messages/${sent.id}`, { text: longText(MESSAGE_MAX_LENGTH + 50) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
    expect((await ChatMessage.findById(sent.id).lean()).text).toBe('keep me');
  });

  it('a space description up to 1,000 characters is kept whole; longer is refused', async () => {
    const ok = 'For the Diwali sale. '.repeat(47).trim();
    expect(ok.length).toBeLessThanOrEqual(SPACE_DESCRIPTION_MAX);
    expect(ok.length).toBeGreaterThan(240); // the old cap
    const made = await admin.post('/chat/channels', { name: 'diwali', description: ok });
    expect(made.status).toBe(201);
    const listed = (await admin.get('/chat/channels')).body.channels.find((c) => c.id === made.body.channel.id);
    expect(listed.description).toBe(ok);

    const tooLong = await admin.post('/chat/channels', { name: 'diwali-2', description: 'x'.repeat(SPACE_DESCRIPTION_MAX + 1) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toMatch(/too long/i);
  });
});
