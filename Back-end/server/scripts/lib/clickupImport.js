/**
 * ClickUp → staff Tasks import: the parts that need no database or network.
 *
 *   fetchSnapshot()  reads a workspace through the ClickUp API v2 into one plain
 *                    object (saved to a file, so the dry run and the real run
 *                    import exactly the same data, and the API is read once)
 *   buildPlan()      turns that snapshot into our projects, lists, statuses,
 *                    tasks, sub-tasks, checklists and comments — and lists every
 *                    ClickUp person with no staff account to match
 *   applyPlan()      writes the plan (scripts/import-clickup.js decides whether)
 *   rollback()       removes everything an import wrote, and nothing else
 *
 * ── How ClickUp maps onto ours ──────────────────────────────────────────────
 *   Folder              → a Project (its lists → the project's lists)
 *   List not in a folder→ a Project of its own
 *   List statuses       → the project's own statuses, by ClickUp's kind:
 *                         open → Not started, custom → Active, done/closed → Done
 *   Task                → a task in that project and list, keeping its title,
 *                         description, priority, start/due dates (+ time), tags,
 *                         time estimate, checklists, and when it was created/closed
 *   Subtask             → a sub-task of the imported parent
 *   Comment             → a comment by the matched person, at its original time
 *                         (an unmatched author's name is kept at the top of the text)
 *   Assignees           → staff matched by email; nobody matched → the --owner,
 *                         with the original names kept in the notes
 *   Attachments         → listed as links in the notes (files are not copied)
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - re-running creates nothing twice: projects and tasks carry importKey
 *     ("clickup:…", unique indexes), comments carry clientId "cu:<id>"
 *   - a task already imported is never changed again (people may have worked on it)
 *   - nothing is sent: no inbox lines, pushes or emails for history
 *   - everything written is findable by those keys, so rollback() removes
 *     exactly the import and nothing else
 */
import { STAFF_TEAM_VALUES } from '../../config/staff.js';

export const SOURCE = 'clickup';
export const TASK_KEY = (id) => `${SOURCE}:${id}`;
export const PROJECT_KEY = (kind, id) => `${SOURCE}:${kind}:${id}`;
export const COMMENT_KEY = (id) => `cu:${id}`;
const IMPORT_KEY_PREFIX = /^clickup:/;
const COMMENT_KEY_PREFIX = /^cu:/;

// Our limits (services/staffTaskService.js, services/staffProjectService.js).
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const COMMENT_MAX = 2000;
const TAG_MAX = 24;
const TAGS_MAX = 10;
const CHECKLIST_MAX = 30;
const CHECK_TEXT_MAX = 200;
const PROJECT_NAME_MAX = 80;
const LIST_NAME_MAX = 60;
const LISTS_MAX = 20;
const STAGE_NAME_MAX = 30;
const STAGES_MAX = 12;
const PEOPLE_MAX = 50;
const ESTIMATE_MAX = 60000;
const NO_DUE = '9999-12-31';
const TIME_MAX = 9_999_999_999_999;

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const clipBlock = (s, n) => {
  const t = String(s ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const ms = (v) => (v == null || v === '' ? null : Number(v));
const IST = 5.5 * 3600000;
/** A ClickUp time (ms since 1970, UTC) as our IST day 'YYYY-MM-DD'. */
export const istDay = (v) => (ms(v) == null || Number.isNaN(ms(v)) ? null : new Date(ms(v) + IST).toISOString().slice(0, 10));
/** …and its IST clock time 'HH:mm'. */
export const istTime = (v) => (ms(v) == null || Number.isNaN(ms(v)) ? null : new Date(ms(v) + IST).toISOString().slice(11, 16));
const dateOf = (v) => (ms(v) == null || Number.isNaN(ms(v)) ? null : new Date(ms(v)));

/** ClickUp's status kind → ours. */
export function stageType(clickupType) {
  const t = String(clickupType || '').toLowerCase();
  if (t === 'closed' || t === 'done') return 'done';
  if (t === 'open') return 'todo';
  return 'in_progress';
}

/** ClickUp priority 1–4 (urgent → low), or none → ours. */
export function priorityOf(p) {
  const id = String(p?.id ?? p?.priority ?? p ?? '').toLowerCase();
  return { 1: 'urgent', urgent: 'urgent', 2: 'high', high: 'high', 3: 'normal', normal: 'normal', 4: 'low', low: 'low' }[id] || 'normal';
}

/** A ClickUp hex colour → the nearest of our named colours, by hue. */
export function colourOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 'gray';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d < 0.12) return 'gray';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 35) return 'orange';
  if (h < 60) return 'amber';
  if (h < 150) return 'green';
  if (h < 190) return 'teal';
  if (h < 250) return 'blue';
  if (h < 290) return 'violet';
  return 'pink';
}

