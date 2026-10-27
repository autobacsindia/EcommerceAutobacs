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
} from '../validators/staffTask.validator.js';
import {
  listTasks,
  listAssignees,
  getTask,
  createTask,
  updateTask,
  listComments,
  addComment,
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

// @route  POST /staff/tasks { title, description?, priority?, dueOn?, assigneeId?, orderId?, clientId? }
router.post('/', validateTaskCreate, validateRequest, asyncHandler(async (req, res) => {
  const { task, duplicate } = await createTask(req.user, req.body, req);
  res.status(duplicate ? 200 : 201).json({ success: true, task, duplicate });
}));

// @route  GET /staff/tasks/:id
router.get('/:id', validateTaskId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await getTask(req.user, req.params.id) });
}));

// @route  PATCH /staff/tasks/:id { rev, ...changes }
router.patch('/:id', validateTaskUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, task: await updateTask(req.user, req.params.id, req.body, req) });
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
