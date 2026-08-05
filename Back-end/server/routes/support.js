/**
 * Support ticket API — /api/v1/support/*
 *
 * Two audiences on one router:
 *   - customers: open a ticket, list their own, read and reply to their own
 *   - agents (admin): the full inbox, assignment, internal notes, status
 *
 * ERRORS: throw AppError(message, status). errorMiddleware ignores a res.status()
 * set before a bare throw, so a plain Error ships as a 500 "Something went
 * wrong" and pages whoever is on call.
 *
 * NOTE: the inbound webhook (POST /api/v1/support/inbound) is NOT mounted here.
 * It lives in app.js ahead of the CSRF middleware — see the comment there.
 */

import express from 'express';
import AppError from '../utils/AppError.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin, optionalAuth } from '../middleware/authMiddleware.js';
import ticketRepository from '../repositories/supportTicketRepository.js';
import messageRepository from '../repositories/supportMessageRepository.js';
import ticketService from '../services/ticketService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { signedAttachmentUrl } from '../utils/supportAttachments.js';
import { cleanHTML } from '../utils/htmlSanitizer.js';
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  OPEN_TICKET_STATUSES,
} from '../config/supportPolicy.js';
import { supportSubmitRateLimit } from '../middleware/rate-limit/ecommerceLimiters.js';

const router = express.Router();

/**
 * Enqueue a notification job without letting a Redis outage fail the request.
 * The ticket write has already succeeded; the email is best-effort and
 * recoverable, so a queue failure is logged rather than surfaced.
 */
const enqueue = async (name, data) => {
  try {
    await getNotificationsQueue().add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
    });
  } catch (err) {
    console.error(`[Support] Failed to enqueue ${name}:`, err?.message);
  }
};

/** Attachments with freshly signed, short-lived URLs. Admin-only callers. */
const withSignedAttachments = (message) => ({
  ...message,
  attachments: (message.attachments || []).map((a) => ({
    ...a,
    url: signedAttachmentUrl(a.publicId, a.resourceType),
  })),
});

/**
 * Customer-facing ticket shape. Deliberately omits internal fields — assignee,
 * tags, SLA timers and loop-guard counters are operational data and are not the
 * customer's business.
 */
const publicTicket = (t) => ({
  reference: t.reference,
  subject: t.subject,
  status: t.status,
  channel: t.channel,
  createdAt: t.createdAt,
  lastMessageAt: t.lastMessageAt,
  messageCount: t.messageCount,
});

// ── Customer routes ─────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/support/tickets
 * @desc    Open a ticket from the web form
 * @access  Public (optionalAuth links a signed-in customer)
 */
router.post(
  '/tickets',
  supportSubmitRateLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { name, email, subject, message, orderId } = req.body || {};

    // A signed-in user's own account address wins over anything posted in the
    // body, so an authenticated session cannot be used to open tickets under
    // someone else's address.
    const requesterEmail = req.user?.email || String(email || '').trim();
    if (!requesterEmail) throw new AppError('An email address is required.', 400);
    if (!String(message || '').trim()) throw new AppError('A message is required.', 400);

    const ticket = await ticketService.createTicket({
      subject: String(subject || '').trim() || 'Website enquiry',
      channel: 'web_form',
      requester: {
        user: req.user?._id || null,
        email: requesterEmail,
        name: req.user?.name || String(name || '').trim(),
        phone: req.user?.phone || '',
      },
      context: { order: orderId || null },
      // Only a signed-in submission proves who the requester is.
      requesterVerified: Boolean(req.user),
    });

    await ticketService.addMessage({
      ticketId: ticket._id,
      direction: 'inbound',
      visibility: 'public',
      author: {
        user: req.user?._id || null,
        email: requesterEmail,
        name: req.user?.name || String(name || '').trim(),
        isAgent: false,
      },
      // The form is plain text; sanitise anyway so a pasted payload can never
      // reach the admin thread view as live markup.
      bodyText: cleanHTML(String(message).trim()),
    });

    await enqueue('send-support-acknowledgement', { ticketId: String(ticket._id) });

    res.status(201).json({
      success: true,
      message: `Thanks — we've opened ticket ${ticket.reference} and will reply shortly.`,
      data: { reference: ticket.reference },
    });
  })
);

/**
 * @route   GET /api/v1/support/tickets/mine
 * @desc    The signed-in customer's own tickets
 * @access  Private
 */
router.get(
  '/tickets/mine',
  protect,
  asyncHandler(async (req, res) => {
    const tickets = await ticketRepository.find(
      { 'requester.email': req.user.email.toLowerCase() },
      { sort: { lastMessageAt: -1 }, limit: 50 }
    );
    res.json({ success: true, data: tickets.map(publicTicket) });
  })
);

/**
 * @route   GET /api/v1/support/tickets/mine/:reference
 * @desc    One of the customer's own tickets, with its public thread
 * @access  Private
 */
router.get(
  '/tickets/mine/:reference',
  protect,
  asyncHandler(async (req, res) => {
    const ticket = await ticketRepository.findByReference(req.params.reference);
    // Ownership is checked against the session's email, never a query parameter.
    // A 404 rather than 403 so ticket references cannot be enumerated.
    if (!ticket || ticket.requester.email !== req.user.email.toLowerCase()) {
      throw new AppError('Ticket not found.', 404);
    }

    const messages = await messageRepository.findThread(ticket._id, {
      includeInternal: false,
    });

    res.json({
      success: true,
      data: {
        ticket: publicTicket(ticket),
        messages: messages.map((m) => ({
          direction: m.direction,
          author: { name: m.author?.name || '', isAgent: m.author?.isAgent },
          bodyText: m.bodyText,
          createdAt: m.createdAt,
          attachmentCount: (m.attachments || []).length,
        })),
      },
    });
  })
);

