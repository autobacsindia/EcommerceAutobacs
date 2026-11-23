/**
 * Runs the offline punch queue for the signed-in employee:
 * - sends waiting punches on start, when the app comes back to the front, and
 *   every minute while something is waiting;
 * - keeps the offline challenge pool topped up while online;
 * - exposes the queue so Today can show "2 punches waiting to send".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, IS_MOCK } from '../api';
import { createChallengePool, createPunchQueue, type FlushReport, type QueuedPunch } from './queue';
import { deleteFrames, fileStore, sweepOrphanFrames } from './storage';

export const queue = createPunchQueue({ store: fileStore, deleteFrames });
export const challengePool = createChallengePool({ store: fileStore });

type Value = {
  items: QueuedPunch[];
  syncing: boolean;
  syncNow: () => Promise<FlushReport | null>;
  reload: () => Promise<void>;
  dismiss: (clientPunchId: string) => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

export function PunchProvider({ employeeId, children }: { employeeId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<QueuedPunch[]>([]);
  const [syncing, setSyncing] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const all = await queue.list();
    if (alive.current) setItems(all.filter((q) => q.employeeId === employeeId));
  }, [employeeId]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const report = await queue.flush((input) => api.punch(input), employeeId);
      if (report.sent.length || report.refused.length) {
        void qc.invalidateQueries({ queryKey: ['status'] });
        void qc.invalidateQueries({ queryKey: ['month'] });
      }
      // Online right now (nothing stopped the run): top up offline checks.
      if (!report.stoppedBy && !IS_MOCK) {
        await challengePool.refill(employeeId, () => api.challenge('offline')).catch(() => undefined);
      }
      return report;
    } catch {
      return null;
    } finally {
      if (alive.current) setSyncing(false);
      await reload();
    }
  }, [employeeId, qc, reload]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const all = await queue.list();
      await sweepOrphanFrames(new Set(all.flatMap((q) => q.input.frames.map((f) => f.uri))));
      await syncNow();
    })();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [syncNow]);

  const waiting = items.some((q) => q.state === 'pending');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void syncNow(), 60_000);
    return () => clearInterval(t);
  }, [waiting, syncNow]);

  const value = useMemo<Value>(
    () => ({
      items,
      syncing,
      syncNow,
      reload,
      dismiss: async (id) => {
        await queue.dismiss(id);
        await reload();
      },
    }),
    [items, syncing, syncNow, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePunchQueue(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePunchQueue outside PunchProvider');
  return v;
}
