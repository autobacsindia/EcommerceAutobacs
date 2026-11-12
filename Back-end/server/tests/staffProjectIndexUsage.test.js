/**
 * Project index usage — a project's task list, its progress counts, the
 * Projects page and the per-request access read must each be index ranges,
 * never a collection scan. Measured with explain() on a realistic spread.
 *
 * Why this is pinned: staff_task_project was first written PARTIAL. The planner
 * then skipped it for staff_task_all (every open task); restating `$type` made
 * it use the index but sort the whole project in memory. A plain index is what
 * these tests hold it to. The access read runs on EVERY tasks request.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffTask from '../models/StaffTask.js';
import StaffProject from '../models/StaffProject.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';

jest.setTimeout(120000);

const planOf = (explain) => JSON.stringify(explain.queryPlanner?.winningPlan ?? explain.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ?? explain);
const indexesIn = (explain) => [...new Set([...planOf(explain).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const scans = (explain) => planOf(explain).includes('COLLSCAN');
const exec = (explain) => explain.executionStats ?? explain.stages?.[0]?.$cursor?.executionStats;

const PROJECTS = 300;
const TASKS = 6000;
const IN_PROJECTS = 5;
const PER_PROJECT = 200;
const people = Array.from({ length: 60 }, () => new mongoose.Types.ObjectId());
const projectIds = Array.from({ length: PROJECTS }, () => new mongoose.Types.ObjectId());
const teams = ['sales', 'procurement', 'marketing', 'developer'];
const ymd = (offset) => new Date(Date.UTC(2026, 9, 27 + offset)).toISOString().slice(0, 10);

beforeAll(async () => {
  await dbHandler.connect();
  await StaffTask.syncIndexes();
  await StaffProject.syncIndexes();
});

beforeEach(async () => {
  const projects = projectIds.map((_id, i) => ({
    _id, name: `P${i}`, owner: { user: people[i % 60], name: '' },
    people: [0, 1, 2].map((k) => ({ user: people[(i + k * 7) % 60], name: '', team: teams[(i + k) % 4] })),
    teams: [teams[i % 4], teams[(i + 1) % 4]],
    rank: i % 10 === 0 ? '9999-12-31' : ymd(i % 90), archivedAt: i % 15 === 0 ? new Date() : null, createdBy: people[i % 60],
  }));
  await StaffProject.collection.insertMany(projects);
  const docs = [];
  for (let n = 1; n <= TASKS; n += 1) {
    const done = n % 3 === 0;
    const project = n <= IN_PROJECTS * PER_PROJECT ? projectIds[(n - 1) % IN_PROJECTS] : undefined;
    docs.push({
      number: n, title: `t${n}`, assignee: people[n % 60], team: teams[n % 4], assignees: [{ user: people[n % 60], name: '' }],
      teams: [teams[n % 4]], createdBy: people[(n + 1) % 60], status: done ? 'done' : 'todo', priority: 'normal',
      bucket: done ? 'done' : 'open', rank: done ? `d${String(n).padStart(13, '0')}` : ymd((n % 40) - 20),
      ...(project ? { project } : {}), checklist: [], files: [], history: [], rev: 1,
    });
  }
  await StaffTask.collection.insertMany(docs);
});

describe('a project\'s tasks', () => {

  it('one page of a project\'s open tasks is one range of staff_task_project', async () => {
    const query = { bucket: 'open', project: projectIds[0], personal: { $ne: true } };
    const explain = await StaffTask.find(query).sort({ rank: 1, _id: 1 }).limit(51).explain('executionStats');
    expect(scans(explain)).toBe(false);
    expect(indexesIn(explain)).toEqual(['staff_task_project']);
    // Only that project's open rows are read: about 51, not thousands.
    expect(exec(explain).totalKeysExamined).toBeLessThanOrEqual(52);
    // No in-memory sort: the index gives the order.
    expect(planOf(explain)).not.toContain('"stage":"SORT"');
    const rows = await staffTaskRepository.page(query, { limit: 51 });
    expect(rows).toHaveLength(51);
  });

  it('the progress counts for a page of projects read only their tasks', async () => {
    const ids = projectIds.slice(0, 20);
    const explain = await StaffTask.collection.aggregate([
      { $match: { project: { $in: ids }, personal: { $ne: true } } },
      { $group: { _id: '$project', n: { $sum: 1 } } },
    ]).explain('executionStats');
    expect(scans(explain)).toBe(false);
    expect(indexesIn(explain)).toEqual(['staff_task_project']);
    // Only the page's projects' tasks are read: 1000 here, not the 6000 in the collection.
    expect(exec(explain)?.totalKeysExamined ?? 0).toBeLessThanOrEqual(IN_PROJECTS * PER_PROJECT + 20);
    const counts = await staffProjectRepository.taskCounts(ids, ymd(0));
    expect(counts.reduce((a, c) => a + c.total, 0)).toBe(IN_PROJECTS * PER_PROJECT);
  });
});

describe('projects', () => {
  it('the per-request access read is index ranges only, for a member and for a head', async () => {
    for (const q of [{ $or: [{ 'people.user': people[3] }] }, { $or: [{ 'people.user': people[3] }, { teams: 'sales' }] }]) {
      const explain = await StaffProject.find({ ...q, archivedAt: null }).select('_id').limit(500).explain('executionStats');
      expect(scans(explain)).toBe(false);
      expect(indexesIn(explain).every((x) => ['staff_project_people', 'staff_project_teams'].includes(x))).toBe(true);
    }
  });

  it('the Projects page (the admin\'s, and a head\'s) reads one page of keys, soonest deadline first', async () => {
    const admin = await StaffProject.find({ archivedAt: null }).sort({ rank: 1, _id: 1 }).limit(21).explain('executionStats');
    expect(scans(admin)).toBe(false);
    expect(indexesIn(admin)).toEqual(['staff_project_all']);
    expect(exec(admin).totalKeysExamined).toBeLessThanOrEqual(22);

    const head = await StaffProject.find({ archivedAt: null, $or: [{ 'people.user': people[3] }, { teams: 'sales' }] })
      .sort({ rank: 1, _id: 1 }).limit(21).explain('executionStats');
    expect(scans(head)).toBe(false);
  });
});
