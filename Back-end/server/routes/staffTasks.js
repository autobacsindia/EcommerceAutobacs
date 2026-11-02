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
  validateTaskFileName,
  validateChecklistAdd,
  validateChecklistUpdate,
  validateChecklistRemove,
  validateTaskFollowers,
  validateStepToSubtask,
  validateInboxList,
  validateInboxItem,
  validateInboxReadAll,
} from '../validators/staffTask.validator.js';
import { listInbox, setInboxState, readAllInbox } from '../services/staffTaskInboxService.js';
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

// @route  GET /staff/tasks?view=mine|following|created|team&state=open|done|archived&due=&priority=&tag=&q=&assignee=&team=&sort=due|newest|oldest|updated&cursor=
router.get('/', validateTaskList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listTasks(req.user, req.query)) });
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

// @route  GET /staff/tasks/:id/subtasks — the sub-tasks under a task (at most 50, not archived)
router.get('/:id/subtasks', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listSubtasks(req.user, req.params.id)) });
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

// @route  PATCH /staff/tasks/:id/followers { add?: [personId], remove?: [personId] } — follow / unfollow; editors choose for others
router.patch('/:id/followers', validateTaskFollowers, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await changeFollowers(req.user, req.params.id, req.body)) });
}));

// @route  GET /staff/tasks/:id/mentionable — who can be @mentioned (the people on the task; editors: anyone in the panel)
router.get('/:id/mentionable', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listMentionable(req.user, req.params.id)) });
}));

// @route  POST /staff/tasks/:id/files (multipart `files`) — add files to the task
router.post('/:id/files', ...withFiles, validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await addTaskFiles(req.user, req.params.id, req.files || []) });
}));

// @route  DELETE /staff/tasks/:id/files/:name — remove one
router.delete('/:id/files/:name', validateTaskFileName, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await removeTaskFileFrom(req.user, req.params.id, req.params.name) });
}));

// @route  GET /staff/tasks/:id/files/:name — a file's bytes (task or comment), for people who see the task
router.get('/:id/files/:name', validateTaskFileName, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, mime, inline } = await readFileOf(req.user, req.params.id, req.params.name);
  res.set({
    'Content-Type': mime,
    'Content-Length': buffer.length,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(req.params.name).replace(/^\d+-[a-z0-9]+-/, '').replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    // The bytes never change; private so no shared cache keeps them.
    'Cache-Control': 'private, max-age=86400',
  });
  res.send(buffer);
}));

export default router;
