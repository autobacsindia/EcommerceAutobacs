import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import userRepository from '../repositories/userRepository.js';
import {
  validateChannelIdParam,
  validateMessageIdParam,
  validateMessagePage,
  validateSendMessage,
  validateMarkRead,
  validateCreateSpace,
  validateOpenDm,
} from '../validators/chat.validator.js';
import {
  listChannels,
  listMessages,
  listPeople,
  sendMessage,
  markChannelRead,
  deleteMessage,
  createSpace,
  openDirectMessage,
  canAccess,
  canCreateSpace,
  isChatUser,
} from '../services/chatService.js';
import { onChatEvent } from '../services/chatEvents.js';

/**
 * Team chat API (/api/v1/chat) — admins and active staff only. Customers get 403
 * from staffOrAdmin before any handler runs; per-channel access is enforced in
 * chatService on every call.
 */
const router = express.Router();

// ── live stream ──────────────────────────────────────────────────────────────

const HEARTBEAT_MS = parseInt(process.env.CHAT_HEARTBEAT_MS, 10) || 25000;
const MAX_STREAMS = parseInt(process.env.CHAT_MAX_STREAMS, 10) || 200;
let openStreams = 0;

// GET /chat/stream — Server-Sent Events. No rate limiter: one long request per tab.
router.get('/stream', protect, staffOrAdmin, (req, res) => {
  if (openStreams >= MAX_STREAMS) {
    return res.status(503).json({ success: false, message: 'Chat is busy, retrying shortly', retryAfter: 30 });
  }
  openStreams++;

  // writeHead() drops headers set by cors(), so repeat the credentialed CORS pair.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(req.headers.origin
      ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
      : {}),
  });

  let user = req.user;
  let closed = false;
  const send = (payload) => { if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`); };
  send({ type: 'connected', timestamp: Date.now() });

  const unsubscribe = onChatEvent((event) => {
    if (event?.route && canAccess(user, event.route)) {
      const { route: _route, ...rest } = event; // never leak member lists to clients
      send({ ...rest, timestamp: Date.now() });
    }
  });

  // Heartbeat doubles as a re-check: someone removed from staff mid-session stops
  // receiving messages within one beat, not when they next reload.
  const beat = setInterval(async () => {
    try {
      const fresh = await userRepository.findChatPrincipal(user._id);
      // Removed from staff, or signed out everywhere (sessionVersion bumped): end the stream.
      if (!isChatUser(fresh) || (fresh.sessionVersion ?? 0) !== (req.user.sessionVersion ?? 0)) {
        cleanup(); res.end(); return;
      }
      user = fresh;
      send({ type: 'heartbeat', timestamp: Date.now() });
    } catch { /* transient DB hiccup — keep the stream, try again next beat */ }
  }, HEARTBEAT_MS);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    unsubscribe();
    openStreams--;
  }
  req.on('close', cleanup);
});

// ── REST ─────────────────────────────────────────────────────────────────────

router.use(authenticatedUserRateLimit, protect, staffOrAdmin);

// GET /chat/me — what this person may do in chat
router.get('/me', asyncHandler(async (req, res) => {
  res.json({ success: true, canCreateSpace: canCreateSpace(req.user), userId: String(req.user._id) });
}));

// GET /chat/people — everyone who can chat (for DMs / mentions)
router.get('/people', asyncHandler(async (req, res) => {
  res.json({ success: true, people: await listPeople() });
}));

// GET /chat/channels — spaces and DMs visible to me, with unread counts
router.get('/channels', asyncHandler(async (req, res) => {
  res.json({ success: true, channels: await listChannels(req.user) });
}));

// POST /chat/channels { name, description?, memberIds? } — admins & team heads
router.post('/channels', validateCreateSpace, validateRequest, asyncHandler(async (req, res) => {
  const channel = await createSpace(req.user, req.body);
  res.status(201).json({ success: true, channel });
}));

// POST /chat/dm { userId } — open (or reuse) a direct message
router.post('/dm', validateOpenDm, validateRequest, asyncHandler(async (req, res) => {
  const channel = await openDirectMessage(req.user, req.body.userId);
  res.json({ success: true, channel });
}));

// GET /chat/channels/:id/messages?before=&after=&limit=
router.get('/channels/:id/messages', validateChannelIdParam, validateMessagePage, validateRequest,
  asyncHandler(async (req, res) => {
    const page = await listMessages(req.user, req.params.id, req.query);
    res.json({ success: true, ...page });
  }));

// POST /chat/channels/:id/messages { text, clientId? }
router.post('/channels/:id/messages', validateChannelIdParam, validateSendMessage, validateRequest,
  asyncHandler(async (req, res) => {
    const { message, duplicate } = await sendMessage(req.user, req.params.id, req.body);
    res.status(duplicate ? 200 : 201).json({ success: true, message });
  }));

// POST /chat/channels/:id/read { seq }
router.post('/channels/:id/read', validateChannelIdParam, validateMarkRead, validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await markChannelRead(req.user, req.params.id, req.body.seq)) });
  }));

// DELETE /chat/messages/:id — own message, or any message for admins (soft delete)
router.delete('/messages/:id', validateMessageIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteMessage(req.user, req.params.id)) });
}));

export default router;
