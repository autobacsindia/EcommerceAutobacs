/**
 * Import a ClickUp workspace into the staff Tasks module — projects, their
 * lists and statuses, tasks, sub-tasks, checklists and comments.
 * How things map, and what must hold: scripts/lib/clickupImport.js.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default: prints the plan and every unmatched person, writes nothing.
 *     Needs --apply to write.
 *   • Idempotent: projects and tasks are keyed on the ClickUp id (importKey,
 *     unique), comments on "cu:<comment id>". A second run creates nothing and
 *     never changes a task already imported.
 *   • Sends nothing: no inbox lines, pushes or emails for old history.
 *   • The token is read from CLICKUP_API_TOKEN only — never an argument, never
 *     printed. Put it in Back-end/server/.env (local) or Railway (production).
 *   • Connects with { autoIndex: false } (models are imported).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *
 *   # 1. Read ClickUp once into a file (no database involved):
 *   node --import=dotenv/config scripts/import-clickup.js --fetch --out=clickup-snapshot.json [--workspace=<id>]
 *
 *   # 2. Dry run against a database: the plan, the counts, who could not be matched.
 *   node --import=dotenv/config scripts/import-clickup.js --from=clickup-snapshot.json --owner=<admin or head's email>
 *
 *   # 3. Write it:
 *   node --import=dotenv/config scripts/import-clickup.js --from=clickup-snapshot.json --owner=<email> --apply
 *
 *   # Production: the same through Railway, after the owner's OK —
 *   railway run node scripts/import-clickup.js --from=clickup-snapshot.json --owner=<email>          (dry run)
 *   railway run node scripts/import-clickup.js --from=clickup-snapshot.json --owner=<email> --apply
 *
 * ── Rollback ─────────────────────────────────────────────────────────────────
 *   node --import=dotenv/config scripts/import-clickup.js --rollback            (counts what would go)
 *   node --import=dotenv/config scripts/import-clickup.js --rollback --apply    (removes it)
 * Removes every imported project and task, and the comments on those tasks.
 * A task someone made by hand inside an imported project is kept and taken out
 * of the project. Nothing else is touched. Task numbers used are not reused.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import StaffProject from '../models/StaffProject.js';
import StaffTask from '../models/StaffTask.js';
import StaffTaskComment from '../models/StaffTaskComment.js';
import Counter from '../models/Counter.js';
import { reconcileProjectTasks } from '../services/staffProjectService.js';
import { applyPlan, buildPlan, clickupClient, fetchSnapshot, rollback } from './lib/clickupImport.js';

const ARGV = process.argv.slice(2);
const has = (flag) => ARGV.includes(flag);
const val = (name) => ARGV.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const APPLY = has('--apply');
const models = { StaffProject, StaffTask, StaffTaskComment, Counter };

function rule(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`); }

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is not set.');
  // autoIndex off: importing models must never build indexes on the cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(` database: ${mongoose.connection.name}   host: ${mongoose.connection.host}`);
}

async function doFetch() {
  const out = val('--out') || 'clickup-snapshot.json';
  if (existsSync(out) && !has('--overwrite')) throw new Error(`${out} already exists. Pass --overwrite to replace it.`);
  const get = clickupClient(process.env.CLICKUP_API_TOKEN, { log: console.log });
  rule('Reading ClickUp');
  const snapshot = await fetchSnapshot(get, { workspaceId: val('--workspace'), log: console.log });
  writeFileSync(out, JSON.stringify(snapshot, null, 1));
  const lists = snapshot.spaces.flatMap((s) => [...s.lists, ...s.folders.flatMap((f) => f.lists)]);
  console.log(`\n Saved ${out}: ${snapshot.spaces.length} space(s), ${lists.length} list(s), ${lists.reduce((n, l) => n + l.tasks.length, 0)} task(s).`);
  console.log(' This file holds your ClickUp data. Keep it private, and delete it once the import is done.');
}

async function doImport() {
  const from = val('--from');
  if (!from) throw new Error('Pass --from=<snapshot file> (make one with --fetch).');
  const ownerEmail = String(val('--owner') || '').toLowerCase();
  if (!ownerEmail) throw new Error('Pass --owner=<email>: the admin or team head who will own the imported projects.');
  const snapshot = JSON.parse(readFileSync(from, 'utf8'));
  await connect();
  // Everyone in the staff panel, matched by email.
  const staff = await User.find({ $or: [{ role: 'admin' }, { role: 'staff', 'staff.active': true }] }).select('name email role staff').lean();
  const usersByEmail = new Map(staff.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const owner = usersByEmail.get(ownerEmail);
  if (!owner || !(owner.role === 'admin' || owner.staff?.isHead)) throw new Error(`--owner must be the admin or a team head in this database (${ownerEmail} is not).`);

  const plan = buildPlan(snapshot, { usersByEmail, owner });
  rule(`Plan — ${snapshot.workspace?.name || 'ClickUp'} (read ${snapshot.fetchedAt || '?'})`);
  for (const p of plan.projects) {
    console.log(`  ${p.name}  —  ${p.tasks.length} task(s), lists: ${p.lists.map((l) => l.name).join(', ') || 'none'}`);
    console.log(`      statuses: ${p.stages.map((s) => `${s.name} (${s.type})`).join(', ') || 'the usual three'}`);
  }
  const c = plan.counts;
  console.log(`\n  ${c.projects} project(s), ${c.lists} list(s), ${c.tasks} task(s) of which ${c.subtasks} sub-task(s), ${c.comments} comment(s).`);
  console.log(`  ${c.matchedPeople} ClickUp person(s) matched to staff by email.`);
  rule('Not matched (their tasks go to the owner; their names are kept)');
  if (!plan.unmatched.length) console.log('  Everyone matched.');
  for (const u of plan.unmatched) console.log(`  ${u.name}${u.email ? ` <${u.email}>` : ''} — seen ${u.count} time(s)`);

  if (!APPLY) {
    rule('Dry run');
    console.log('  Nothing was written. Add --apply to import. Re-running later creates nothing twice.');
    return;
  }
  rule('Writing');
  const did = await applyPlan(plan, { models, owner, reconcile: reconcileProjectTasks, log: console.log });
  rule('Done');
  console.log(`  Projects: ${did.projectsCreated} created, ${did.projectsReused} already there.`);
  console.log(`  Tasks:    ${did.tasksCreated} created, ${did.tasksSkipped} already imported (left as they are).`);
  console.log(`  Comments: ${did.commentsCreated} added, ${did.commentsSkipped} already there.`);
  console.log('\n  To undo: node scripts/import-clickup.js --rollback --apply   (same database)');
}

async function doRollback() {
  await connect();
  const counts = await rollback({ models, apply: APPLY });
  rule(APPLY ? 'Rolled back' : 'Rollback — dry run');
  console.log(`  ${counts.projects} imported project(s), ${counts.tasks} imported task(s), ${counts.comments} comment(s) on them (${counts.importedComments} from ClickUp).`);
  console.log(`  ${counts.otherTasksInProjects} task(s) made by hand in those projects ${APPLY ? 'were kept and' : 'would be kept and'} taken out of the project.`);
  if (!APPLY) console.log('  Nothing was removed. Add --apply to remove it.');
}

async function main() {
  console.log(`ClickUp import — ${APPLY ? 'APPLY (writes)' : 'dry run'}`);
  if (has('--fetch')) return doFetch();
  if (has('--rollback')) return doRollback();
  return doImport();
}

main()
  .then(async () => { await mongoose.disconnect(); })
  .catch(async (err) => {
    console.error(`\nStopped: ${err.message}`);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
