import { ApiError } from '../src/api/http';
import type { Challenge, Frame, PunchInput, PunchResult } from '../src/api/types';
import { createChallengePool, createPunchQueue, type JsonStore } from '../src/punch/queue';

const NOW = Date.parse('2026-11-23T04:30:00Z');

function memoryStore(): JsonStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: async <T,>(k: string) => (data.has(k) ? (JSON.parse(data.get(k)!) as T) : null),
    write: async (k, v) => {
      data.set(k, JSON.stringify(v));
    },
  };
}

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  challengeId: 'ch-1',
  action: 'turn_left',
  purpose: 'offline',
  expiresAt: new Date(NOW + 24 * 3600e3).toISOString(),
  ...over,
});

const punch = (id: string, type: PunchInput['type'] = 'in'): PunchInput => ({
  clientPunchId: id,
  type,
  lat: 9.98,
  lng: 76.3,
  accuracyM: 12,
  mocked: false,
  deviceId: 'dev-1',
  platform: 'android',
  offline: false,
  challengeId: '',
  frames: [{ uri: `file:///f/${id}-1.jpg`, mimeType: 'image/jpeg' }, { uri: `file:///f/${id}-2.jpg`, mimeType: 'image/jpeg' }],
});

/** A server that, like the real one, keeps one punch per clientPunchId. */
function fakeServer() {
  const punches = new Map<string, PunchInput>();
  const calls: string[] = [];
  let failures: (ApiError | 'lost-reply')[] = [];
  const send = async (input: PunchInput): Promise<PunchResult> => {
    calls.push(input.clientPunchId);
    const next = failures.shift();
    if (next instanceof ApiError) throw next;
    const replay = punches.has(input.clientPunchId);
    if (!replay) punches.set(input.clientPunchId, input);
    if (next === 'lost-reply') throw new ApiError('offline', 0, 'OFFLINE'); // stored, but the phone never heard back
    return { punch: { clientPunchId: input.clientPunchId } as PunchResult['punch'], day: null, replay };
  };
  return { punches, calls, send, failWith: (...f: (ApiError | 'lost-reply')[]) => (failures = f) };
}

function setup(now = () => NOW) {
  const store = memoryStore();
  const deleted: Frame[] = [];
  const queue = createPunchQueue({ store, now, deleteFrames: async (f) => void deleted.push(...f) });
  return { store, deleted, queue };
}