const cleanTag = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().toLowerCase().slice(0, TAG_MAX);
const nameKey = (s) => String(s).toLocaleLowerCase('en-IN');

/**
 * A project's statuses from its ClickUp lists' statuses: each name once, in
 * ClickUp's order, with a "Not started" and a "Done" kind always present.
 */
export function stagesFrom(statusLists) {
  const out = [];
  const seen = new Set();
  const ordered = statusLists.flatMap((list) => [...(list || [])].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0)));
  for (const s of ordered) {
    const name = clip(s.status, STAGE_NAME_MAX);
    if (!name || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({ name: name.replace(/^./, (c) => c.toUpperCase()), colour: colourOf(s.color), type: stageType(s.type), source: nameKey(s.status) });
  }
  if (!out.length) return [];
  // Room for the two kinds every set needs, within our limit.
  const keepTodo = out.find((x) => x.type === 'todo');
  const keepDone = out.find((x) => x.type === 'done');
  let kept = out.slice(0, STAGES_MAX);
  for (const must of [keepTodo, keepDone]) if (must && !kept.includes(must)) kept = [...kept.slice(0, STAGES_MAX - 1), must];
  if (!kept.some((x) => x.type === 'todo')) kept = [{ name: 'To do', colour: 'gray', type: 'todo', source: null }, ...kept].slice(0, STAGES_MAX);
  if (!kept.some((x) => x.type === 'done')) kept = [...kept.slice(0, STAGES_MAX - 1), { name: 'Done', colour: 'green', type: 'done', source: null }];
  return kept;
}

/** The stage a ClickUp task lands in: same name, else the first of its kind. */
export function stageForTask(stages, status) {
  if (!stages.length) return null;
  const want = nameKey(status?.status ?? '');
  const kind = stageType(status?.type);
  return stages.find((x) => x.source === want)
    || stages.find((x) => x.type === kind)
    || (kind === 'in_progress' ? stages.find((x) => x.type === 'todo') : null)
    || stages[0];
}

const peopleOfTask = (t) => (t.assignees || []).map((a) => ({ id: String(a.id), name: a.username || a.email || 'Someone', email: String(a.email || '').toLowerCase() }));

/**
 * Turn a snapshot into what to write. `usersByEmail` maps a lower-case email to
 * a staff/admin user ({ _id, name, staff, role }); `owner` is the user who owns
 * imported projects and gets tasks nobody could be matched to.
 */
