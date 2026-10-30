/**
 * services/storage/storeAll.js — a batch of uploads, a few at a time, all or nothing.
 */
import { storeAll, STORE_CONCURRENCY } from '../services/storage/storeAll.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('storeAll', () => {
  it('returns results in input order, whatever order they finish in', async () => {
    const out = await storeAll([30, 5, 20, 1, 10], async (ms, i) => { await wait(ms); return `r${i}`; }, async () => {});
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it(`never runs more than ${STORE_CONCURRENCY} at once, and is faster than one by one`, async () => {
    let running = 0;
    let peak = 0;
    const t0 = Date.now();
    await storeAll(Array.from({ length: 20 }, (_, i) => i), async (i) => {
      running += 1; peak = Math.max(peak, running);
      await wait(20);
      running -= 1;
      return i;
    }, async () => {});
    expect(peak).toBe(STORE_CONCURRENCY);
    expect(Date.now() - t0).toBeLessThan(20 * 20); // sequential would be ≥ 400 ms
  });

  it('on a failure: starts nothing new, removes every stored file, rethrows the first error', async () => {
    const started = [];
    const removed = [];
    const boom = new Error('storage down');
    await expect(storeAll(Array.from({ length: 20 }, (_, i) => i), async (i) => {
      started.push(i);
      await wait(5);
      if (i === 2) throw boom;
      if (i === 3) throw new Error('second failure');
      return `ref${i}`;
    }, async (ref) => { removed.push(ref); })).rejects.toBe(boom);
    expect(started.length).toBeLessThan(20);
    // Everything that did get stored (in flight when the failure landed included) is removed.
    const storedOk = started.filter((i) => i !== 2 && i !== 3).map((i) => `ref${i}`);
    expect(removed.sort()).toEqual(storedOk.sort());
    expect(removed).toContain('ref0');
  });

  it('a failing removal does not hide the original error', async () => {
    const boom = new Error('put failed');
    await expect(storeAll([1, 2], async (i) => { if (i === 2) { await wait(5); throw boom; } return i; },
      async () => { throw new Error('delete failed'); })).rejects.toBe(boom);
  });

  it('an empty batch stores nothing', async () => {
    expect(await storeAll([], async () => 1, async () => {})).toEqual([]);
  });
});
