import fs from 'node:fs';
import http from 'node:http';
import { jest } from '@jest/globals';
import { createShutdownHandler, DEFAULT_DRAIN_MS, DEFAULT_HARD_MS } from '../../../utils/gracefulShutdown.js';

const silent = { log: () => {}, error: () => {} };

/** Real HTTP server: /slow answers after `ms`, /sse never ends (like chat/dashboard streams). */
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/slow')) {
      const ms = Number(new URL(req.url, 'http://x').searchParams.get('ms'));
      setTimeout(() => res.end('done'), ms);
    } else if (req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: hi\n\n');
    } else {
      res.end('ok');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const get = (server, path) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });

/** Opens an SSE stream and resolves once headers arrive; `closed` resolves when the server cuts it. */
const openStream = (server) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/sse' }, (res) => {
      const closed = new Promise((r) => { res.on('close', r); res.on('error', r); });
      resolve({ closed });
    });
    req.on('error', reject);
  });

const fakeWorker = (jobMs) => {
  const w = { closedAt: null, close: jest.fn(() => new Promise((r) => setTimeout(() => { w.closedAt = Date.now(); r(); }, jobMs))) };
  return w;
};

describe('createShutdownHandler', () => {
  test('finishes an in-flight request, waits for worker jobs, then closes queues/DB and exits 0', async () => {
    const server = await startServer();
    const order = [];
    const exit = jest.fn();
    const worker = fakeWorker(80);
    const shutdown = createShutdownHandler({
      server,
      workers: [worker, null], // a disabled worker returns null
      closers: [async () => order.push('queues'), async () => order.push('db')],
      drainMs: 2000,
      hardMs: 5000,
      exit,
      logger: silent,
    });

    const inFlight = get(server, '/slow?ms=150');
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    await shutdown('SIGTERM');
    // Finished well before the 2s drain cut: the keep-alive socket was released
    // as soon as its request completed.
    expect(Date.now() - t0).toBeLessThan(1000);

    await expect(inFlight).resolves.toEqual({ status: 200, body: 'done' });
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(worker.closedAt).not.toBeNull();
    expect(order).toEqual(['queues', 'db']);
    expect(exit).toHaveBeenCalledWith(0);
    expect(server.listening).toBe(false);
  });

  test('an open event stream no longer blocks shutdown: it is cut after the drain window', async () => {
    const server = await startServer();
    const exit = jest.fn();
    const stream = await openStream(server);
    const t0 = Date.now();
    await createShutdownHandler({ server, drainMs: 100, hardMs: 5000, exit, logger: silent })('SIGTERM');

    await stream.closed;
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(90);
    expect(took).toBeLessThan(2000);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a failing closer is logged and the rest still run', async () => {
    const server = await startServer();
    const exit = jest.fn();
    const ran = [];
    const errors = [];
    await createShutdownHandler({
      server,
      closers: [async () => { throw new Error('redis gone'); }, async () => ran.push('db')],
      drainMs: 100,
      hardMs: 5000,
      exit,
      logger: { log: () => {}, error: (m) => errors.push(m) },
    })('SIGTERM');
    expect(ran).toEqual(['db']);
    expect(errors.join()).toMatch(/redis gone/);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a hung worker hits the hard limit and exits 1 before the platform kill', async () => {
    const server = await startServer();
    const exit = jest.fn();
    const hung = { close: () => new Promise(() => {}) };
    createShutdownHandler({ server, workers: [hung], drainMs: 20, hardMs: 150, exit, logger: silent })('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    expect(exit).toHaveBeenCalledWith(1);
    expect(exit).not.toHaveBeenCalledWith(0);
  });

  test('a second signal does not run the sequence twice', async () => {
    const server = await startServer();
    const exit = jest.fn();
    const worker = fakeWorker(20);
    const shutdown = createShutdownHandler({ server, workers: [worker], drainMs: 100, hardMs: 5000, exit, logger: silent });
    const a = shutdown('SIGTERM');
    const b = shutdown('SIGINT');
    expect(b).toBe(a);
    await a;
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  test('defaults stay inside Railway drainingSeconds, drain window first', () => {
    const railway = JSON.parse(fs.readFileSync(new URL('../../../railway.json', import.meta.url), 'utf8'));
    const drainingMs = railway.deploy.drainingSeconds * 1000;
    expect(DEFAULT_HARD_MS).toBeLessThan(drainingMs);
    expect(DEFAULT_DRAIN_MS).toBeLessThan(DEFAULT_HARD_MS);
  });
});
