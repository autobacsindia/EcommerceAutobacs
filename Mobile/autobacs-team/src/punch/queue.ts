/**
 * The offline punch queue and the offline liveness-challenge pool.
 *
 * Pure logic: storage and frame deletion are injected, so tests/queue.test.ts
 * drives it with an in-memory store and a fake server.
 *
 * Invariants
 * - A punch gets its clientPunchId ONCE, when it is taken, and every retry
 *   sends that same id. The server keeps one punch per {employee, clientPunchId}
 *   and answers a replay with 200 + the existing punch, so "sent but the answer
 *   was lost" followed by a retry still makes exactly one punch.
 * - Punches are sent oldest first and a transient failure (offline, 429, 5xx,
 *   expired login) stops the run, so an "out" never overtakes its "in".
 * - Only the signed-in employee's punches are sent; another person's queued
 *   punches on a shared phone are never sent under this login.
 * - One flush at a time: a second call while one runs gets the same promise.
 * - A queued punch is only usable until its offline challenge expires (the
 *   server's offline window). After that it is marked expired, not sent.
 * - Face frames live on the phone only while the punch waits. They are deleted
 *   as soon as the server has answered (accepted OR refused) or the punch
 *   expires/is dismissed.
 */
import { ApiError } from '../api/http';
import type { Challenge, Frame, PunchInput, PunchResult } from '../api/types';

export type JsonStore = {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
};

export type QueuedPunch = {
  employeeId: string;
  input: PunchInput;
  /** When the offline challenge (and so this punch) stops being usable. */
  expiresAt: string;
  state: 'pending' | 'refused' | 'expired';
  attempts: number;
  /** Last person-readable reason (a refusal, or why the last try failed). */
  message?: string;
  code?: string;
  createdAt: string;
};

export type FlushReport = { sent: PunchResult[]; refused: QueuedPunch[]; expired: QueuedPunch[]; stoppedBy?: ApiError };

export type QueueDeps = {
  store: JsonStore;
  deleteFrames: (frames: Frame[]) => Promise<void>;
  now?: () => number;
};

const QUEUE_KEY = 'punch-queue.v1';
const POOL_KEY = 'offline-challenges.v1';

