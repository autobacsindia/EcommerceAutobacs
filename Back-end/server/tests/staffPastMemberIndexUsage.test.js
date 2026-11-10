/**
 * Past members must read one team's or one person's rows, never a whole collection.
 * Measured with explain() on the repository's own queries, across thousands of
 * rows belonging to many people (users: mostly shoppers, as in production).
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import StaffLesson from '../models/StaffLesson.js';
import StaffTask from '../models/StaffTask.js';
import SalesQuotation from '../models/SalesQuotation.js';
import StaffDeparture from '../models/StaffDeparture.js';
import StaffHandoverMove from '../models/StaffHandoverMove.js';
import { StaffTrainingAssignment } from '../models/StaffTraining.js';
import repo from '../repositories/staffPastMemberRepository.js';

jest.setTimeout(120000);

const TEAMS = ['sales', 'procurement', 'accounts', 'marketing', 'operations', 'developer'];
const people = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());
const who = people[1];
const N = 3000;
const seed = (fn) => Array.from({ length: N }, (_, i) => fn(people[i % 300], i));
const stats = (e) => {
  const ex = e.executionStats || e.stages?.[0]?.$cursor?.executionStats || e[0]?.executionStats;
  const qp = e.queryPlanner || e.stages?.[0]?.$cursor?.queryPlanner || e[0]?.queryPlanner;
  return { plan: JSON.stringify(qp?.winningPlan), docs: ex?.totalDocsExamined, keys: ex?.totalKeysExamined };
};

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([User, Order, Lead, StaffLesson, StaffTask, SalesQuotation, StaffDeparture, StaffHandoverMove, StaffTrainingAssignment].map((m) => m.syncIndexes()));
});
beforeEach(async () => {
  // 6,000 shoppers with no staff record, 300 people who were ever staff, half gone.
  await User.collection.insertMany(Array.from({ length: 6000 }, (_, i) => ({ email: `c${i}@x.test`, role: 'customer' })));
  await User.collection.insertMany(people.map((_id, i) => ({
    _id, email: `s${i}@x.test`, role: i % 2 ? 'customer' : 'staff',
    staff: { team: TEAMS[i % 6], active: i % 2 === 0, addedAt: new Date(2026, 0, 1), deactivatedAt: i % 2 ? new Date(2026, 1, 1 + (i % 28)) : null },
  })));
  await Order.collection.insertMany(Array.from({ length: 6000 }, (_, i) => ({ salesUser: i % 2 ? people[i % 300] : null, status: 'delivered', paymentStatus: 'paid', totalAmount: i, createdAt: new Date(Date.now() - i * 60000) })));
  await StaffTask.collection.insertMany(seed((user, i) => ({ number: i, assignee: user, assignees: [{ user }], teams: [TEAMS[i % 6]], bucket: Math.floor(i / 300) % 2 ? 'open' : 'done', rank: `d${String(i).padStart(6, '0')}` })));
  await StaffLesson.collection.insertMany(seed((createdBy, i) => ({ owner: createdBy, createdBy, title: `L${i}`, audience: 'company', archivedAt: null })));
  await SalesQuotation.collection.insertMany(seed((salesUser, i) => ({ number: `Q${i}`, salesUser, status: i % 2 ? 'open' : 'accepted' })));
  await StaffTrainingAssignment.collection.insertMany(seed((user, i) => ({ user, path: new mongoose.Types.ObjectId(), pathTitle: `P${i}`, team: 'sales', status: 'learning' })));
  const deps = await StaffDeparture.collection.insertMany(people.map((user, i) => ({ user, team: TEAMS[i % 6], wasHead: false, lastDay: '2026-02-01', status: i % 2 ? 'left' : 'cancelled' })));
  await StaffHandoverMove.collection.insertMany(seed((_u, i) => ({ departure: deps.insertedIds[i % 300], kind: 'task', ref: new mongoose.Types.ObjectId(), to: who, state: 'moved', at: new Date() })));
  const rep = new mongoose.Types.ObjectId();
  await Lead.collection.insertMany(seed((_u, i) => ({ name: `L${i}`, identityKey: `k${i}`, assignedRep: i % 300 === 1 ? rep : new mongoose.Types.ObjectId(), status: 'won' })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const one = (row) => row;
test.each([
  ['list, one team', () => repo.page('sales', null, 25), 60],
  ['list, all teams (admin)', () => repo.page(null, null, 25), 60],
  ['list, next page', () => repo.page('sales', { at: new Date(2026, 1, 10), id: people[150] }, 25), 60],
  ['profile', () => repo.findMember(who), 1],
  // One team's resignations, not everyone's: a few dozen rows in practice, so no index of its own.
  ['last resignation', () => repo.lastDeparture(who, 'procurement'), 60],
  ['work passed on', () => repo.moves(new mongoose.Types.ObjectId(), 200), 10],
  ['finished tasks', () => StaffTask.find(repo.doneTaskFilter(who, 'procurement')), 10],
  ['task page', () => repo.taskPage(repo.doneTaskFilter(who, null), null, 21), 21],
  ['training', () => repo.trainings(who, 50), 10],
  ['lessons', () => repo.lessons(who, ['company', 'sales'], 50), 10],
  ['order page', () => repo.orderPage(who, null, 21), 21],
])('%s reads few rows', async (name, q, max) => {
  const s = stats(await one(q()).explain('executionStats'));
  console.log('past-members', name, s.docs, s.keys);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(max);
});

test.each([
  ['order totals', () => repo.orderTotals(who), 25],
  ['quotation totals', () => repo.quotationTotals(who), 15],
])('%s reads one person', async (name, q, max) => {
  const s = stats(await q().explain('executionStats'));
  console.log('past-members', name, s.docs, s.keys);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(max);
});
