/**
 * Channel adapters — turn an existing domain record into a linked support
 * ticket, so every customer conversation lands in one inbox.
 *
 * DESIGN RULE: the adapter creates a ticket that carries the CONVERSATION. The
 * originating record stays the system of record for its own domain.
 *
 * That distinction matters most for returns. ReturnRequest keeps ownership of
 * the refund maths, the evidence assets and the 4-day policy window — a generic
 * ticket status must never become the thing that decides whether money moves.
 * The ticket exists so an agent can talk to the customer about the return from
 * the same place they answer everything else.
 *
 * Every adapter is idempotent via (sourceModel, sourceId), which is backed by a
 * unique partial index — so a retry, a double-click or a re-run of a backfill
 * yields one ticket, not several.
 */

import ticketService from './ticketService.js';
import productRepository from '../repositories/productRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderRepository from '../repositories/orderRepository.js';

/** Trim a long body into a usable subject line. */
const toSubject = (text = '', max = 90) => {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * A question asked on a product page.
 *
 * Priority stays `normal`: an unanswered PDP question is a lost sale, but it is
 * not the same urgency as a customer whose paid order has gone missing.
 *
 * @param {Object} question - a ProductQuestion document
 * @returns {Promise<Object|null>} the ticket, or null when it cannot be linked
 */
export const ticketFromProductQuestion = async (question) => {
  if (!question?.email && !question?.user) return null;

  const product = question.product
    ? await productRepository.findById(question.product)
    : null;

  const user = question.user ? await userRepository.findById(question.user) : null;
  const email = user?.email || question.email;
  if (!email) return null;

  const ticket = await ticketService.createTicket({
    subject: product
      ? `Question about ${product.name}`
      : toSubject(question.question) || 'Product question',
    channel: 'product_question',
    requester: {
      user: user?._id || null,
      email,
      name: user?.name || question.name || '',
      phone: user?.phone || '',
    },
    context: { product: question.product || null },
    sourceModel: 'ProductQuestion',
    sourceId: question._id,
    tags: ['product-question'],
    requesterVerified: Boolean(user),
  });

  await ticketService.addMessage({
    ticketId: ticket._id,
    direction: 'inbound',
    visibility: 'public',
    author: { user: user?._id || null, email, name: user?.name || question.name || '', isAgent: false },
    bodyText: question.question || '',
  });

  return ticket;
};

/**
 * A submitted review that warrants a conversation.
 *
 * Only LOW-RATED reviews become tickets. A five-star review needs no support
 * response, and turning every one into a ticket would bury the queue in work
 * that does not exist — the review moderation screen already handles publishing.
 *
 * @param {Object} review - a Review document
 * @param {number} [threshold=3] - ratings at or below this open a ticket
 */
export const ticketFromReview = async (review, threshold = 3) => {
  if (!review || Number(review.rating) > threshold) return null;

  const user = review.user ? await userRepository.findById(review.user) : null;
  const email = user?.email || review.email;
  if (!email) return null;

  const product = review.product ? await productRepository.findById(review.product) : null;

  const ticket = await ticketService.createTicket({
    subject: product
      ? `${review.rating}★ review on ${product.name}`
      : `${review.rating}★ review needs follow-up`,
    channel: 'review',
    // A dissatisfied customer who has already published their complaint is a
    // reputational clock, not a routine query.
    priority: Number(review.rating) <= 2 ? 'high' : 'normal',
    requester: {
      user: user?._id || null,
      email,
      name: user?.name || review.name || '',
      phone: user?.phone || '',
    },
    context: { product: review.product || null, review: review._id },
    sourceModel: 'Review',
    sourceId: review._id,
    tags: ['review', `rating-${review.rating}`],
    requesterVerified: Boolean(user),
  });

  await ticketService.addMessage({
    ticketId: ticket._id,
    direction: 'inbound',
    visibility: 'public',
    author: { user: user?._id || null, email, name: user?.name || review.name || '', isAgent: false },
    bodyText: [review.title, review.comment].filter(Boolean).join('\n\n') || '(no comment)',
  });

  return ticket;
};

/**
 * A return request.
 *
 * The ticket carries the conversation ONLY. ReturnRequest remains authoritative
 * for status, refund amount, evidence and the policy window — see the note at
 * the top of this file. Nothing here writes to the return.
 *
 * @param {Object} returnRequest - a ReturnRequest document
 */
export const ticketFromReturn = async (returnRequest) => {
  if (!returnRequest?.user) return null;

  const user = await userRepository.findById(returnRequest.user);
  if (!user?.email) return null;

  const order = returnRequest.order
    ? await orderRepository.findById(returnRequest.order)
    : null;

  const ticket = await ticketService.createTicket({
    subject: order?.orderNumber
      ? `Return for order ${order.orderNumber}`
      : 'Return request',
    channel: 'return',
    // Returns are money and are policy-clocked; they outrank a general query.
    priority: 'high',
    requester: {
      user: user._id,
      email: user.email,
      name: user.name || '',
      phone: user.phone || '',
    },
    context: {
      order: returnRequest.order || null,
      returnRequest: returnRequest._id,
    },
    sourceModel: 'ReturnRequest',
    sourceId: returnRequest._id,
    tags: ['return'],
    // Returns can only be raised from an authenticated session.
    requesterVerified: true,
  });

  const reasons = (returnRequest.items || [])
    .map((i) => i.reason)
    .filter(Boolean);

  await ticketService.addMessage({
    ticketId: ticket._id,
    direction: 'inbound',
    visibility: 'public',
    author: { user: user._id, email: user.email, name: user.name || '', isAgent: false },
    bodyText: [
      'A return request was submitted.',
      reasons.length ? `Reason(s): ${reasons.join(', ')}` : '',
      returnRequest.comments || '',
      '',
      'Refund amount, evidence and approval are managed on the Returns screen — this ticket is for talking to the customer.',
    ].filter(Boolean).join('\n'),
  });

  return ticket;
};

export default {
  ticketFromProductQuestion,
  ticketFromReview,
  ticketFromReturn,
};
