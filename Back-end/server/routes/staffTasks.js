import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  validateTaskId,
  validateTaskList,
  validateTaskCreate,
  validateTaskUpdate,
  validateCommentList,
  validateCommentCreate,
  validateChecklistAdd,
  validateChecklistUpdate,
  validateChecklistRemove,
} from '../validators/staffTask.validator.js';
import {
  listTasks,
  listAssignees,
  getTask,
  createTask,
  updateTask,
  listComments,
  addComment,
  addChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
} from '../services/staffTaskService.js';

/**
 * Staff tasks (/api/v1/staff/tasks). Mounted inside routes/staff.js, AFTER its
 * signed-in gate (rate limit, protect, staffOrAdmin) — so every route here is
 * an active staff member or an admin. Who may do what to which task is decided
 * in services/staffTaskService.js.
 */
const router = express.Router();

// @route  GET /staff/tasks?view=mine|created|team&state=open|done|archived&due=&assignee=&team=&cursor=
router.get('/', validateTaskList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listTasks(req.user, req.query)) });
}));

// @route  GET /staff/tasks/assignees — who the caller may give a task to
router.get('/assignees', asyncHandler(async (req, res) => {
  res.json({ success: true, people: await listAssignees(req.user) });
}));

// @route  POST /staff/tasks { title, description?, priority?, dueOn?, assigneeId? | assigneeIds?, orderId?, clientId? }
// Several people → one copy each; `tasks` lists them all, `task` is the first.
router.post('/', validateTaskCreate, validateRequest, asyncHandler(async (req, res) => {
  const { task, tasks, duplicate } = await createTask(req.user, req.body, req);
  res.status(duplicate ? 200 : 201).json({ success: true, task, tasks, duplicate });
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

// @route  GET /staff/tasks/:id/comments?before=
router.get('/:id/comments', validateCommentList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listComments(req.user, req.params.id, req.query)) });
}));

// @route  POST /staff/tasks/:id/comments { text, clientId? }
router.post('/:id/comments', validateCommentCreate, validateRequest, asyncHandler(async (req, res) => {
  const { comment, duplicate } = await addComment(req.user, req.params.id, req.body);
  res.status(duplicate ? 200 : 201).json({ success: true, comment, duplicate });
}));

export default router;
