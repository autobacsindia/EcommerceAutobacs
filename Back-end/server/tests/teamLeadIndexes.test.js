/**
 * The GTM leads sheet must page through an index, not read every open lead and
 * sort it in memory. Measured on 30,000 leads before the indexes in models/Lead.js
 * were added: 20,000 read per page. This captures the exact query the service sends
 * (every view and sort, first page and the next) and checks MongoDB's plan for it.
 */
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const dbHandler = await import('./db-handler.js');
const { default: Lead } = await import('../models/Lead.js');
const { default: leadRepository } = await import('../repositories/leadRepository.js');
const { default: salesRepRepository } = await import('../repositories/salesRepRepository.js');
const svc = await import('../services/teamLeadService.js');

jest.setTimeout(120000);
const N = 3000;
const reps = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
const actor = { _id: new mongoose.Types.ObjectId(), role: 'admin', name: 'Admin' };

beforeAll(async () => { await dbHandler.connect(); });
// The shared test setup empties the database after every test, so each case reloads.
beforeEach(async () => {
  await Lead.syncIndexes();
  const src = ['payment_failed', 'consultation', 'cart_abandoned', 'dormant_user', 'payment_pending'];
  const st = ['new', 'contacted', 'qualified', 'won', 'lost'];
  await Lead.collection.insertMany(Array.from({ length: N }, (_, i) => ({
    identityKey: `k${i}`, name: `Lead ${i}`, primarySource: src[i % 5], status: st[(i * 3) % 5],
    leadScore: (i * 13) % 100, assignedRep: i % 3 === 0 ? reps[i % 4] : null,
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 6e4), updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 6e4),
  })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

/** Run one list call; return the plan of the find it sent and the page it got. */
async function planOf(params, mine = null) {
  const spy = jest.spyOn(leadRepository, 'teamPage');
  const repSpy = jest.spyOn(salesRepRepository, 'findByUser').mockResolvedValue(mine ? { _id: mine, name: 'Me' } : null);
  try {
    const page = await svc.listTeamLeads(actor, params);
    const [query, { sort, limit }] = spy.mock.calls[0];
    const ex = await Lead.find(query).sort(sort).limit(limit).explain('executionStats');
    const plan = JSON.stringify(ex.queryPlanner.winningPlan);
    return { page, sorted: plan.includes('"SORT"'), read: ex.executionStats.totalDocsExamined };
  } finally { spy.mockRestore(); repSpy.mockRestore(); }
}

const CASES = [
  ['all, by score', { view: 'all' }],
  ['free, by score', { view: 'free' }],
  ['mine, by score', { view: 'mine' }, reps[0]],
  ['one person, by score', { view: 'person', rep: String(reps[1]) }],
  ['all, newest', { view: 'all', sort: 'newest' }],
  ['all, recently active', { view: 'all', sort: 'updated' }],
];

describe.each(CASES)('%s', (_label, params, mine) => {
  it('first page and the next page walk an index (no in-memory sort, a handful of rows read)', async () => {
    const first = await planOf(params, mine);
    expect(first.sorted).toBe(false);
    expect(first.read).toBeLessThan(200);
    expect([first.page.leads.length, first.page.nextCursor ? "cursor" : "none"]).toEqual([20, "cursor"]);
    const next = await planOf({ ...params, cursor: first.page.nextCursor }, mine);
    expect(next.sorted).toBe(false);
    expect(next.read).toBeLessThan(200);
  });
});
