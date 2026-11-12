import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  validateTaskId,
  validateTaskList,
  validateTaskCreate,
  validateTaskUpdate,
  validateTaskBulk,
  validateCommentList,
  validateCommentCreate,
  validateCommentId,
  validateCommentEdit,
  validateCommentReaction,
  validateCommentAssign,
  validateCommentResolve,
  validateAssignedCommentList,
  validateOverview,
  validateTaskFileName,
  validateChecklistAdd,
  validateChecklistUpdate,
  validateChecklistRemove,
  validateTaskFollowers,
  validateTaskLinkAdd,
  validateTaskLinkRemove,
  validateTaskLinkOptions,
  validateStepToSubtask,
  validateInboxList,
  validateInboxItem,
  validateInboxReadAll,
  validateTimeList,
  validateTimeAdd,
  validateTimeEntry,
  validateTimeEdit,
  validateSpaceRead,
  validateListItemCreate,
  validateListItemId,
  validateListItemUpdate,
  validateProjectList,
  validateProjectId,
  validateProjectCreate,
  validateProjectUpdate,
} from '../validators/staffTask.validator.js';
import {
  loadProjectAccess, listProjects, pickableProjects, getProject, createProject, updateProject,
} from '../services/staffProjectService.js';
import { listLinks, linkOptions, addLink, removeLink } from '../services/staffTaskLinkService.js';
import { getSpace, createListItem, updateListItem, deleteListItem } from '../services/staffTaskListService.js';
import { listInbox, setInboxState, readAllInbox } from '../services/staffTaskInboxService.js';
import {
  currentTimer, startTimer, stopTimer, listTime, addTime, editTime, deleteTime,
} from '../services/staffTaskTimeService.js';
import {
  listTasks,
  listAssignees,
  summaryFor,
  getTask,
  createTask,
  updateTask,
  bulkUpdate,
  listComments,
  addComment,
  editComment,
  deleteComment,
  reactToComment,
  assignComment,
  resolveComment,
  listAssignedComments,
  teamOverview,
  listMentionable,
  addTaskFiles,
  removeTaskFileFrom,
  readFileOf,
  addChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
  changeFollowers,
  listSubtasks,
  subtaskFromStep,
} from '../services/staffTaskService.js';
import { uploadChatFiles, handleChatUploadError } from '../services/chatAttachmentService.js';
import { attachmentSizeGuard } from '../middleware/uploadMiddleware.js';

/** Files arrive on the `files` field of a multipart form: same checks and limits as team chat. */
const withFiles = [attachmentSizeGuard, uploadChatFiles, handleChatUploadError];

/**
 * Staff tasks (/api/v1/staff/tasks). Mounted inside routes/staff.js, AFTER its
 * signed-in gate (rate limit, protect, staffOrAdmin) — so every route here is
 * an active staff member or an admin. Who may do what to which task is decided
 * in services/staffTaskService.js.
 */
const router = express.Router();

// Which projects this person sees: read once per request, so every task rule
// below (page, comments, files, timer, links) gives project members the same answer.
router.use(asyncHandler(async (req, res, next) => {
  await loadProjectAccess(req.user);
  next();
}));

// @route  GET /staff/tasks?view=mine|following|created|team&state=open|done|archived&due=&priority=&tag=&q=&assignee=&team=&sort=due|newest|oldest|updated&cursor=
router.get('/', validateTaskList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listTasks(req.user, req.query)) });
}));

// @route  GET /staff/tasks/assigned-comments?state=open|resolved&before= — comments given to the caller
router.get('/assigned-comments', validateAssignedCommentList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listAssignedComments(req.user, req.query)) });
}));

// @route  GET /staff/tasks/overview?team= — one team's numbers
router.get('/overview', validateOverview, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await teamOverview(req.user, req.query)) });
}));

// @route  GET /staff/tasks/summary — the caller's late / due-today counts (page header)
router.get('/summary', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await summaryFor(req.user)) });
}));

// @route  GET /staff/tasks/assignees — who the caller may give a task to
router.get('/assignees', asyncHandler(async (req, res) => {
  res.json({ success: true, people: await listAssignees(req.user) });
}));