/** Errors that mean "try the same request again later", unchanged. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // unknown failure: keep the punch
  return err.transient || err.status === 401 || err.notAvailable;
}

export function createPunchQueue({ store, deleteFrames, now = Date.now }: QueueDeps) {
  let items: QueuedPunch[] | null = null;
  let flushing: Promise<FlushReport> | null = null;
  // Serialise every read-modify-write so enqueue during a flush is never lost.
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<QueuedPunch[]> {
    if (!items) items = (await store.read<QueuedPunch[]>(QUEUE_KEY)) ?? [];
    return items;
  }
  const save = () => store.write(QUEUE_KEY, items ?? []);
  const dropFrames = async (q: QueuedPunch) => {
    const frames = q.input.frames;
    q.input = { ...q.input, frames: [] };
    if (frames.length) await deleteFrames(frames).catch(() => undefined);
  };

  async function enqueue(employeeId: string, input: PunchInput, challenge: Challenge): Promise<QueuedPunch> {
    return serial(async () => {
      const list = await load();
      const existing = list.find((q) => q.input.clientPunchId === input.clientPunchId);
      if (existing) return existing;
      const q: QueuedPunch = {
        employeeId,
        input: { ...input, offline: true, at: input.at ?? new Date(now()).toISOString(), challengeId: challenge.challengeId },
        expiresAt: challenge.expiresAt,
        state: 'pending',
        attempts: 0,
        createdAt: new Date(now()).toISOString(),
      };
      list.push(q);
      await save();
      return q;
    });
  }

  async function runFlush(send: (input: PunchInput) => Promise<PunchResult>, employeeId: string): Promise<FlushReport> {
    const report: FlushReport = { sent: [], refused: [], expired: [] };
    const queue = await serial(load);
    for (const q of [...queue]) {
      if (q.state !== 'pending' || q.employeeId !== employeeId) continue;
      if (Date.parse(q.expiresAt) <= now()) {
        await serial(async () => {
          q.state = 'expired';
          q.message = 'Too old to send. Ask HR to fix this day.';
          await dropFrames(q);
          await save();
        });
        report.expired.push(q);
        continue;
      }
      try {
        const result = await send(q.input);
        await serial(async () => {
          await dropFrames(q);
          items = (items ?? []).filter((x) => x !== q);
          await save();
        });
        report.sent.push(result);
      } catch (err) {
        if (isRetryable(err)) {
          await serial(async () => {
            q.attempts += 1;
            q.message = err instanceof Error ? err.message : undefined;
            await save();
          });
          report.stoppedBy = err instanceof ApiError ? err : new ApiError('Could not send', 0, 'OFFLINE');
          break; // keep order: nothing newer goes before this one
        }
        await serial(async () => {
          q.state = 'refused';
          q.message = err instanceof Error ? err.message : 'Refused';
          q.code = err instanceof ApiError ? err.code : undefined;
          await dropFrames(q);
          await save();
        });
        report.refused.push(q);
      }
    }
    return report;
  }

  return {
    enqueue,
    list: () => serial(async () => [...(await load())]),
    pendingCount: async (employeeId: string) =>
      (await serial(load)).filter((q) => q.state === 'pending' && q.employeeId === employeeId).length,
    /** Send what is waiting. Concurrent callers share one run. */
    flush(send: (input: PunchInput) => Promise<PunchResult>, employeeId: string): Promise<FlushReport> {
      if (!flushing) {
        flushing = runFlush(send, employeeId).finally(() => {
          flushing = null;
        });
      }
      return flushing;
    },
    /** Remove a refused/expired entry the person has seen. */
    dismiss: (clientPunchId: string) =>
      serial(async () => {
        const list = await load();
        const q = list.find((x) => x.input.clientPunchId === clientPunchId);
        if (!q || q.state === 'pending') return;
        await dropFrames(q);
        items = list.filter((x) => x !== q);
        await save();
      }),
    /** Explicit sign-out: this person's unsent punches and their frames go. */
    discardFor: (employeeId: string) =>
      serial(async () => {
        const list = await load();
        for (const q of list.filter((x) => x.employeeId === employeeId)) await dropFrames(q);
        items = list.filter((x) => x.employeeId !== employeeId);
        await save();
      }),
  };
}

export type PunchQueue = ReturnType<typeof createPunchQueue>;

// ── offline challenge pool ───────────────────────────────────────────────────

type Pooled = Challenge & { employeeId: string };

/**
 * Offline punches need a liveness challenge fetched while online (purpose
 * 'offline', lives as long as the server's offline window). Keep a small pool:
 * one for the clock-in and one for the clock-out of an offline day.
 */
export function createChallengePool({ store, now = Date.now, size = 2 }: { store: JsonStore; now?: () => number; size?: number }) {
  // A challenge with under 5 minutes left is not worth starting a punch with.
  const usable = (c: Pooled) => Date.parse(c.expiresAt) - now() > 5 * 60_000;
  const read = async () => ((await store.read<Pooled[]>(POOL_KEY)) ?? []).filter(usable);
  return {
    async refill(employeeId: string, fetchOne: () => Promise<Challenge>): Promise<number> {
      const pool = await read();
      let mine = pool.filter((c) => c.employeeId === employeeId).length;
      while (mine < size) {
        pool.push({ ...(await fetchOne()), employeeId });
        mine += 1;
      }
      await store.write(POOL_KEY, pool);
      return mine;
    },
    /** Hands out each challenge once (the server accepts each only once). */
    async take(employeeId: string): Promise<Challenge | null> {
      const pool = await read();
      const i = pool.findIndex((c) => c.employeeId === employeeId);
      const c = i >= 0 ? pool.splice(i, 1)[0] : null;
      await store.write(POOL_KEY, pool);
      return c;
    },
    clear: () => store.write(POOL_KEY, []),
  };
}
