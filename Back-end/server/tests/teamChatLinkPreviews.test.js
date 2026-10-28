/**
 * Link preview cards on chat messages (chatService.attachPreview). The fetcher
 * itself — and its SSRF guard — is tested in tests/unit/services/linkPreviewService.test.js;
 * here it is replaced, and what is checked is the wiring:
 *   - a message's first link gets a card, stored and announced live;
 *   - an edit that changes the link swaps the card; removing the link removes it;
 *   - a card fetched for words since edited, or for a deleted message, is dropped;
 *   - automatic posts get none; the switch turns it all off.
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

process.env.CHAT_LINK_PREVIEWS = 'on';
const previewFor = jest.fn();
let gate = null; // lets a test hold the fetch while it edits the message
jest.unstable_mockModule('../services/linkPreviewService.js', () => ({
  firstUrl: (text) => (/https?:\/\/[^\s<>"']+/i.exec(String(text || ''))?.[0] ?? null),
  linkPreviewsEnabled: () => process.env.CHAT_LINK_PREVIEWS === 'on',
  previewFor: async (url) => { if (gate) await gate; return previewFor(url); },
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { onChatEvent } = await import('../services/chatEvents.js');
const { postSystemMessage } = await import('../services/chatService.js');

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
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}
const CARD = (url, title = 'Winch 12000 lb') => ({ url, title, description: 'Heavy duty', site: 'autobacsindia.com' });
const until = async (fn) => { for (let i = 0; i < 60; i += 1) { if (await fn()) return; await new Promise((r) => setTimeout(r, 25)); } };

describe('Link preview cards', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    delete process.env.CHAT_LINK_PREVIEWS;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); previewFor.mockReset(); gate = null; process.env.CHAT_LINK_PREVIEWS = 'on'; });

  let sam, company;
  beforeEach(async () => {
    await User.create({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: { team: 'sales', active: true }, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
    sam = await signIn('sam@example.com');
    company = (await sam.get('/chat/channels')).body.channels.find((c) => c.key === 'company').id;
  });

  let n = 0;
  const say = async (text) => {
    const res = await sam.post(`/chat/channels/${company}/messages`, { text, clientId: `prev-${++n}-test` });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const stored = async (id) => (await sam.get(`/chat/channels/${company}/messages`)).body.messages.find((m) => m.id === id)?.preview;

  it('the first link gets a card, stored and announced live', async () => {
    previewFor.mockImplementation(async (url) => CARD(url));
    const events = [];
    const off = onChatEvent((e) => { if (e.type === 'message_preview') events.push(e); });
    const m = await say('Look at https://autobacsindia.com/products/winch and https://other.example/');
    expect(m.preview).toBeNull(); // the send never waits for the fetch
    await until(() => events.length);
    off();
    expect(previewFor).toHaveBeenCalledWith('https://autobacsindia.com/products/winch');
    expect(events[0]).toMatchObject({ channelId: company, messageId: m.id, preview: CARD('https://autobacsindia.com/products/winch') });
    expect(await stored(m.id)).toEqual(CARD('https://autobacsindia.com/products/winch'));
  });

  it('no link, no fetch; a page with nothing to show, no card', async () => {
    await say('no links');
    previewFor.mockResolvedValue(null);
    const m = await say('https://example.com/blank');
    await until(() => previewFor.mock.calls.length);
    await new Promise((r) => setTimeout(r, 50));
    expect(previewFor).toHaveBeenCalledTimes(1);
    expect(await stored(m.id)).toBeNull();
  });

  it('editing the link swaps the card; removing it removes the card', async () => {
    previewFor.mockImplementation(async (url) => CARD(url, url.endsWith('a') ? 'Page A' : 'Page B'));
    const m = await say('https://example.com/a');
    await until(async () => (await stored(m.id))?.title === 'Page A');

    await sam.patch(`/chat/messages/${m.id}`, { text: 'actually https://example.com/b' });
    await until(async () => (await stored(m.id))?.title === 'Page B');
    expect((await stored(m.id)).title).toBe('Page B');

    await sam.patch(`/chat/messages/${m.id}`, { text: 'never mind' });
    await until(async () => (await stored(m.id)) === null);
    expect(await stored(m.id)).toBeNull();
  });

  it('a card fetched for words since edited is dropped', async () => {
    let release;
    gate = new Promise((r) => { release = r; });
    previewFor.mockImplementation(async (url) => CARD(url));
    const m = await say('https://example.com/old');
    gate = null; // the edit's own fetch (if any) is not held
    previewFor.mockImplementation(async () => null);
    await sam.patch(`/chat/messages/${m.id}`, { text: 'typo fixed, no link' });
    previewFor.mockImplementation(async (url) => CARD(url));
    release();
    await new Promise((r) => setTimeout(r, 150));
    expect(await stored(m.id)).toBeNull();
  });

  it('a card for a message deleted meanwhile is dropped', async () => {
    let release;
    gate = new Promise((r) => { release = r; });
    previewFor.mockImplementation(async (url) => CARD(url));
    const m = await say('https://example.com/x');
    await sam.del(`/chat/messages/${m.id}`);
    release();
    await new Promise((r) => setTimeout(r, 150));
    const doc = (await import('../models/ChatMessage.js')).default;
    expect((await doc.findById(m.id).lean()).preview).toBeUndefined();
  });

  it('automatic posts get no card', async () => {
    previewFor.mockImplementation(async (url) => CARD(url));
    await postSystemMessage('company', 'Track it at https://courier.example/123', { key: 'prev-sys' });
    await new Promise((r) => setTimeout(r, 100));
    expect(previewFor).not.toHaveBeenCalled();
  });

  it('CHAT_LINK_PREVIEWS=off turns it off', async () => {
    process.env.CHAT_LINK_PREVIEWS = 'off';
    previewFor.mockImplementation(async (url) => CARD(url));
    await say('https://example.com/');
    await new Promise((r) => setTimeout(r, 100));
    expect(previewFor).not.toHaveBeenCalled();
  });
});