// @route  GET /staff/tasks/inbox?state=all|unread&cursor= — the caller's Inbox, newest first
router.get('/inbox', validateInboxList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listInbox(req.user, req.query)) });
}));

// @route  POST /staff/tasks/inbox/read-all { upTo } — every unread line up to the newest one shown
router.post('/inbox/read-all', validateInboxReadAll, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await readAllInbox(req.user, req.body.upTo)) });
}));

// @route  PATCH /staff/tasks/inbox/:itemId { state: unread|read|cleared } — one of the caller's lines
router.patch('/inbox/:itemId', validateInboxItem, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await setInboxState(req.user, req.params.itemId, req.body.state)) });
}));

// @route  GET /staff/tasks/time/current — the caller's running timer (one left past the limit is stopped here)
router.get('/time/current', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await currentTimer(req.user)) });
}));

// @route  POST /staff/tasks/time/stop — stop the caller's timer; `entry` is null when none was running
router.post('/time/stop', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await stopTimer(req.user)) });
}));

// @route  GET /staff/tasks/space?team= — a team's folders and lists, with open-task counts (own team; any for the admin)
router.get('/space', validateSpaceRead, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, space: await getSpace(req.user, req.query.team) });
}));

// @route  POST /staff/tasks/space/items { team?, kind: folder|list, name, colour?, folderId? } — head of that team or the admin
router.post('/space/items', validateListItemCreate, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, item: await createListItem(req.user, req.body, req) });
}));

// @route  PATCH /staff/tasks/space/items/:itemId { rev, name?, colour?, folderId? }
router.patch('/space/items/:itemId', validateListItemUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, item: await updateListItem(req.user, req.params.itemId, req.body, req) });
}));

// @route  DELETE /staff/tasks/space/items/:itemId — its tasks go back to "Other tasks"
router.delete('/space/items/:itemId', validateListItemId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteListItem(req.user, req.params.itemId, req)) });
}));

// @route  GET /staff/tasks/projects?state=active|archived&cursor= — the projects you see, soonest deadline first
router.get('/projects', validateProjectList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listProjects(req.user, req.query)) });
}));

// @route  GET /staff/tasks/projects/pick — names of the projects you see, for a task's picker
router.get('/projects/pick', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pickableProjects(req.user)) });
}));

// @route  POST /staff/tasks/projects { name, description?, colour?, startOn?, dueOn?, ownerId?, memberIds?, clientId? } — admin or a team head
router.post('/projects', validateProjectCreate, validateRequest, asyncHandler(async (req, res) => {
  const { project, duplicate } = await createProject(req.user, req.body, req);
  res.status(duplicate ? 200 : 201).json({ success: true, project, duplicate });
}));

// @route  GET /staff/tasks/projects/:projectId
router.get('/projects/:projectId', validateProjectId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, project: await getProject(req.user, req.params.projectId) });
}));

// @route  PATCH /staff/tasks/projects/:projectId { rev, ...changes, archived? } — its owner or the admin
router.patch('/projects/:projectId', validateProjectUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, project: await updateProject(req.user, req.params.projectId, req.body, req) });
}));

// @route  POST /staff/tasks { title, description?, priority?, dueOn?, assigneeId? | assigneeIds?, orderId?, clientId? }
// Several people → one copy each; `tasks` lists them all, `task` is the first.
router.post('/', validateTaskCreate, validateRequest, asyncHandler(async (req, res) => {
  const { task, tasks, duplicate } = await createTask(req.user, req.body, req);
  res.status(duplicate ? 200 : 201).json({ success: true, task, tasks, duplicate });
}));

// @route  POST /staff/tasks/bulk { items: [{ id, rev }], changes: { status? | priority? | dueOn? | assigneeId? | archived? | addTags? | removeTags? } }
// 200 with a result per task: some may be refused while the rest change.
router.post('/bulk', validateTaskBulk, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await bulkUpdate(req.user, req.body, req)) });
}));

