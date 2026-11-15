/**
 * Person-to-person calls in team-chat DMs (services/chatCallService.js).
 *
 * The cases a two-browser smoke test misses: who may ring / answer / signal,
 * two presses racing into one call, both people calling each other at once,
 * a racing hang-up writing ONE call line, the ring timing out exactly once,
 * signals reaching only the call's own two tabs, and abandoned calls swept.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatCall from '../models/ChatCall.js';
import ChatMessage from '../models/ChatMessage.js';
import { onChatEvent } from '../services/chatEvents.js';
import { canAccess } from '../services/chatService.js';
import { sweepCalls, iceServersFor, STALE_MS } from '../services/chatCallService.js';
import { buildIndexes, INDEXES } from '../scripts/create-chat-call-indexes.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const DEV_A = 'device-aaaa-1111';
const DEV_A2 = 'device-aaaa-2222';
const DEV_B = 'device-bbbb-1111';
const DEV_B2 = 'device-bbbb-2222';

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
async function createUser({ name, email, role = 'staff', staff: s }) {
  return User.create({ name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4) });
}

/** Collect chat events while `fn` runs. */
async function capture(fn) {
  const events = [];
  const off = onChatEvent((e) => events.push(e));
  try { await fn(); } finally { off(); }
  return events;
}

const lines = (channel) => ChatMessage.find({ channel, kind: 'call' }).lean();
const flush = () => new Promise((r) => setTimeout(r, 30));

