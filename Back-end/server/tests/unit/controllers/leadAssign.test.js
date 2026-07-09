/**
 * Phase 3 (CRM reps) — assignment guard + rep listing.
 * Invokes the controllers directly against in-memory Mongo (no HTTP/auth) so the
 * security-relevant rule — only a flagged sales rep can OWN a lead — is verified
 * without a flaky login flow. Also covers listReps + the isSalesRep seam.
 */

import mongoose from 'mongoose';
import { connect, closeDatabase, clearDatabase } from '../../db-handler.js';
import User from '../../../models/User.js';
import Lead from '../../../models/Lead.js';
import { assignLead, listReps, claimLead, bulkClaim } from '../../../controllers/leadController.js';
import { isSalesRep } from '../../../utils/salesReps.js';

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

async function seedLead() {
  return Lead.create({ identityKey: 'email:t@x.com', email: 't@x.com', name: 'T', status: 'new' });
}

describe('leadController.assignLead — rep-only guard', () => {
  it('rejects assigning to a non-rep user (400)', async () => {
    const lead = await seedLead();
    const nonRep = await User.create({ name: 'Nope', email: 'nope@x.com', passwordHash: 'x' });
    const res = mockRes();

    await assignLead(
      { params: { id: lead._id.toString() }, body: { assignTo: nonRep._id.toString() }, user: { id: ADMIN_ID } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedTo).toBeNull(); // untouched
  });

  it('rejects a malformed assignee id (400)', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await assignLead({ params: { id: lead._id.toString() }, body: { assignTo: 'not-an-id' }, user: { id: ADMIN_ID } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('assigns to a flagged sales rep', async () => {
    const lead = await seedLead();
    const rep = await User.create({ name: 'Rep', email: 'rep@x.com', passwordHash: 'x', isSalesRep: true });
    const res = mockRes();

    await assignLead(
      { params: { id: lead._id.toString() }, body: { assignTo: rep._id.toString() }, user: { id: ADMIN_ID } },
      res
    );

    expect(res.body.success).toBe(true);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedTo.toString()).toBe(rep._id.toString());
    expect(fresh.activities.some((a) => a.type === 'assignment')).toBe(true);
  });

  it('unassigns (back to pool) when assignTo is null — no rep check', async () => {
    const rep = await User.create({ name: 'Rep', email: 'rep2@x.com', passwordHash: 'x', isSalesRep: true });
    const lead = await Lead.create({ identityKey: 'email:u@x.com', email: 'u@x.com', status: 'new', assignedTo: rep._id });
    const res = mockRes();

    await assignLead({ params: { id: lead._id.toString() }, body: { assignTo: null }, user: { id: ADMIN_ID } }, res);

    expect(res.body.success).toBe(true);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedTo).toBeNull();
  });
});

describe('leadController.claimLead / bulkClaim — rep-only ownership', () => {
  it('claimLead rejects a non-rep (403), lead stays in pool', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await claimLead({ params: { id: lead._id.toString() }, user: { id: ADMIN_ID, isSalesRep: false } }, res);
    expect(res.statusCode).toBe(403);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedTo).toBeNull();
  });

  it('claimLead lets a flagged rep claim', async () => {
    const lead = await seedLead();
    const repId = new mongoose.Types.ObjectId().toString();
    const res = mockRes();
    await claimLead({ params: { id: lead._id.toString() }, user: { id: repId, isSalesRep: true } }, res);
    expect(res.body.success).toBe(true);
    const fresh = await Lead.findById(lead._id);
    expect(fresh.assignedTo.toString()).toBe(repId);
  });

  it('bulkClaim rejects a non-rep (403)', async () => {
    const lead = await seedLead();
    const res = mockRes();
    await bulkClaim({ body: { leadIds: [lead._id.toString()] }, user: { id: ADMIN_ID, isSalesRep: false } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('leadController.listReps + isSalesRep seam', () => {
  it('lists only flagged sales reps', async () => {
    await User.create({ name: 'Rep A', email: 'a@x.com', passwordHash: 'x', isSalesRep: true, salesTarget: 10 });
    await User.create({ name: 'Rep B', email: 'b@x.com', passwordHash: 'x', isSalesRep: true });
    await User.create({ name: 'Plain', email: 'c@x.com', passwordHash: 'x' });

    const res = mockRes();
    await listReps({}, res);

    expect(res.body.success).toBe(true);
    expect(res.body.reps).toHaveLength(2);
    expect(res.body.reps.map((r) => r.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  it('isSalesRep helper is the single truth', () => {
    expect(isSalesRep({ isSalesRep: true })).toBe(true);
    expect(isSalesRep({ isSalesRep: false })).toBe(false);
    expect(isSalesRep(null)).toBe(false);
    expect(isSalesRep({})).toBe(false);
  });
});