// @route  GET /staff/tasks/:id
router.get('/:id', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await getTask(req.user, req.params.id) });
}));

// @route  PATCH /staff/tasks/:id { rev, ...changes }
router.patch('/:id', validateTaskUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await updateTask(req.user, req.params.id, req.body, req) });
}));

// @route  POST /staff/tasks/:id/checklist { text, clientId? } — add a step
router.post('/:id/checklist', validateChecklistAdd, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await addChecklistItem(req.user, req.params.id, req.body) });
}));

// @route  PATCH /staff/tasks/:id/checklist/:itemId { done?, text? } — tick / untick / rename
router.patch('/:id/checklist/:itemId', validateChecklistUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await updateChecklistItem(req.user, req.params.id, req.params.itemId, req.body) });
}));

// @route  DELETE /staff/tasks/:id/checklist/:itemId — remove a step
router.delete('/:id/checklist/:itemId', validateChecklistRemove, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await removeChecklistItem(req.user, req.params.id, req.params.itemId) });
}));

// @route  POST /staff/tasks/:id/checklist/:itemId/subtask { clientId, assigneeIds? } — make a step a sub-task
router.post('/:id/checklist/:itemId/subtask', validateStepToSubtask, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await subtaskFromStep(req.user, req.params.id, req.params.itemId, req.body, req)) });
}));

// @route  GET /staff/tasks/:id/links — waiting on / blocking / related
router.get('/:id/links', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listLinks(req.user, req.params.id)) });
}));

// @route  GET /staff/tasks/:id/links/options?q= — tasks that could be linked to this one
router.get('/:id/links/options', validateTaskLinkOptions, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await linkOptions(req.user, req.params.id, req.query)) });
}));

// @route  POST /staff/tasks/:id/links { kind, taskId }
router.post('/:id/links', validateTaskLinkAdd, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await addLink(req.user, req.params.id, req.body, req)) });
}));

// @route  DELETE /staff/tasks/:id/links/:linkId
router.delete('/:id/links/:linkId', validateTaskLinkRemove, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await removeLink(req.user, req.params.id, req.params.linkId, req)) });
}));

// @route  GET /staff/tasks/:id/subtasks — the sub-tasks under a task (at most 50, not archived)
router.get('/:id/subtasks', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listSubtasks(req.user, req.params.id)) });
}));

// @route  PUT /staff/tasks/:id/comments/:commentId/assignee { userId | null } — what it should be
router.put('/:id/comments/:commentId/assignee', validateCommentAssign, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await assignComment(req.user, req.params.id, req.params.commentId, req.body.userId)) });
}));

// @route  PUT /staff/tasks/:id/comments/:commentId/resolved { resolved } — what it should be
router.put('/:id/comments/:commentId/resolved', validateCommentResolve, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await resolveComment(req.user, req.params.id, req.params.commentId, req.body.resolved)) });
}));

// @route  GET /staff/tasks/:id/comments?before=
router.get('/:id/comments', validateCommentList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listComments(req.user, req.params.id, req.query)) });
}));

// @route  POST /staff/tasks/:id/comments { text, clientId?, mentions?: [userId] } — JSON, or multipart with `files`
router.post('/:id/comments', ...withFiles, validateCommentCreate, validateRequest, asyncHandler(async (req, res) => {
  const { comment, duplicate } = await addComment(req.user, req.params.id, {
    text: req.body.text, clientId: req.body.clientId, mentions: req.body.mentions, files: req.files || [],
  });
  res.status(duplicate ? 200 : 201).json({ success: true, comment, duplicate });
}));

// @route  PATCH /staff/tasks/:id/comments/:commentId { text } — your own, within 30 minutes
router.patch('/:id/comments/:commentId', validateCommentEdit, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await editComment(req.user, req.params.id, req.params.commentId, req.body)) });
}));

// @route  DELETE /staff/tasks/:id/comments/:commentId — your own, within 30 minutes (soft)
router.delete('/:id/comments/:commentId', validateCommentId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteComment(req.user, req.params.id, req.params.commentId)) });
}));

