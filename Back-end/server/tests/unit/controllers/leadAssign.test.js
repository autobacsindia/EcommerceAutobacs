/**
 * CRM reps (name-only profiles) — assignment + claim + rep CRUD.
 * Invokes the controllers directly against in-memory Mongo (no HTTP/auth) so the
 * ownership rules are verified without a flaky login flow. Ownership is now a
 * named SalesRep profile (not the logged-in user), assigned/claimed by any admin.
 */

import mongoose from 'mongoose';
import { connect, closeDatabase, clearDatabase } from '../../db-handler.js';
import SalesRep from '../../../models/SalesRep.js';
import Lead from '../../../models/Lead.js';
import { assignLead, listReps, claimLead, bulkClaim, updateLeadStatus, addActivity, releaseLead } from '../../../controllers/leadController.js';
import { createSalesRep, listSalesReps, updateSalesRep } from '../../../controllers/salesRepController.js';

const ADMIN_ID = new mongoose.Types.ObjectId().toString();

beforeAll(async () => { await connect(); });
afterEach(async () => { await clearDatabase(); });
afterAll(async () => { await closeDatabase(); });

/** Minimal Express res double capturing status + json. */
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const seedLead = () => Lead.create({ identityKey: 'email:t@x.com', email: 't@x.com', name: 'T', status: 'new' });
const seedRep = (name = 'Rahul', over = {}) => SalesRep.create({ name, ...over });

