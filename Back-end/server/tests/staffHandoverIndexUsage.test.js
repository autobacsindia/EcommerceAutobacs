/**
 * "What they still have" must read one person's rows, not the collection.
 * Measured with explain() across 3,000 rows belonging to many people.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffLesson from '../models/StaffLesson.js';
import StaffTask from '../models/StaffTask.js';
import SalesQuotation from '../models/SalesQuotation.js';

jest.setTimeout(120000);

const people = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());
const stats = (e) => ({ plan: JSON.stringify(e.queryPlanner.winningPlan), docs: e.executionStats.totalDocsExamined });
const seed = (fn) => Array.from({ length: 3000 }, (_, i) => fn(people[i % 300], i));

beforeAll(async () => { await dbHandler.connect(); await Promise.all([StaffLesson.syncIndexes(), StaffTask.syncIndexes(), SalesQuotation.syncIndexes()]); });
beforeEach(async () => {
  await StaffLesson.collection.insertMany(seed((owner, i) => ({ owner, title: `L${i}`, archivedAt: null })));
  await StaffTask.collection.insertMany(seed((user, i) => ({ number: i, assignee: user, assignees: [{ user }], bucket: i % 2 ? 'open' : 'done', rank: `r${i}` })));
  await SalesQuotation.collection.insertMany(seed((salesUser, i) => ({ number: `Q${i}`, salesUser, status: i % 2 ? 'open' : 'accepted' })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const who = people[1];
test.each([
  ['lessons', () => StaffLesson.find({ owner: who, archivedAt: null }).sort({ _id: 1 }).limit(300)],
  ['tasks', () => StaffTask.find({ bucket: 'open', personal: { $ne: true }, $or: [{ 'assignees.user': who }, { assignee: who }] }).sort({ _id: 1 }).limit(300)],
  ['quotations', () => SalesQuotation.find({ salesUser: who, status: 'open' }).sort({ _id: 1 }).limit(300)],
])('%s reads one person', async (name, q) => {
  const s = stats(await q().explain('executionStats'));
  console.log('work', name, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(30);
});