// @route  PUT /staff/tasks/:id/comments/:commentId/reactions { emoji, on? } — what my reaction should be
router.put('/:id/comments/:commentId/reactions', validateCommentReaction, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reactToComment(req.user, req.params.id, req.params.commentId, req.body)) });
}));

// @route  POST /staff/tasks/:id/time/start — start the caller's timer here (stopping one on another task)
router.post('/:id/time/start', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await startTimer(req.user, req.params.id)) });
}));

// @route  GET /staff/tasks/:id/time?cursor= — the task's time entries, newest first, and its totals
router.get('/:id/time', validateTimeList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listTime(req.user, req.params.id, req.query)) });
}));

// @route  POST /staff/tasks/:id/time { minutes, on, note?, clientId? } — add time by hand
router.post('/:id/time', validateTimeAdd, validateRequest, asyncHandler(async (req, res) => {
  const { entry, duplicate } = await addTime(req.user, req.params.id, req.body);
  res.status(duplicate ? 200 : 201).json({ success: true, entry, duplicate });
}));

// @route  PATCH /staff/tasks/:id/time/:entryId { minutes?, on?, note? } — correct your own entry (admin: anyone's)
router.patch('/:id/time/:entryId', validateTimeEdit, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await editTime(req.user, req.params.id, req.params.entryId, req.body)) });
}));

// @route  DELETE /staff/tasks/:id/time/:entryId — delete your own entry, or discard your running timer
router.delete('/:id/time/:entryId', validateTimeEntry, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteTime(req.user, req.params.id, req.params.entryId)) });
}));

// @route  PATCH /staff/tasks/:id/followers { add?: [personId], remove?: [personId] } — follow / unfollow; editors choose for others
router.patch('/:id/followers', validateTaskFollowers, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await changeFollowers(req.user, req.params.id, req.body)) });
}));

// @route  GET /staff/tasks/:id/mentionable — who can be @mentioned (the people on the task; editors: anyone in the panel)
router.get('/:id/mentionable', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listMentionable(req.user, req.params.id)), me: { id: String(req.user._id), name: req.user.name || '' } });
}));

// @route  POST /staff/tasks/:id/files (multipart `files`) — add files to the task
router.post('/:id/files', ...withFiles, validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await addTaskFiles(req.user, req.params.id, req.files || []) });
}));

// @route  DELETE /staff/tasks/:id/files/:name — remove one
router.delete('/:id/files/:name', validateTaskFileName, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await removeTaskFileFrom(req.user, req.params.id, req.params.name) });
}));

/**
 * A Content-Disposition header: an ASCII fallback from the stored name (its
 * upload-time prefix dropped) plus the original name, UTF-8 encoded (RFC 6266),
 * so "बिल 10482.pdf" downloads as itself and nothing can break out of the quotes.
 */
function contentDisposition(type, storedName, originalName) {
  const ascii = String(storedName).replace(/^\d+-[a-z0-9]+-/, '').replace(/[^\w.-]+/g, '_');
  const header = `${type}; filename="${ascii}"`;
  if (!originalName) return header;
  // encodeURIComponent leaves ' ( ) * as they are; RFC 5987 does not allow them.
  const encoded = encodeURIComponent(originalName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${header}; filename*=UTF-8''${encoded}`;
}

// @route  GET /staff/tasks/:id/files/:name — a file's bytes (task or comment), for people who see the task.
// ?download=1 asks for a download (saved under the name it was uploaded with) instead of viewing it.
router.get('/:id/files/:name', validateTaskFileName, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, mime, inline, name } = await readFileOf(req.user, req.params.id, req.params.name);
  const download = req.query.download === '1';
  res.set({
    'Content-Type': mime,
    'Content-Length': buffer.length,
    'Content-Disposition': contentDisposition(inline && !download ? 'inline' : 'attachment', req.params.name, name),
    'X-Content-Type-Options': 'nosniff',
    // The bytes never change; private so no shared cache keeps them.
    'Cache-Control': 'private, max-age=86400',
  });
  res.send(buffer);
}));

export default router;