describe('leadController.assignLead — named rep', () => {
  it('rejects a malformed rep id (400), lead untouched', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await assignLead({ params: { id: lead._id.toString() }, body: { repId: 'not-an-id' }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('rejects an inactive rep (400)', async () => {
    const lead = await seedLead();
    const rep = await seedRep('Old Rep', { isActive: false });
    const res = mockRes();
    await assignLead({ params: { id: lead._id.toString() }, body: { repId: rep._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('assigns to an active rep and records the audit + activity', async () => {
    const lead = await seedLead();
    const rep = await seedRep();
    const res = mockRes();
    await assignLead({ params: { id: lead._id.toString() }, body: { repId: rep._id.toString() }, user: { id: ADMIN_ID } }, res);

    expect(res.body.success).toBe(true);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedRep.toString()).toBe(rep._id.toString());
    expect(fresh.assignedTo.toString()).toBe(ADMIN_ID); // console operator, audit
    expect(fresh.activities.some((a) => a.type === 'assignment' && a.rep?.toString() === rep._id.toString())).toBe(true);
  });

  it('unassigns (back to pool) when repId is null', async () => {
    const rep = await seedRep();
    const lead = await Lead.create({ identityKey: 'email:u@x.com', email: 'u@x.com', status: 'new', assignedRep: rep._id });
    const res = mockRes();
    await assignLead({ params: { id: lead._id.toString() }, body: { repId: null }, user: { id: ADMIN_ID } }, res);
    expect(res.body.success).toBe(true);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });
});

describe('leadController.claimLead / bulkClaim — atomic claim for a rep', () => {
  it('claimLead requires a valid rep (400), lead stays in pool', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await claimLead({ params: { id: lead._id.toString() }, body: {}, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('claimLead claims an unassigned lead for the rep', async () => {
    const lead = await seedLead();
    const rep = await seedRep();
    const res = mockRes();
    await claimLead({ params: { id: lead._id.toString() }, body: { repId: rep._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.body.success).toBe(true);
    expect((await Lead.findById(lead._id)).assignedRep.toString()).toBe(rep._id.toString());
  });

  it('claimLead on an already-claimed lead returns 409', async () => {
    const repA = await seedRep('A');
    const repB = await seedRep('B');
    const lead = await Lead.create({ identityKey: 'email:c@x.com', email: 'c@x.com', status: 'new', assignedRep: repA._id });
    const res = mockRes();
    await claimLead({ params: { id: lead._id.toString() }, body: { repId: repB._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(409);
    expect((await Lead.findById(lead._id)).assignedRep.toString()).toBe(repA._id.toString());
  });

  it('bulkClaim requires a valid rep (400)', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await bulkClaim({ body: { leadIds: [lead._id.toString()] }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('leadController.listReps — active SalesRep profiles', () => {
  it('lists only active profiles, name-sorted', async () => {
    await seedRep('Rahul');
    await seedRep('Amit');
    await seedRep('Gone', { isActive: false });
    const res = mockRes();
    await listReps({}, res);
    expect(res.body.success).toBe(true);
    expect(res.body.reps.map((r) => r.name)).toEqual(['Amit', 'Rahul']);
  });
});

describe('leadController — credit an action to a since-deactivated owner', () => {
  it('updateLeadStatus succeeds when the owner rep is now inactive', async () => {
    const rep = await seedRep('Left', { isActive: false });
    const lead = await Lead.create({ identityKey: 'email:d@x.com', email: 'd@x.com', status: 'new', assignedRep: rep._id });
    const res = mockRes();
    await updateLeadStatus({ params: { id: lead._id.toString() }, body: { status: 'contacted', repId: rep._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.body.success).toBe(true);
    expect((await Lead.findById(lead._id)).status).toBe('contacted');
  });

  it('addActivity succeeds crediting an inactive owner', async () => {
    const rep = await seedRep('Left2', { isActive: false });
    const lead = await Lead.create({ identityKey: 'email:e@x.com', email: 'e@x.com', status: 'new', assignedRep: rep._id });
    const res = mockRes();
    await addActivity({ params: { id: lead._id.toString() }, body: { type: 'call', notes: 'hi', repId: rep._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.body.success).toBe(true);
  });

  it('still rejects a bogus rep id on a status change', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await updateLeadStatus({ params: { id: lead._id.toString() }, body: { status: 'contacted', repId: new mongoose.Types.ObjectId().toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('leadController.releaseLead — idempotent, no spurious activity', () => {
  it('releasing an already-pooled lead adds no activity', async () => {
    const lead = await seedLead(); // assignedRep null
    const before = (await Lead.findById(lead._id)).activities.length;
    const res = mockRes();
    await releaseLead({ params: { id: lead._id.toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.body.success).toBe(true);
    const after = await Lead.findById(lead._id);
    expect(after.activities.length).toBe(before); // no "Released to pool" logged
    expect(after.assignedRep).toBeNull();
  });

  it('releasing an owned lead clears it and logs exactly once', async () => {
    const rep = await seedRep();
    const lead = await Lead.create({ identityKey: 'email:r@x.com', email: 'r@x.com', status: 'new', assignedRep: rep._id });
    const res = mockRes();
    await releaseLead({ params: { id: lead._id.toString() }, user: { id: ADMIN_ID } }, res);
    const after = await Lead.findById(lead._id);
    expect(after.assignedRep).toBeNull();
    expect(after.activities.filter((a) => a.notes === 'Released to pool')).toHaveLength(1);
  });

  it('404 when releasing a missing lead', async () => {
    const res = mockRes();
    await releaseLead({ params: { id: new mongoose.Types.ObjectId().toString() }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('salesRepController — name-only CRUD', () => {
  it('creates a rep and rejects a duplicate name (case-insensitive)', async () => {
    const res1 = mockRes();
    await createSalesRep({ body: { name: 'Priya' }, user: { id: ADMIN_ID } }, res1);
    expect(res1.statusCode).toBe(201);
    expect(res1.body.rep.name).toBe('Priya');

    const res2 = mockRes();
    await createSalesRep({ body: { name: '  priya ' }, user: { id: ADMIN_ID } }, res2);
    expect(res2.statusCode).toBe(409);
  });

  it('rejects an empty name (400)', async () => {
    const res = mockRes();
    await createSalesRep({ body: { name: '   ' }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('renames and deactivates; deactivated reps drop from the active list', async () => {
    const rep = await seedRep('Temp');
    const upd = mockRes();
    await updateSalesRep({ params: { id: rep._id.toString() }, body: { name: 'Renamed', isActive: false } }, upd);
    expect(upd.body.rep.name).toBe('Renamed');
    expect(upd.body.rep.isActive).toBe(false);

    const active = mockRes();
    await listSalesReps({ query: {} }, active);
    expect(active.body.reps).toHaveLength(0);

    const all = mockRes();
    await listSalesReps({ query: { all: 'true' } }, all);
    expect(all.body.reps).toHaveLength(1);
  });

  it('returns 404 updating a missing rep', async () => {
    const res = mockRes();
    await updateSalesRep({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { name: 'X' } }, res);
    expect(res.statusCode).toBe(404);
  });
});
