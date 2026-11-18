/**
 * Job templates: save a project's shape, start the next project from it.
 *
 *   save     the project's owner or the admin — its columns, lists and
 *            top-level tasks (title, notes, priority, checklist unticked, tags,
 *            list, column, and due date as days after the project's start).
 *            No people, comments, time, files, job details or money.
 *   use      whoever may start a project (admin, team heads): createProject
 *            with the template's columns and lists, then one task per template
 *            task, given to the project's owner.
 *   delete   the admin or whoever saved it.
 *
 * Retries are safe. The project is keyed by the browser's clientId (as any
 * new project), and each of its tasks by `<clientId>-t<n>`, so a double click
 * or a dropped connection gives one project with one set of tasks — and a
 * retry after a crash half-way adds only the tasks still missing.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffJobTemplateRepository from '../repositories/staffJobTemplateRepository.js';
import {
  canCreateProject, canManageProject, createProject, loadVisibleProject, PROJECT_COLOURS, PROJECT_NAME_MAX, projectCode,
} from './staffProjectService.js';
import { createTask, todayIST } from './staffTaskService.js';
import { addDays, getTaskRules } from './taskDueRules.js';
import { formatIsoDateIST } from '../utils/datetime.js';

export const JOB_TEMPLATES_MAX = 50;
export const JOB_TEMPLATE_TASKS_MAX = 100;
const OFFSET_MAX = 365;

const fail = (message, status) => new AppError(message, status);
const idOf = (v) => String(v?._id ?? v ?? '');
const same = (a, b) => !!a && !!b && idOf(a) === idOf(b);
const isAdmin = (u) => u?.role === 'admin';
const DAY_MS = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
// 58, not 64: each task's key adds "-t<n>" (up to 4 more) and must still be a valid task clientId.
const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,58}$/.test(raw) ? raw : undefined);

function cleanName(raw) {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) throw fail('Give the template a name, like “Fitting job”.', 400);
  if (name.length > PROJECT_NAME_MAX) throw fail(`Keep the name under ${PROJECT_NAME_MAX} characters.`, 400);
  return name;
}
const keyOf = (name) => name.toLocaleLowerCase('en-IN');

const shapeSummary = (t, viewer) => ({
  id: idOf(t._id),
  name: t.name,
  colour: PROJECT_COLOURS.includes(t.colour) ? t.colour : 'blue',
  columns: (t.statuses || []).map((x) => x.name),
  lists: (t.lists || []).map((x) => x.name),
  taskCount: (t.tasks || []).length,
  tasks: (t.tasks || []).slice(0, 8).map((x) => x.title),
  fromProject: t.fromProject || '',
  createdByName: t.createdByName || '',
  can: { delete: isAdmin(viewer) || same(t.createdBy, viewer?._id) },
});

/** The templates, for the New project form (who may start a project). */
export async function listJobTemplates(actor) {
  if (!canCreateProject(actor)) return { templates: [] };
  const rows = await staffJobTemplateRepository.listSummaries(JOB_TEMPLATES_MAX);
  return { templates: rows.map((t) => shapeSummary(t, actor)) };
}

/** Save a project as a template. Its owner or the admin; one template per name. */
export async function saveJobTemplate(actor, projectId, input = {}, req) {
  const p = await loadVisibleProject(actor, projectId);
  if (!canManageProject(actor, p)) throw fail('Only the project owner or the admin can save it as a template.', 403);
  const name = cleanName(input.name);
  if ((await staffJobTemplateRepository.count()) >= JOB_TEMPLATES_MAX) {
    throw fail(`There are already ${JOB_TEMPLATES_MAX} templates. Delete one you no longer use first.`, 409);
  }
  const rows = await staffJobTemplateRepository.projectTasks(p._id, JOB_TEMPLATE_TASKS_MAX + 1);
  if (rows.length > JOB_TEMPLATE_TASKS_MAX) {
    throw fail(`A template can hold at most ${JOB_TEMPLATE_TASKS_MAX} tasks; this project has more.`, 400);
  }
  // Due dates are kept as days after the start: the project's start, else the day it was made.
  const base = p.startOn || formatIsoDateIST(p.createdAt || new Date());
  const listAt = new Map((p.lists || []).map((l, i) => [idOf(l._id), i]));
  const stages = p.statuses || [];
  const stageAt = new Map(stages.map((s, i) => [idOf(s._id), i]));
  const tasks = rows.map((t) => {
    const at = t.stage != null ? stageAt.get(idOf(t.stage)) : undefined;
    return {
      title: t.title,
      description: t.description || '',
      priority: t.priority || 'normal',
      dueAfterDays: t.dueOn ? Math.min(OFFSET_MAX, Math.max(0, daysBetween(base, t.dueOn))) : 0,
      listIndex: t.projectList != null ? listAt.get(idOf(t.projectList)) ?? null : null,
      // A new project's tasks start open: a task in a Done column starts in the first not-started one.
      stageIndex: at != null && stages[at].type !== 'done' ? at : null,
      checklist: (t.checklist || []).map((c) => c.text).filter(Boolean),
      tags: t.tags || [],
    };
  });
  let doc;
  try {
    doc = await staffJobTemplateRepository.create({
      name,
      nameKey: keyOf(name),
      colour: p.colour || 'blue',
      description: p.description || '',
      lists: (p.lists || []).map((l) => ({ name: l.name })),
      statuses: stages.map((s) => ({ name: s.name, colour: s.colour || 'gray', type: s.type })),
      tasks,
      fromProject: projectCode(p.number) || p.name,
      createdBy: actor._id,
      createdByName: actor.name || '',
    });
  } catch (err) {
    if (err?.code === 11000) throw fail(`There is already a template called “${name}”. Pick another name.`, 409);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'StaffJobTemplate', doc._id, { name, fromProject: idOf(p._id), tasks: tasks.length });
  return shapeSummary(doc, actor);
}

