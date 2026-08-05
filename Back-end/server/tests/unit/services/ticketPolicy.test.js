/**
 * Ticket state machine, reference parsing, and the signed reply-to token.
 *
 * Pure logic only — no database. The state machine decides whether a customer's
 * reply reopens a conversation or gets lost, and the token is the only thing
 * stopping an outsider from injecting messages into someone else's ticket.
 */

import {
  canTransition,
  parseTicketRef,
  formatTicketRef,
  TICKET_STATUSES,
  TICKET_TRANSITIONS,
} from '../../../config/supportPolicy.js';
import { resolveStatusAfterMessage } from '../../../services/ticketService.js';
import { buildReplyTo, parseReplyTo } from '../../../services/supportEmailService.js';

describe('supportPolicy — state machine', () => {
  it('allows a ticket to stay where it is', () => {
    TICKET_STATUSES.forEach((s) => expect(canTransition(s, s)).toBe(true));
  });

  it('permits the documented forward moves', () => {
    expect(canTransition('new', 'open')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('pending_customer', 'open')).toBe(true);
  });

  it('permits reopening a resolved or closed ticket', () => {
    expect(canTransition('resolved', 'open')).toBe(true);
    expect(canTransition('closed', 'open')).toBe(true);
  });

  it('forbids resurrecting a closed ticket straight back to new', () => {
    // Allowing this would corrupt first-response metrics.
    expect(canTransition('closed', 'new')).toBe(false);
    expect(canTransition('resolved', 'new')).toBe(false);
    expect(canTransition('open', 'new')).toBe(false);
  });

  it('forbids jumping from closed to pending_customer', () => {
    expect(canTransition('closed', 'pending_customer')).toBe(false);
  });

  it('rejects unknown statuses', () => {
    expect(canTransition('new', 'bogus')).toBe(false);
    expect(canTransition('bogus', 'open')).toBe(false);
  });

  it('declares a transition list for every status', () => {
    TICKET_STATUSES.forEach((s) => expect(TICKET_TRANSITIONS[s]).toBeDefined());
  });
});

describe('supportPolicy — ticket references', () => {
  it('formats a sequence number', () => {
    expect(formatTicketRef(1042)).toBe('ABI-1042');
  });

  it('extracts a reference from a subject line', () => {
    expect(parseTicketRef('Re: Where is my order? [ABI-1042]')).toBe('ABI-1042');
    expect(parseTicketRef('ABI-7 follow up')).toBe('ABI-7');
  });

  it('is case-insensitive but normalises the prefix', () => {
    expect(parseTicketRef('re: [abi-99]')).toBe('ABI-99');
  });

  it('returns null when no reference is present', () => {
    expect(parseTicketRef('Where is my order?')).toBeNull();
    expect(parseTicketRef('')).toBeNull();
    expect(parseTicketRef(undefined)).toBeNull();
  });

  it('does not match a bare number or a different prefix', () => {
    expect(parseTicketRef('order 1042')).toBeNull();
    expect(parseTicketRef('XYZ-1042')).toBeNull();
  });
});

describe('ticketService — resolveStatusAfterMessage', () => {
  const base = { status: 'open', updatedAt: new Date() };
  const now = new Date('2026-08-04T10:00:00Z');

  it('moves a new ticket to open when the customer writes again', () => {
    expect(resolveStatusAfterMessage({ ...base, status: 'new' }, { fromCustomer: true, isAutoReply: false, now }))
      .toBe('open');
  });

  it('pulls a pending_customer ticket back to open on a customer reply', () => {
    expect(resolveStatusAfterMessage({ ...base, status: 'pending_customer' }, { fromCustomer: true, isAutoReply: false, now }))
      .toBe('open');
  });

  it('moves an open ticket to pending_customer when an agent replies', () => {
    expect(resolveStatusAfterMessage({ ...base, status: 'open' }, { fromCustomer: false, isAutoReply: false, now }))
      .toBe('pending_customer');
  });

  it('reopens a recently resolved ticket on a customer reply', () => {
    const ticket = { status: 'resolved', resolvedAt: new Date('2026-08-03T10:00:00Z') };
    expect(resolveStatusAfterMessage(ticket, { fromCustomer: true, isAutoReply: false, now }))
      .toBe('open');
  });

  it('does NOT reopen a ticket resolved outside the reopen window', () => {
    // A "thanks!" months later must not resurrect dead context; the caller opens
    // a fresh ticket instead.
    const ticket = { status: 'resolved', resolvedAt: new Date('2026-01-01T10:00:00Z') };
    expect(resolveStatusAfterMessage(ticket, { fromCustomer: true, isAutoReply: false, now }))
      .toBeNull();
  });

  it('ignores auto-replies entirely — this is the loop guard', () => {
    // An out-of-office must not count as a customer response.
    expect(resolveStatusAfterMessage({ ...base, status: 'pending_customer' }, { fromCustomer: true, isAutoReply: true, now }))
      .toBeNull();
    expect(resolveStatusAfterMessage({ status: 'resolved', resolvedAt: now }, { fromCustomer: true, isAutoReply: true, now }))
      .toBeNull();
  });

  it('leaves an on_hold ticket alone when the customer writes', () => {
    expect(resolveStatusAfterMessage({ ...base, status: 'on_hold' }, { fromCustomer: true, isAutoReply: false, now }))
      .toBeNull();
  });

  it('does not change a resolved ticket when an agent adds a public reply', () => {
    expect(resolveStatusAfterMessage({ ...base, status: 'resolved' }, { fromCustomer: false, isAutoReply: false, now }))
      .toBeNull();
  });
});

describe('supportEmailService — signed reply-to token', () => {
  // setupEnv provides a JWT_SECRET fallback; pin one so the suite is independent.
  const ORIGINAL = process.env.SUPPORT_REPLY_SECRET;
  beforeAll(() => { process.env.SUPPORT_REPLY_SECRET = 'test-support-secret'; });
  afterAll(() => { process.env.SUPPORT_REPLY_SECRET = ORIGINAL; });

  it('builds a plus-addressed reply address', () => {
    expect(buildReplyTo('ABI-1042')).toMatch(/\+t\.ABI-1042\.[a-f0-9]{16}@/);
  });

  it('round-trips a reference it signed', () => {
    expect(parseReplyTo(buildReplyTo('ABI-1042'))).toBe('ABI-1042');
  });

  it('rejects a forged signature', () => {
    // Without this check, anyone could post into any ticket by guessing ABI-nnnn.
    expect(parseReplyTo('support+t.ABI-9999.0000000000000000@autobacsindia.com')).toBeNull();
  });

  it('rejects a signature lifted from a different ticket', () => {
    const stolen = buildReplyTo('ABI-7').match(/\.([a-f0-9]{16})@/)[1];
    expect(parseReplyTo(`support+t.ABI-1042.${stolen}@autobacsindia.com`)).toBeNull();
  });

  it('rejects a truncated signature without throwing', () => {
    // timingSafeEqual throws on length mismatch, so this must be guarded.
    expect(parseReplyTo('support+t.ABI-1.abc@autobacsindia.com')).toBeNull();
  });

  it('returns null for an address with no token', () => {
    expect(parseReplyTo('support@autobacsindia.com')).toBeNull();
    expect(parseReplyTo('')).toBeNull();
  });

  it('issues distinct signatures per reference', () => {
    expect(buildReplyTo('ABI-1')).not.toBe(buildReplyTo('ABI-2'));
  });
});