/**
 * @route   POST /api/v1/support/tickets/mine/:reference/reply
 * @desc    Customer replies from the website
 * @access  Private
 */
router.post(
  '/tickets/mine/:reference/reply',
  protect,
  supportSubmitRateLimit,
  asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    if (!String(message || '').trim()) throw new AppError('A message is required.', 400);

    const ticket = await ticketRepository.findByReference(req.params.reference);
    if (!ticket || ticket.requester.email !== req.user.email.toLowerCase()) {
      throw new AppError('Ticket not found.', 404);
    }

    await ticketService.addMessage({
      ticketId: ticket._id,
      direction: 'inbound',
      visibility: 'public',
      author: { user: req.user._id, email: req.user.email, name: req.user.name, isAgent: false },
      bodyText: cleanHTML(String(message).trim()),
    });

    res.json({ success: true, message: 'Reply added.' });
  })
);

// ── Agent (admin) routes ────────────────────────────────────────────────────

/**
 * @route   GET /api/v1/support/admin/tickets
 * @desc    The support inbox
 * @access  Private/Admin
 */
router.get(
  '/admin/tickets',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const {
      status, assignee, channel, priority, q,
      page = 1, limit = 25,
    } = req.query;

    const query = {};
    if (status === 'open') query.status = { $in: OPEN_TICKET_STATUSES };
    else if (status && TICKET_STATUSES.includes(status)) query.status = status;

    if (assignee === 'unassigned') query.assignee = null;
    else if (assignee) query.assignee = assignee;

    if (channel) query.channel = channel;
    if (priority && TICKET_PRIORITIES.includes(priority)) query.priority = priority;
    if (q) query.$text = { $search: String(q) };

    const perPage = Math.min(Number(limit) || 25, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

    const [tickets, total, counts] = await Promise.all([
      ticketRepository.find(query, {
        sort: { lastMessageAt: -1 },
        skip,
        limit: perPage,
        populate: [{ path: 'assignee', select: 'name email' }],
      }),
      ticketRepository.count(query),
      ticketRepository.getInboxCounts(),
    ]);

    // One aggregate for all previews rather than a query per row.
    const previews = await messageRepository.findLatestForTickets(
      tickets.map((t) => t._id)
    );
    const previewBy = new Map(previews.map((p) => [String(p._id), p]));

    res.json({
      success: true,
      data: tickets.map((t) => ({
        ...t,
        preview: previewBy.get(String(t._id))?.bodyText?.slice(0, 160) || '',
      })),
      counts,
      total,
      page: Number(page),
      pages: Math.ceil(total / perPage),
    });
  })
);

/**
 * @route   GET /api/v1/support/admin/tickets/:id
 * @desc    Full thread including internal notes
 * @access  Private/Admin
 */
router.get(
  '/admin/tickets/:id',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const ticket = await ticketRepository.findById(req.params.id, [
      { path: 'assignee', select: 'name email' },
      { path: 'requester.user', select: 'name email phone' },
      { path: 'order', select: 'orderNumber totalAmount status createdAt' },
      { path: 'returnRequest', select: 'status createdAt' },
      { path: 'product', select: 'name slug' },
    ]);
    if (!ticket) throw new AppError('Ticket not found.', 404);

    const messages = await messageRepository.findThread(ticket._id, {
      includeInternal: true,
    });

    res.json({
      success: true,
      data: { ticket, messages: messages.map(withSignedAttachments) },
    });
  })
);

/**
 * @route   POST /api/v1/support/admin/tickets/:id/reply
 * @desc    Reply to the customer, or add an internal note
 * @access  Private/Admin
 */
router.post(
  '/admin/tickets/:id/reply',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { message, internal = false } = req.body || {};
    if (!String(message || '').trim()) throw new AppError('A message is required.', 400);

    const ticket = await ticketRepository.findById(req.params.id);
    if (!ticket) throw new AppError('Ticket not found.', 404);

    if (internal) {
      // Notes stay in the database and never touch the mail path.
      await ticketService.addMessage({
        ticketId: ticket._id,
        direction: 'outbound',
        visibility: 'internal',
        author: { user: req.user._id, email: req.user.email, name: req.user.name, isAgent: true },
        bodyText: cleanHTML(String(message).trim()),
      });
      return res.json({ success: true, message: 'Internal note added.' });
    }

    // The send path records the outbound message itself, so it is enqueued
    // rather than written here — otherwise the thread would show it twice.
    await enqueue('send-support-reply', {
      ticketId: String(ticket._id),
      body: String(message).trim(),
      authorId: String(req.user._id),
      authorName: req.user.name,
    });

    res.json({ success: true, message: 'Reply queued for delivery.' });
  })
);

/**
 * @route   PATCH /api/v1/support/admin/tickets/:id
 * @desc    Update status, assignee or priority
 * @access  Private/Admin
 */
router.patch(
  '/admin/tickets/:id',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { status, assignee, priority } = req.body || {};
    const actor = { user: req.user._id, name: req.user.name };
    let ticket = await ticketRepository.findById(req.params.id);
    if (!ticket) throw new AppError('Ticket not found.', 404);

    if (assignee !== undefined) {
      ticket = await ticketService.assignTicket(ticket._id, assignee || null, actor);
    }
    if (priority !== undefined) {
      ticket = await ticketService.setPriority(ticket._id, priority, actor);
    }
    if (status !== undefined) {
      ticket = await ticketService.transitionStatus(ticket._id, status, actor);
      if (status === 'resolved') {
        await enqueue('send-support-resolution', { ticketId: String(ticket._id) });
      }
    }

    res.json({ success: true, data: ticket });
  })
);

export default router;