describe('offline punch queue', () => {
  test('a retry after a lost reply makes exactly one punch (same clientPunchId)', async () => {
    const { queue } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());

    server.failWith('lost-reply');
    const first = await queue.flush(server.send, 'emp-1');
    expect(first.stoppedBy?.offline).toBe(true);
    expect(await queue.pendingCount('emp-1')).toBe(1);

    const second = await queue.flush(server.send, 'emp-1');
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0].replay).toBe(true);
    expect(server.calls).toEqual(['p-aaaa1111', 'p-aaaa1111']);
    expect(server.punches.size).toBe(1);
    expect(await queue.pendingCount('emp-1')).toBe(0);
  });

  test('marks the punch offline with its real time and the offline challenge', async () => {
    const { queue } = setup();
    const q = await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge({ challengeId: 'off-9' }));
    expect(q.input.offline).toBe(true);
    expect(q.input.at).toBe(new Date(NOW).toISOString());
    expect(q.input.challengeId).toBe('off-9');
  });

  test('enqueueing the same clientPunchId twice keeps one entry', async () => {
    const { queue } = setup();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());
    expect(await queue.list()).toHaveLength(1);
  });

  test('concurrent flushes share one run: each punch is sent once', async () => {
    const { queue } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-in000001', 'in'), challenge());
    await queue.enqueue('emp-1', punch('p-out00001', 'out'), challenge());
    const [a, b] = await Promise.all([queue.flush(server.send, 'emp-1'), queue.flush(server.send, 'emp-1')]);
    expect(a).toBe(b);
    expect(server.calls).toEqual(['p-in000001', 'p-out00001']);
  });

  test('a transient failure stops the run so an "out" never overtakes its "in"', async () => {
    const { queue } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-in000001', 'in'), challenge());
    await queue.enqueue('emp-1', punch('p-out00001', 'out'), challenge());
    server.failWith(new ApiError('busy', 503));
    const r = await queue.flush(server.send, 'emp-1');
    expect(server.calls).toEqual(['p-in000001']);
    expect(r.stoppedBy?.status).toBe(503);
    expect(await queue.pendingCount('emp-1')).toBe(2);
    const [first] = await queue.list();
    expect(first.attempts).toBe(1);
  });

  test('a signed-out (401) send keeps the punch for after login', async () => {
    const { queue } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());
    server.failWith(new ApiError('Please sign in again.', 401, 'SIGNED_OUT'));
    await queue.flush(server.send, 'emp-1');
    expect(await queue.pendingCount('emp-1')).toBe(1);
  });

  test('a refusal (422) is kept as refused with its message, frames deleted, and later punches still go', async () => {
    const { queue, deleted } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-in000001'), challenge());
    await queue.enqueue('emp-1', punch('p-in000002'), challenge());
    server.failWith(new ApiError('You are 900 m from Main showroom.', 422, 'outside_fence', { distanceM: 900 }));
    const r = await queue.flush(server.send, 'emp-1');
    expect(r.refused.map((q) => q.code)).toEqual(['outside_fence']);
    expect(r.sent).toHaveLength(1);
    const list = await queue.list();
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe('refused');
    expect(list[0].message).toMatch(/900 m/);
    expect(list[0].input.frames).toEqual([]);
    expect(deleted).toHaveLength(4); // both punches' frames: refused + sent
  });

  test('a punch past its offline window is expired, not sent, and its frames are deleted', async () => {
    let now = NOW;
    const { queue, deleted } = setup(() => now);
    const server = fakeServer();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge({ expiresAt: new Date(NOW + 3600e3).toISOString() }));
    now = NOW + 2 * 3600e3;
    const r = await queue.flush(server.send, 'emp-1');
    expect(server.calls).toEqual([]);
    expect(r.expired).toHaveLength(1);
    expect(deleted).toHaveLength(2);
    await queue.dismiss('p-aaaa1111');
    expect(await queue.list()).toEqual([]);
  });

  test("another employee's queued punches are never sent under this login", async () => {
    const { queue } = setup();
    const server = fakeServer();
    await queue.enqueue('emp-OTHER', punch('p-other001'), challenge());
    await queue.enqueue('emp-1', punch('p-mine0001'), challenge());
    await queue.flush(server.send, 'emp-1');
    expect(server.calls).toEqual(['p-mine0001']);
    expect(await queue.pendingCount('emp-OTHER')).toBe(1);
  });

  test('the queue survives an app restart (persisted)', async () => {
    const { store, queue } = setup();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());
    const reopened = createPunchQueue({ store, now: () => NOW, deleteFrames: async () => {} });
    expect(await reopened.pendingCount('emp-1')).toBe(1);
  });

  test('sign-out discards only that person’s punches and frames', async () => {
    const { queue, deleted } = setup();
    await queue.enqueue('emp-1', punch('p-aaaa1111'), challenge());
    await queue.enqueue('emp-2', punch('p-bbbb2222'), challenge());
    await queue.discardFor('emp-1');
    const list = await queue.list();
    expect(list.map((q) => q.employeeId)).toEqual(['emp-2']);
    expect(deleted).toHaveLength(2);
  });
});

describe('offline challenge pool', () => {
  test('refills to two, hands each out once, and drops ones about to expire', async () => {
    let now = NOW;
    const store = memoryStore();
    const pool = createChallengePool({ store, now: () => now });
    let n = 0;
    await pool.refill('emp-1', async () => challenge({ challengeId: `c${++n}` }));
    expect(n).toBe(2);
    await pool.refill('emp-1', async () => challenge({ challengeId: `c${++n}` }));
    expect(n).toBe(2); // already full
    expect((await pool.take('emp-1'))?.challengeId).toBe('c1');
    expect((await pool.take('emp-OTHER'))).toBeNull();
    now = NOW + 24 * 3600e3 - 60_000; // 1 minute left: too close to use
    expect(await pool.take('emp-1')).toBeNull();
  });
});
