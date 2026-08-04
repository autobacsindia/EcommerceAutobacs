/**
 * Support ticket vocabulary — mirrors Back-end/server/config/supportPolicy.js.
 *
 * Keep the two in lockstep: the backend enums are authoritative and reject
 * anything not in their list, so a value that drifts here becomes a 400 the user
 * cannot act on. Same discipline as RETURN_REASONS / RETURN_WINDOW_DAYS.
 */

export const TICKET_STATUSES = [
  'new',
  'open',
  'pending_customer',
  'on_hold',
  'resolved',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses that still need someone on our side to act. */
export const OPEN_TICKET_STATUSES: TicketStatus[] = ['new', 'open', 'on_hold'];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CHANNELS = [
  'email',
  'web_form',
  'product_question',
  'review',
  'return',
  'admin',
] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

/** Customer-facing status wording. Internal states are softened deliberately. */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  open: 'In progress',
  pending_customer: 'Awaiting your reply',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** Admin-facing status wording, which says what the agent actually needs to know. */
export const ADMIN_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  open: 'Open',
  pending_customer: 'Awaiting customer',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const CHANNEL_LABELS: Record<TicketChannel, string> = {
  email: 'Email',
  web_form: 'Contact form',
  product_question: 'Product question',
  review: 'Review',
  return: 'Return',
  admin: 'Created by agent',
};

export const CHANNEL_ICONS: Record<TicketChannel, string> = {
  email: '✉️',
  web_form: '📝',
  product_question: '❓',
  review: '⭐',
  return: '↩️',
  admin: '🧑‍💼',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** Published support hours — keep in step with BUSINESS_HOURS on the backend. */
export const SUPPORT_HOURS_LABEL = 'Mon–Sat, 10:00 AM – 6:00 PM IST';
