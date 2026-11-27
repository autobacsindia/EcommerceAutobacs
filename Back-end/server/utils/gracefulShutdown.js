/**
 * Graceful shutdown for a Railway deploy.
 *
 * Railway's sequence (railway.json): the new deploy passes /health, traffic
 * moves to it, the old one keeps running for `overlapSeconds`, then gets
 * SIGTERM, then SIGKILL `drainingSeconds` (25s) later. Everything below must
 * therefore finish INSIDE that 25s, or it never finishes at all.
 *
 * What the old handler got wrong (both seen in code, both every deploy):
 *  1. `server.close(cb)` waits for EVERY open connection. Staff panels hold
 *     server-sent-event streams (chat, dashboard) open indefinitely, so the
 *     callback never ran: queues and Mongo were never closed and the process
 *     was always SIGKILLed. The 30s force-exit timer sat above the 25s kill,
 *     so it never fired either.
 *  2. BullMQ *workers* were never closed (only the Queue producers). A job
 *     mid-send at SIGTERM (order email, WhatsApp, image upload) was killed,
 *     left "stalled", and re-run later by the new instance — a duplicate send
 *     when the first attempt had already reached the provider.
 *
 * Sequence now:
 *   t=0      stop accepting, drop idle keep-alive sockets, workers stop taking
 *            new jobs and finish the ones in hand (worker.close()).
 *   t=drain  cut whatever connections remain (SSE streams; EventSource
 *            reconnects to the new instance by itself).
 *   then     close queues + Mongo, exit 0.
 *   t=hard   (below Railway's kill) log and exit 1 if anything hung.
 */

export const DEFAULT_DRAIN_MS = 10_000;
/** Below railway.json drainingSeconds (25s) so we exit, logged, before SIGKILL. */
export const DEFAULT_HARD_MS = 22_000;

const secondsEnv = (name, fallbackMs) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallbackMs;
};

/**
 * @param {object} deps
 * @param {import('http').Server} deps.server
 * @param {Array<{ close: () => Promise<void> } | null | undefined>} [deps.workers]
 * @param {Array<() => Promise<unknown>>} [deps.closers]  run in order after HTTP + workers
 * @param {number} [deps.drainMs]
 * @param {number} [deps.hardMs]
 * @param {(code: number) => void} [deps.exit]
 * @param {Pick<Console, 'log' | 'error'>} [deps.logger]
 * @returns {(signal: string) => Promise<void>}
 */
export function createShutdownHandler({
  server,
  workers = [],
  closers = [],
  drainMs = secondsEnv('SHUTDOWN_DRAIN_SECONDS', DEFAULT_DRAIN_MS),
  hardMs = secondsEnv('SHUTDOWN_GRACE_SECONDS', DEFAULT_HARD_MS),
  exit = (code) => process.exit(code),
  logger = console,
}) {
  let started = null;

  return function shutdown(signal) {
    // A second SIGTERM/SIGINT must not restart the sequence or exit early.
    if (started) return started;

    started = (async () => {
      const t0 = Date.now();
      const since = () => `${Date.now() - t0}ms`;
      logger.log(`⏹ ${signal} received, shutting down gracefully...`);

      const hardTimer = setTimeout(() => {
        logger.error(`✗ Graceful shutdown exceeded ${hardMs}ms — forcing exit`);
        exit(1);
      }, hardMs);
      hardTimer.unref?.();

      const httpClosed = new Promise((resolve) => server.close(() => resolve()));
      // close() only drops sockets idle *now*; a keep-alive socket whose request
      // finishes a moment later would sit until the drain cut. Sweep as they go idle.
      server.closeIdleConnections?.();
      const idleSweep = setInterval(() => server.closeIdleConnections?.(), 250);
      idleSweep.unref?.();

      const drainTimer = setTimeout(() => {
        logger.log(`⏹ drain window over (${since()}) — closing remaining connections`);
        server.closeAllConnections?.();
      }, drainMs);
      drainTimer.unref?.();

      const workersClosed = Promise.allSettled(
        workers.filter(Boolean).map((w) => w.close())
      );

      await Promise.all([httpClosed, workersClosed]);
      clearTimeout(drainTimer);
      clearInterval(idleSweep);
      logger.log(`✓ HTTP drained and workers stopped (${since()})`);

      for (const close of closers) {
        try {
          await close();
        } catch (err) {
          logger.error(`✗ shutdown step failed: ${err?.message || err}`);
        }
      }

      clearTimeout(hardTimer);
      logger.log(`✓ Shutdown complete (${since()})`);
      exit(0);
    })();

    return started;
  };
}

export default createShutdownHandler;