export function buildPlan(snapshot, { usersByEmail, owner }) {
  const unmatched = new Map();
  const matchedPeople = new Set();
  const userFor = (person) => {
    if (!person) return null;
    const email = String(person.email || '').toLowerCase();
    const u = email ? usersByEmail.get(email) : null;
    if (u) { matchedPeople.add(String(u._id)); return u; }
    const label = person.username || person.name || person.email || 'Someone';
    const key = email || label || person.id;
    const seen = unmatched.get(key) || { name: label, email, count: 0 };
    seen.count += 1;
    unmatched.set(key, seen);
    return null;
  };

  // Groups: each folder, and each list not in a folder.
  const groups = [];
  for (const space of snapshot.spaces || []) {
    for (const folder of space.folders || []) {
      groups.push({ key: PROJECT_KEY('folder', folder.id), name: folder.name, space: space.name, lists: folder.lists || [], spaceStatuses: space.statuses || [], hasLists: true });
    }
    for (const list of space.lists || []) {
      groups.push({ key: PROJECT_KEY('list', list.id), name: list.name, space: space.name, lists: [list], spaceStatuses: space.statuses || [], hasLists: false });
    }
  }

  const projects = groups.map((g) => {
    const lists = g.hasLists
      ? g.lists.slice(0, LISTS_MAX).map((l) => ({ source: String(l.id), name: clip(l.name, LIST_NAME_MAX) || 'List' }))
      : [];
    // List names are unique per project: a repeated name gets a number.
    const seenNames = new Map();
    for (const l of lists) {
      const k = nameKey(l.name);
      const n = (seenNames.get(k) || 0) + 1;
      seenNames.set(k, n);
      if (n > 1) l.name = clip(`${l.name} ${n}`, LIST_NAME_MAX);
    }
    const stages = stagesFrom(g.lists.map((l) => (l.statuses?.length ? l.statuses : g.spaceStatuses)));
    const people = new Map([[String(owner._id), owner]]);
    const tasks = [];
    for (const list of g.lists) {
      const inList = g.hasLists ? lists.find((l) => l.source === String(list.id)) : null;
      for (const t of list.tasks || []) {
        const who = peopleOfTask(t);
        const matched = who.map((p) => userFor(p)).filter(Boolean);
        const missing = who.filter((p) => !usersByEmail.get(p.email));
        for (const u of matched) if (people.size < PEOPLE_MAX) people.set(String(u._id), u);
        const creator = t.creator ? userFor({ ...t.creator, id: t.creator.id }) : null;
        const dueOn = istDay(t.due_date);
        const timed = t.due_date_time === true || t.due_date_time === 'true';
        let startOn = istDay(t.start_date);
        if (startOn && dueOn && startOn > dueOn) startOn = null;
        const done = stageType(t.status?.type) === 'done';
        const notes = [
          clipBlock(t.text_content || t.description || '', DESCRIPTION_MAX),
          missing.length ? `In ClickUp this was assigned to ${missing.map((p) => p.name).join(', ')}.` : '',
          (t.attachments || []).length
            ? `Files in ClickUp:\n${t.attachments.map((a) => `• ${a.title || 'file'}${a.url ? ` — ${a.url}` : ''}`).join('\n')}`
            : '',
          t.url ? `Imported from ClickUp: ${t.url}` : '',
        ].filter(Boolean).join('\n\n');
        const tags = [...new Set((t.tags || []).map((x) => cleanTag(x.name ?? x)).filter(Boolean))].slice(0, TAGS_MAX);
        const checklist = (t.checklists || [])
          .flatMap((c) => (c.items || []).map((i) => ({ text: clip(i.name, CHECK_TEXT_MAX), done: !!i.resolved })))
          .filter((c) => c.text)
          .slice(0, CHECKLIST_MAX);
        const estimate = ms(t.time_estimate) ? Math.min(ESTIMATE_MAX, Math.max(1, Math.round(ms(t.time_estimate) / 60000))) : null;
        tasks.push({
          key: TASK_KEY(t.id),
          parentKey: t.parent ? TASK_KEY(t.parent) : null,
          title: clip(t.name, TITLE_MAX) || 'Untitled task',
          description: clipBlock(notes, DESCRIPTION_MAX),
          priority: priorityOf(t.priority),
          stage: stageForTask(stages, t.status),
          status: done ? 'done' : stageForTask(stages, t.status)?.type ?? stageType(t.status?.type),
          dueOn,
          dueTime: dueOn && timed ? istTime(t.due_date) : null,
          startOn,
          tags,
          checklist,
          estimateMinutes: estimate,
          people: matched.length ? matched : [owner],
          createdBy: creator || owner,
          createdAt: dateOf(t.date_created) || new Date(),
          updatedAt: dateOf(t.date_updated) || dateOf(t.date_created) || new Date(),
          completedAt: done ? dateOf(t.date_done) || dateOf(t.date_closed) || dateOf(t.date_updated) || new Date() : null,
          listSource: inList?.source ?? null,
          comments: (t.comments || []).map((c) => {
            const author = userFor(c.user);
            const text = clipBlock(c.comment_text || '', COMMENT_MAX);
            return {
              key: COMMENT_KEY(c.id),
              by: author || owner,
              text: author ? text : clipBlock(`${c.user?.username || 'Someone'} (in ClickUp): ${text}`, COMMENT_MAX),
              at: dateOf(c.date) || new Date(),
            };
          }).filter((c) => c.text),
        });
      }
    }
    // Parents before their sub-tasks, so a sub-task can always point at its parent.
    tasks.sort((a, b) => Number(!!a.parentKey) - Number(!!b.parentKey));
    return {
      key: g.key,
      name: clip(g.name, PROJECT_NAME_MAX) || 'Imported project',
      description: `Imported from ClickUp (${g.space}).`,
      lists,
      stages,
      people: [...people.values()],
      tasks,
    };
  });

  return {
    projects,
    unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count),
    counts: {
      projects: projects.length,
      lists: projects.reduce((n, p) => n + p.lists.length, 0),
      tasks: projects.reduce((n, p) => n + p.tasks.length, 0),
      subtasks: projects.reduce((n, p) => n + p.tasks.filter((t) => t.parentKey).length, 0),
      comments: projects.reduce((n, p) => n + p.tasks.reduce((m, t) => m + t.comments.length, 0), 0),
      matchedPeople: matchedPeople.size,
    },
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

const isActive = (u) => u?.role === 'admin' || (u?.role === 'staff' && u.staff?.active === true);
const teamOfUser = (u) => (u?.role === 'staff' && STAFF_TEAM_VALUES.includes(u.staff?.team) ? u.staff.team : null);
const personOf = (u) => ({ user: u._id, name: u.name || '', team: teamOfUser(u) });

function placeOf(status, dueOn, dueTime, completedAt) {
  if (status === 'done') return { bucket: 'done', rank: `d${String(TIME_MAX - new Date(completedAt).getTime()).padStart(13, '0')}` };
  return { bucket: 'open', rank: dueOn ? (dueTime ? `${dueOn} ${dueTime}` : dueOn) : NO_DUE };
}

/**
 * Write `plan`. `models` = { StaffProject, StaffTask, StaffTaskComment, Counter },
 * `reconcile` = staffProjectService.reconcileProjectTasks. Returns what it did.
 * Every write is keyed: a re-run finds what is already there and skips it.
 */
export async function applyPlan(plan, { models, owner, reconcile, log = () => {} }) {
  const { StaffProject, StaffTask, StaffTaskComment, Counter } = models;
  const did = { projectsCreated: 0, projectsReused: 0, tasksCreated: 0, tasksSkipped: 0, commentsCreated: 0, commentsSkipped: 0 };
  for (const p of plan.projects) {
    // ── The project ──
    let project = await StaffProject.findOne({ importKey: p.key }).lean();
    if (!project) {
      const people = p.people.filter(isActive).map(personOf);
      const doc = new StaffProject({
        name: p.name,
        description: p.description,
        colour: 'blue',
        owner: personOf(owner),
        people,
        teams: [...new Set(people.map((x) => x.team).filter(Boolean))],
        lists: p.lists.map((l) => ({ name: l.name })),
        statuses: p.stages.map((s) => ({ name: s.name, colour: s.colour, type: s.type })),
        rank: NO_DUE,
        createdBy: owner._id,
        createdByName: owner.name || '',
        importKey: p.key,
      });
      try {
        project = (await doc.save()).toObject();
        did.projectsCreated += 1;
      } catch (err) {
        // Two runs at once: the unique importKey decided.
        if (err?.code !== 11000) throw err;
        project = await StaffProject.findOne({ importKey: p.key }).lean();
        did.projectsReused += 1;
      }
    } else {
      did.projectsReused += 1;
    }
    const listId = new Map(p.lists.map((l) => [l.source, project.lists.find((x) => nameKey(x.name) === nameKey(l.name))?._id ?? null]));
    const stageId = (s) => (s ? project.statuses.find((x) => nameKey(x.name) === nameKey(s.name)) ?? null : null);

    // ── Its tasks, parents first ──
    const byKey = new Map();
    for (const t of p.tasks) {
      let task = await StaffTask.findOne({ importKey: t.key }).lean();
      if (task) {
        did.tasksSkipped += 1;
      } else {
        const parent = t.parentKey ? byKey.get(t.parentKey) || await StaffTask.findOne({ importKey: t.parentKey }).lean() : null;
        const stage = stageId(t.stage);
        const status = stage ? stage.type : t.status;
        const people = t.people.filter(isActive).map(personOf);
        const assigned = people.length ? people : [personOf(owner)];
        const number = await Counter.next('staffTask');
        const doc = new StaffTask({
          number,
          title: t.title,
          description: t.description,
          status,
          priority: t.priority,
          dueOn: t.dueOn,
          dueTime: t.dueTime,
          startOn: t.startOn,
          ...(t.tags.length ? { tags: t.tags } : {}),
          assignee: assigned[0].user,
          assigneeName: assigned[0].name,
          team: assigned[0].team,
          assignees: assigned,
          teams: [...new Set(assigned.map((x) => x.team).filter(Boolean))],
          createdBy: isActive(t.createdBy) ? t.createdBy._id : owner._id,
          createdByName: (isActive(t.createdBy) ? t.createdBy : owner).name || '',
          checklist: t.checklist,
          ...(t.estimateMinutes ? { estimateMinutes: t.estimateMinutes } : {}),
          ...(parent && !parent.parent ? { parent: { task: parent._id, number: parent.number, title: parent.title } } : {}),
          project: project._id,
          ...(t.listSource && listId.get(t.listSource) ? { projectList: listId.get(t.listSource) } : {}),
          ...(stage ? { stage: stage._id, stageName: stage.name } : {}),
          completedAt: status === 'done' ? t.completedAt : null,
          ...placeOf(status, t.dueOn, t.dueTime, t.completedAt),
          importKey: t.key,
          history: [{ at: t.createdAt, by: owner._id, byName: owner.name || '', action: 'created', to: 'imported from ClickUp' }],
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
        try {
          task = (await doc.save({ timestamps: false })).toObject();
          did.tasksCreated += 1;
        } catch (err) {
          if (err?.code !== 11000) throw err;
          task = await StaffTask.findOne({ importKey: t.key }).lean();
          did.tasksSkipped += 1;
        }
      }
      byKey.set(t.key, task);

      // ── Its comments (also for a task imported before: a run that stopped half-way) ──
      let added = 0;
      for (const c of t.comments) {
        if (await StaffTaskComment.exists({ task: task._id, clientId: c.key })) { did.commentsSkipped += 1; continue; }
        try {
          await new StaffTaskComment({
            task: task._id, by: c.by._id, byName: c.by.name || '', text: c.text, clientId: c.key, createdAt: c.at, updatedAt: c.at,
          }).save({ timestamps: false });
          added += 1;
        } catch (err) {
          if (err?.code !== 11000) throw err;
          did.commentsSkipped += 1;
        }
      }
      did.commentsCreated += added;
      if (added) {
        const [count, last] = await Promise.all([
          StaffTaskComment.countDocuments({ task: task._id, deletedAt: null }),
          StaffTaskComment.findOne({ task: task._id, deletedAt: null }).sort({ createdAt: -1 }).select('createdAt').lean(),
        ]);
        await StaffTask.updateOne({ _id: task._id }, { $set: { commentCount: count, lastCommentAt: last?.createdAt ?? null } }, { timestamps: false });
      }
    }

    // ── Sub-task counts, and every task on a list/status the project has ──
    const parents = [...new Set(p.tasks.filter((t) => t.parentKey).map((t) => t.parentKey))];
    for (const key of parents) {
      const parent = byKey.get(key);
      if (!parent) continue;
      const rows = await StaffTask.find({ 'parent.task': parent._id, bucket: { $in: ['open', 'done'] } }).select('bucket').lean();
      await StaffTask.updateOne(
        { _id: parent._id },
        { $set: { subtasks: { total: rows.length, done: rows.filter((r) => r.bucket === 'done').length } } },
        { timestamps: false },
      );
    }
    await reconcile(await StaffProject.findById(project._id).lean());
    log(`  ${p.name}: ${p.tasks.length} task(s)`);
  }
  return did;
}

/** Everything an import wrote: its projects, tasks and the comments on them — counted, or removed with `apply`. */
export async function rollback({ models, apply }) {
  const { StaffProject, StaffTask, StaffTaskComment } = models;
  const taskIds = (await StaffTask.find({ importKey: { $type: 'string', $regex: IMPORT_KEY_PREFIX } }).select('_id').lean()).map((t) => t._id);
  const projectFilter = { importKey: { $type: 'string', $regex: IMPORT_KEY_PREFIX } };
  // Comments on imported tasks: the imported ones, and any written on them since (they go with their task).
  const commentFilter = { task: { $in: taskIds } };
  const counts = {
    tasks: taskIds.length,
    projects: await StaffProject.countDocuments(projectFilter),
    comments: await StaffTaskComment.countDocuments(commentFilter),
    importedComments: await StaffTaskComment.countDocuments({ ...commentFilter, clientId: { $type: 'string', $regex: COMMENT_KEY_PREFIX } }),
    // Tasks made by hand since, filed in an imported project: kept, and taken out of the project.
    otherTasksInProjects: await StaffTask.countDocuments({
      project: { $in: (await StaffProject.find(projectFilter).select('_id').lean()).map((x) => x._id) },
      _id: { $nin: taskIds },
    }),
  };
  if (apply) {
    const projectIds = (await StaffProject.find(projectFilter).select('_id').lean()).map((x) => x._id);
    await StaffTaskComment.deleteMany(commentFilter);
    await StaffTask.deleteMany({ _id: { $in: taskIds } });
    await StaffTask.updateMany({ project: { $in: projectIds } }, { $unset: { project: 1, projectList: 1, stage: 1, stageName: 1 }, $inc: { rev: 1 } });
    await StaffProject.deleteMany({ _id: { $in: projectIds } });
  }
  return counts;
}

// ── Reading ClickUp ─────────────────────────────────────────────────────────

const API = 'https://api.clickup.com/api/v2';
const sleep = (n) => new Promise((r) => setTimeout(r, n));

/**
 * A small ClickUp API v2 client: the token in the Authorization header only
 * (never in a URL or a log line), paced under the 100-requests-a-minute limit,
 * waiting and retrying on 429 and 5xx.
 */
export function clickupClient(token, { fetchImpl = fetch, paceMs = 650, log = () => {} } = {}) {
  if (!token) throw new Error('CLICKUP_API_TOKEN is not set.');
  let last = 0;
  return async function get(path, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    const url = `${API}${path}${qs.toString() ? `?${qs}` : ''}`;
    for (let attempt = 1; ; attempt += 1) {
      const wait = last + paceMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(url, { headers: { Authorization: token, Accept: 'application/json' } });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        const afterRaw = res.headers?.get?.('retry-after');
        const after = afterRaw != null && afterRaw !== '' && Number.isFinite(Number(afterRaw)) ? Number(afterRaw) : null;
        const reset = Number(res.headers?.get?.('x-ratelimit-reset')) || 0;
        const pause = after != null ? after * 1000 : reset ? Math.max(1000, reset * 1000 - Date.now()) : 2000 * attempt;
        log(`  ClickUp said ${res.status}; waiting ${Math.round(pause / 1000)}s and trying again.`);
        await sleep(Math.min(pause, 65000));
        continue;
      }
      if (res.status === 401) throw new Error('ClickUp refused the token (401). Check CLICKUP_API_TOKEN.');
      throw new Error(`ClickUp ${res.status} for ${path}`);
    }
  };
}

/** Every page of a list's tasks (100 a page), closed ones and subtasks included. */
async function tasksOf(get, listId) {
  const out = [];
  for (let page = 0; page < 1000; page += 1) {
    const r = await get(`/list/${listId}/task`, { page, include_closed: true, subtasks: true, archived: false });
    out.push(...(r.tasks || []));
    if (r.last_page !== false || !(r.tasks || []).length) break;
  }
  return out;
}

/** Every comment on a task, oldest first (ClickUp pages them newest first, 25 at a time). */
async function commentsOf(get, taskId) {
  const out = [];
  let params = {};
  for (let i = 0; i < 400; i += 1) {
    const r = await get(`/task/${taskId}/comment`, params);
    const rows = r.comments || [];
    out.push(...rows);
    if (rows.length < 25) break;
    const oldest = rows[rows.length - 1];
    params = { start: oldest.date, start_id: oldest.id };
  }
  return out.reverse();
}

/** The whole workspace as one plain object: what buildPlan reads. */
export async function fetchSnapshot(get, { workspaceId, log = () => {} }) {
  const teams = (await get('/team')).teams || [];
  const team = workspaceId ? teams.find((t) => String(t.id) === String(workspaceId)) : teams.length === 1 ? teams[0] : null;
  if (!team) {
    throw new Error(`Pick the workspace with --workspace=<id>. This token sees: ${teams.map((t) => `${t.id} (${t.name})`).join(', ') || 'none'}.`);
  }
  const snapshot = {
    source: 'clickup-api-v2',
    fetchedAt: new Date().toISOString(),
    workspace: { id: String(team.id), name: team.name },
    members: (team.members || []).map((m) => ({ id: String(m.user?.id), username: m.user?.username || '', email: String(m.user?.email || '').toLowerCase() })),
    spaces: [],
  };
  const withTasks = async (list) => {
    const tasks = await tasksOf(get, list.id);
    for (const t of tasks) t.comments = await commentsOf(get, t.id);
    log(`    ${list.name}: ${tasks.length} task(s)`);
    return { id: String(list.id), name: list.name, statuses: list.statuses || [], tasks };
  };
  for (const space of (await get(`/team/${team.id}/space`, { archived: false })).spaces || []) {
    log(`  Space ${space.name}`);
    const s = { id: String(space.id), name: space.name, statuses: space.statuses || [], folders: [], lists: [] };
    for (const folder of (await get(`/space/${space.id}/folder`, { archived: false })).folders || []) {
      const lists = [];
      for (const list of folder.lists || []) lists.push(await withTasks(list));
      s.folders.push({ id: String(folder.id), name: folder.name, lists });
    }
    for (const list of (await get(`/space/${space.id}/list`, { archived: false })).lists || []) s.lists.push(await withTasks(list));
    snapshot.spaces.push(s);
  }
  return snapshot;
}