/** Delete a template: the admin or whoever saved it. Projects made from it keep everything. */
export async function deleteJobTemplate(actor, id, req) {
  if (!mongoose.isValidObjectId(id)) throw fail('That template no longer exists.', 404);
  const t = await staffJobTemplateRepository.findById(id);
  if (!t || !canCreateProject(actor)) throw fail('That template no longer exists.', 404);
  if (!(isAdmin(actor) || same(t.createdBy, actor._id))) throw fail('Only the admin or whoever saved this template can delete it.', 403);
  await staffJobTemplateRepository.deleteById(t._id);
  auditLogger.logAction(req, 'DELETE', 'StaffJobTemplate', t._id, { name: t.name });
  return { deleted: true };
}

/**
 * Start a project from a template: its columns and lists, then its tasks for
 * the project's owner, due `dueAfterDays` after the start (never before today,
 * never past what the task's priority allows — those are moved earlier and
 * counted). The browser's clientId is required: it is what makes a retry safe.
 */
export async function createProjectFromTemplate(actor, input = {}, req) {
  if (!canCreateProject(actor)) throw fail('Only the admin and team heads can start a project.', 403);
  if (!mongoose.isValidObjectId(input.templateId)) throw fail('That template no longer exists.', 400);
  const clientId = cleanClientId(input.clientId);
  if (!clientId) throw fail('Reload the page and try again.', 400);
  const template = await staffJobTemplateRepository.findById(input.templateId);
  if (!template) throw fail('That template no longer exists. Pick another, or start blank.', 400);

  const { templateId: _ignored, ...rest } = input;
  const { project, duplicate } = await createProject(actor, {
    ...rest,
    clientId,
    lists: template.lists.map((l) => ({ name: l.name })),
    statuses: template.statuses.map((s) => ({ name: s.name, colour: s.colour, type: s.type })),
  }, req);

  const today = todayIST();
  const base = project.startOn && project.startOn > today ? project.startOn : today;
  const rules = await getTaskRules();
  let movedEarlier = 0;
  const failed = [];
  let made = 0;
  for (const [i, x] of template.tasks.entries()) {
    let dueOn = addDays(base, x.dueAfterDays || 0);
    const latest = addDays(today, rules.maxDays[x.priority] ?? rules.maxDays.normal);
    if (dueOn > latest) { dueOn = latest; movedEarlier += 1; }
    try {
      // One at a time: each gets the next task number, in order.
      await createTask(actor, {
        title: x.title,
        description: x.description,
        priority: x.priority,
        dueOn,
        assigneeId: project.owner.id,
        projectId: project.id,
        projectListId: x.listIndex != null ? project.lists[x.listIndex]?.id : undefined,
        stageId: x.stageIndex != null ? project.statuses[x.stageIndex]?.id : undefined,
        checklist: x.checklist,
        tags: x.tags,
        clientId: `${clientId}-t${i}`,
      }, req, { note: false });
      made += 1;
    } catch (err) {
      // One task the rules refuse (say, a person no longer in the panel) must not lose the rest.
      if (!(err instanceof AppError) || err.statusCode >= 500) throw err;
      failed.push({ title: x.title, reason: err.message });
    }
  }
  if (!duplicate) auditLogger.logAction(req, 'CREATE', 'StaffProject', project.id, { fromTemplate: template.name, tasks: made });
  return { project, duplicate, fromTemplate: { name: template.name, tasks: made, movedEarlier, failed } };
}