describe('Team chat calls (one-to-one)', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let users, dev, mkt, other, admin, customer, dm;
  beforeEach(async () => {
    users = {
      dev: await createUser({ name: 'Dev', email: 'dev@example.com', staff: staff('developer') }),
      mkt: await createUser({ name: 'Mira', email: 'mira@example.com', staff: staff('marketing') }),
      other: await createUser({ name: 'Ola', email: 'ola@example.com', staff: staff('sales') }),
      admin: await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' }),
      customer: await createUser({ name: 'Cust', email: 'cust@example.com', role: 'customer' }),
    };
    dev = await signIn('dev@example.com');
    mkt = await signIn('mira@example.com');
    other = await signIn('ola@example.com');
    admin = await signIn('owner@example.com');
    customer = await signIn('cust@example.com');
    dm = (await dev.post('/chat/dm', { userId: String(users.mkt._id) })).body.channel.id;
  });

  const ring = (who = dev, body = {}) => who.post(`/chat/channels/${dm}/calls`, { media: 'video', deviceId: DEV_A, ...body });

  describe('who may call', () => {
    it('signed-out visitors get 401, customers 403 — never a fake OK', async () => {
      const anon = await request(app).post(`${BASE}/chat/channels/${dm}/calls`).send({ deviceId: DEV_A });
      expect([401, 403]).toContain(anon.status);
      expect((await customer.post(`/chat/channels/${dm}/calls`, { deviceId: DEV_A })).status).toBe(403);
      expect((await request(app).get(`${BASE}/chat/calls/live`)).status).toBe(401);
    });

    it('someone outside the DM — even an admin — cannot ring into it', async () => {
      expect((await other.post(`/chat/channels/${dm}/calls`, { deviceId: DEV_A })).status).toBe(404);
      expect((await admin.post(`/chat/channels/${dm}/calls`, { deviceId: DEV_A })).status).toBe(404);
      expect(await ChatCall.countDocuments()).toBe(0);
    });

    it('group conversations and spaces cannot be called (one-to-one only)', async () => {
      const group = (await dev.post('/chat/dm', { userIds: [String(users.mkt._id), String(users.other._id)] })).body.channel.id;
      const res = await dev.post(`/chat/channels/${group}/calls`, { deviceId: DEV_A });
      expect(res.status).toBe(400);
      const spaces = (await dev.get('/chat/channels')).body.channels.filter((c) => c.kind === 'space');
      expect((await dev.post(`/chat/channels/${spaces[0].id}/calls`, { deviceId: DEV_A })).status).toBe(400);
    });

    it('rejects a malformed device id or call type', async () => {
      expect((await ring(dev, { deviceId: 'x' })).status).toBe(400);
      expect((await ring(dev, { media: 'hologram' })).status).toBe(400);
    });
  });

  describe('ringing and answering', () => {
    it('rings only the two people of the DM', async () => {
      let res;
      const events = await capture(async () => { res = await ring(); });
      expect(res.status).toBe(200);
      expect(res.body.call).toMatchObject({ status: 'ringing', media: 'video', callerDevice: DEV_A, calleeDevice: null });
      const ev = events.find((e) => e.type === 'call.ring');
      expect(ev.caller.name).toBe('Dev');
      // The SSE stream forwards an event only to people canAccess() admits.
      expect(canAccess(users.mkt, ev.route)).toBe(true);
      expect(canAccess(users.dev, ev.route)).toBe(true);
      expect(canAccess(users.other, ev.route)).toBe(false);
      expect(canAccess(users.admin, ev.route)).toBe(false);
    });

    it('a double-click is one call, not two', async () => {
      const [a, b] = await Promise.all([ring(), ring()]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.call.id).toBe(b.body.call.id);
      expect(await ChatCall.countDocuments()).toBe(1);
    });

    it('both calling each other at once lands both in ONE call, answered', async () => {
      const first = await ring();
      const second = await mkt.post(`/chat/channels/${dm}/calls`, { media: 'video', deviceId: DEV_B });
      expect(second.status).toBe(200);
      expect(second.body.call.id).toBe(first.body.call.id);
      expect(second.body.call.status).toBe('active');
      expect(await ChatCall.countDocuments()).toBe(1);
    });

    it('only the person called can answer, and only once (other tabs stop ringing)', async () => {
      const id = (await ring()).body.call.id;
      expect((await dev.post(`/chat/calls/${id}/answer`, { deviceId: DEV_A })).status).toBe(403);
      expect((await other.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B })).status).toBe(404);
      let first;
      const events = await capture(async () => { first = await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B }); });
      expect(first.status).toBe(200);
      expect(first.body.call).toMatchObject({ status: 'active', calleeDevice: DEV_B });
      expect(first.body.iceServers.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'call.answered')).toBe(true);
      const second = await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B2 });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ANSWERED_ELSEWHERE');
    });

    it('someone already on a call is busy', async () => {
      await ring(); // dev ↔ mira ringing
      const dm2 = (await other.post('/chat/dm', { userId: String(users.mkt._id) })).body.channel.id;
      const res = await other.post(`/chat/channels/${dm2}/calls`, { deviceId: DEV_A2 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BUSY');
      expect(res.body.message).toMatch(/Mira is on another call/);
    });
  });

  describe('ending — once, with one chat line', () => {
    it('declined: one "Declined" line, nothing unread for the decliner', async () => {
      const id = (await ring()).body.call.id;
      expect((await mkt.post(`/chat/calls/${id}/decline`)).body.ended).toBe(true);
      expect((await mkt.post(`/chat/calls/${id}/decline`)).body.ended).toBe(false);
      await flush();
      const l = await lines(dm);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ text: 'Declined video call', call: expect.objectContaining({ outcome: 'declined' }) });
      expect(String(l[0].sender)).toBe(String(users.dev._id));
      const ch = (await mkt.get('/chat/channels')).body.channels.find((c) => c.id === dm);
      expect(ch.unread).toBe(0);
    });

    it('a reload in the SAME tab (same device id) still tells the other side to reconnect', async () => {
      const id = (await ring()).body.call.id;
      await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      const events = await capture(async () => { await ring(dev, { deviceId: DEV_A }); });
      expect(events.find((e) => e.type === 'call.rejoined')).toMatchObject({ side: 'caller' });
    });

    it('caller hangs up while ringing: a missed call for the other person', async () => {
      const id = (await ring(dev, { media: 'audio' })).body.call.id;
      await dev.post(`/chat/calls/${id}/hangup`);
      await flush();
      const l = await lines(dm);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ text: 'Missed voice call', call: expect.objectContaining({ outcome: 'cancelled', media: 'audio' }) });
      const ch = (await mkt.get('/chat/channels')).body.channels.find((c) => c.id === dm);
      expect(ch.unread).toBeGreaterThan(0);
    });

    it('both hanging up at the same instant writes exactly one line', async () => {
      const id = (await ring()).body.call.id;
      await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      const [a, b] = await Promise.all([dev.post(`/chat/calls/${id}/hangup`), mkt.post(`/chat/calls/${id}/hangup`)]);
      expect([a.body.ended, b.body.ended].filter(Boolean)).toHaveLength(1);
      await flush();
      const l = await lines(dm);
      expect(l).toHaveLength(1);
      expect(l[0].call.outcome).toBe('completed');
      expect(l[0].text).toBe('Video call');
      expect((await ChatCall.findById(id)).live).toBe(false);
    });

    it('an unanswered ring ends as missed exactly once, even if the sweep runs twice', async () => {
      const id = (await ring()).body.call.id;
      await ChatCall.updateOne({ _id: id }, { $set: { ringUntil: new Date(Date.now() - 1000) } });
      const [n1, n2] = await Promise.all([sweepCalls(), sweepCalls()]);
      expect(n1 + n2).toBe(1);
      await flush();
      expect(await lines(dm)).toHaveLength(1);
      expect((await lines(dm))[0].call.outcome).toBe('missed');
      // Answering after the ring ended is refused, not resurrected.
      const late = await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('ENDED');
    });

    it('a call whose browser went silent is swept as ended', async () => {
      const id = (await ring()).body.call.id;
      await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      await ChatCall.updateOne({ _id: id }, { $set: { callerSeenAt: new Date(Date.now() - STALE_MS - 1000) } });
      expect(await sweepCalls()).toBe(1);
      await flush();
      expect((await lines(dm))[0].call.outcome).toBe('failed');
      // A new call is possible straight away.
      expect((await ring(dev, { deviceId: DEV_A2 })).status).toBe(200);
    });
  });

  describe('signalling', () => {
    async function connected() {
      const id = (await ring()).body.call.id;
      await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      return id;
    }

    it('passes a signal to the other person\'s tab in the call, and only to the DM', async () => {
      const id = await connected();
      let res;
      const events = await capture(async () => {
        res = await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'offer', data: { type: 'offer', sdp: 'v=0' } });
      });
      expect(res.status).toBe(200);
      const ev = events.find((e) => e.type === 'call.signal');
      expect(ev).toMatchObject({ callId: id, fromDevice: DEV_A, toDevice: DEV_B, kind: 'offer' });
      expect(canAccess(users.other, ev.route)).toBe(false);
      expect(canAccess(users.admin, ev.route)).toBe(false);
    });

    // Regression (prod, 2026-11-15): the request sanitizer trims every string,
    // which cut the CRLF an SDP must end with; Chrome then refused the offer
    // ("Invalid SDP line") and every call sat on "Connecting…".
    it('delivers the offer / answer SDP and candidates byte-for-byte, final CRLF included', async () => {
      const id = await connected();
      const sdp = [
        'v=0', 'o=- 4611 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS s1',
        'm=video 9 UDP/TLS/RTP/SAVPF 96', 'c=IN IP4 0.0.0.0', 'a=mid:0', 'a=sendrecv', 'a=rtpmap:96 VP8/90000',
        'a=ssrc:97243607 msid:s1 t1',
      ].join('\r\n') + '\r\n';
      const candidates = [{ candidate: 'candidate:1 1 udp 2122260223 a1b2.local 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 }];
      const events = await capture(async () => {
        expect((await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'offer', data: { type: 'offer', sdp } })).status).toBe(200);
        expect((await mkt.post(`/chat/calls/${id}/signal`, { deviceId: DEV_B, kind: 'answer', data: { type: 'answer', sdp } })).status).toBe(200);
        expect((await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'candidates', data: candidates })).status).toBe(200);
      });
      const sent = events.filter((e) => e.type === 'call.signal');
      expect(sent.map((e) => e.kind)).toEqual(['offer', 'answer', 'candidates']);
      expect(sent[0].data).toEqual({ type: 'offer', sdp });
      expect(sent[1].data).toEqual({ type: 'answer', sdp });
      expect(sent[2].data).toEqual(candidates);
    });

    it('refuses signals from outsiders, from another tab, before answer and after the end', async () => {
      const id = (await ring()).body.call.id;
      const offer = { kind: 'offer', data: { sdp: 'v=0' } };
      // Before answer.
      expect((await dev.post(`/chat/calls/${id}/signal`, { ...offer, deviceId: DEV_A })).status).toBe(409);
      await mkt.post(`/chat/calls/${id}/answer`, { deviceId: DEV_B });
      expect((await other.post(`/chat/calls/${id}/signal`, { ...offer, deviceId: DEV_A })).status).toBe(404);
      expect((await admin.post(`/chat/calls/${id}/signal`, { ...offer, deviceId: DEV_A })).status).toBe(404);
      const wrongTab = await dev.post(`/chat/calls/${id}/signal`, { ...offer, deviceId: DEV_A2 });
      expect(wrongTab.status).toBe(409);
      expect(wrongTab.body.code).toBe('OTHER_DEVICE');
      expect((await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'evil', data: {} })).status).toBe(400);
      expect((await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'offer', data: { sdp: 'x'.repeat(70 * 1024) } })).status).toBe(400);
      await dev.post(`/chat/calls/${id}/hangup`);
      expect((await mkt.post(`/chat/calls/${id}/signal`, { deviceId: DEV_B, kind: 'answer', data: { sdp: 'v=0' } })).status).toBe(409);
    });

    it('a reload takes over the call in the new tab and tells the other side to reconnect', async () => {
      const id = await connected();
      let res;
      const events = await capture(async () => { res = await ring(dev, { deviceId: DEV_A2 }); });
      expect(res.body.call).toMatchObject({ id, status: 'active', callerDevice: DEV_A2 });
      expect(events.some((e) => e.type === 'call.rejoined')).toBe(true);
      expect((await dev.post(`/chat/calls/${id}/signal`, { deviceId: DEV_A, kind: 'offer', data: {} })).status).toBe(409);
    });

    it('heartbeats keep a call alive and report when it has ended', async () => {
      const id = await connected();
      const hb = await dev.post(`/chat/calls/${id}/heartbeat`, { deviceId: DEV_A });
      expect(hb.body.call.status).toBe('active');
      await mkt.post(`/chat/calls/${id}/hangup`);
      expect((await dev.post(`/chat/calls/${id}/heartbeat`, { deviceId: DEV_A })).body.call.status).toBe('ended');
    });

    it('GET /calls/live returns my call (with the other person), and nobody else\'s', async () => {
      const id = (await ring()).body.call.id;
      const mine = await mkt.get('/chat/calls/live');
      expect(mine.body.call.id).toBe(id);
      expect(mine.body.peer.name).toBe('Dev');
      expect((await other.get('/chat/calls/live')).body.call).toBeNull();
    });
  });

  describe('relay passwords', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('STUN only when no relay is configured', () => {
      delete process.env.CALL_TURN_URLS;
      delete process.env.CALL_TURN_SECRET;
      const s = iceServersFor(users.dev);
      expect(s).toHaveLength(1);
      expect(s[0].urls[0]).toMatch(/^stun:/);
    });

    it('mints an expiring, per-person relay password from the shared secret', async () => {
      process.env.CALL_TURN_URLS = 'turn:turn.example.com:443?transport=tcp';
      process.env.CALL_TURN_SECRET = 'test-secret';
      process.env.CALL_TURN_TTL_SECONDS = '3600';
      const now = Date.UTC(2026, 10, 14);
      const [, turn] = iceServersFor(users.dev, now);
      const expiry = now / 1000 + 3600;
      expect(turn.username).toBe(`${expiry}:${users.dev._id}`);
      const crypto = await import('crypto');
      expect(turn.credential).toBe(crypto.createHmac('sha1', 'test-secret').update(turn.username).digest('base64'));
      expect(JSON.stringify(turn)).not.toContain('test-secret');
    });
  });

  describe('index script (prod builds no indexes on deploy)', () => {
    it('builds every declared index once, then reports them already there', async () => {
      await ChatCall.collection.dropIndexes().catch(() => {});
      expect(INDEXES.map(([, o]) => o.name).sort()).toEqual([
        'chat_call_live_callee', 'chat_call_live_caller', 'chat_call_live_channel', 'chat_call_live_status',
      ]);
      const quiet = () => {};
      expect((await buildIndexes({ apply: false, log: quiet })).every(([, st]) => st === 'would build')).toBe(true);
      expect((await buildIndexes({ apply: true, log: quiet })).every(([, st]) => st === 'built')).toBe(true);
      expect((await buildIndexes({ apply: true, log: quiet })).every(([, st]) => st === 'already there')).toBe(true);
    });

    it('the built unique index allows one live call per DM, and any number of ended ones', async () => {
      await ChatCall.collection.dropIndexes().catch(() => {});
      await buildIndexes({ apply: true, log: () => {} });
      const base = { channel: new mongoose.Types.ObjectId(), caller: users.dev._id, callee: users.mkt._id, media: 'audio', ringUntil: new Date() };
      await ChatCall.collection.insertOne({ ...base, status: 'ended', live: false });
      await ChatCall.collection.insertOne({ ...base, status: 'ended', live: false });
      await ChatCall.collection.insertOne({ ...base, status: 'ringing', live: true });
      await expect(ChatCall.collection.insertOne({ ...base, status: 'ringing', live: true })).rejects.toMatchObject({ code: 11000 });
    });
  });
});
