/**
 * After-hours auto-reply on support email ("Nothing Extra", 2026-11-23).
 * Hours: the published support hours, Mon–Sat 10 am – 6 pm IST, plus SUPPORT_HOLIDAYS. One note per ticket per closed stretch;
 * never to auto-replies, no-reply senders or our own address. Email sending is a
 * stub — nothing real is sent.
 */
import { jest } from '@jest/globals';

const mockSendEmail = jest.fn();
const mockClaim = jest.fn();
const mockRelease = jest.fn();
const mockAddMessage = jest.fn();
const mockSlot = jest.fn();
const mockFindMessages = jest.fn();

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendEmail: mockSendEmail } }));
jest.unstable_mockModule('../../../services/ticketService.js', () => ({
  default: { claimOutboundSlot: mockSlot, addMessage: mockAddMessage },
}));
jest.unstable_mockModule('../../../repositories/supportTicketRepository.js', () => ({
  default: { claimEmailKey: mockClaim, releaseEmailKey: mockRelease },
}));
jest.unstable_mockModule('../../../repositories/supportMessageRepository.js', () => ({ default: { find: mockFindMessages } }));

const { isWithinSupportHours, nextOpeningDay, afterHoursKey, SUPPORT_HOURS_TEXT } = await import('../../../config/supportHours.js');
const { followUpInbound, sendAfterHoursReply, sendAcknowledgement, AFTER_HOURS_LINES, ACK_LINES } =
  await import('../../../services/supportEmailService.js');

// India time → Date. 2026-11-25 is a Wednesday; 2026-11-28 Saturday; 2026-11-29 Sunday.
const ist = (s) => new Date(`${s}+05:30`);

const PROMISES = [
  /dispatch/i, /deliver(ed|y) (by|on|today|tomorrow)/i, /estimated/i, /business days/i,
  /\b(today|tomorrow)\b/i, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /₹|\brs\.?\s?\d/i, /in stock|out of stock/i,
];

let claimed;
let tickets;
const ticket = (over = {}) => ({
  _id: 't1', reference: 'ABI-1042', subject: 'Where is my order',
  requester: { name: 'Sunny', email: 'c@example.com' }, ...over,
});
const load = async (ref) => tickets[ref] ?? null;
const reply = (over = {}) => ({
  status: 'processed', ticket: 'ABI-1042', created: false, isAutoReply: false,
  shouldAcknowledge: false, fromEmail: 'c@example.com', receivedAt: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  claimed = new Set();
  tickets = { 'ABI-1042': ticket() };
  mockClaim.mockImplementation(async (_id, key) => (claimed.has(key) ? false : (claimed.add(key), true)));
  mockRelease.mockImplementation(async (_id, key) => { claimed.delete(key); });
  mockSlot.mockResolvedValue({ allowed: true, count: 1 });
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'pm-1' });
  mockAddMessage.mockResolvedValue({});
  mockFindMessages.mockResolvedValue([]);
});

describe('support hours (IST) — the published BUSINESS_HOURS', () => {
  it.each([
    ['2026-11-25T09:59:00', false], ['2026-11-25T10:00:00', true], ['2026-11-25T17:59:00', true],
    ['2026-11-25T18:00:00', false], ['2026-11-28T12:00:00', true], ['2026-11-29T12:00:00', false],
  ])('%s → open %s', (t, open) => expect(isWithinSupportHours(ist(t), [])).toBe(open));

  it('a holiday counts as closed', () => {
    expect(isWithinSupportHours(ist('2026-11-25T12:00:00'), ['2026-11-25'])).toBe(false);
    expect(nextOpeningDay(ist('2026-11-24T19:00:00'), ['2026-11-25'])).toBe('2026-11-26');
  });

  it('one closed stretch maps to one key: the day we next open', () => {
    expect(nextOpeningDay(ist('2026-11-25T19:00:00'), [])).toBe('2026-11-26');
    expect(nextOpeningDay(ist('2026-11-26T02:00:00'), [])).toBe('2026-11-26');
    expect(nextOpeningDay(ist('2026-11-28T19:00:00'), [])).toBe('2026-11-30'); // Sat night → Mon
    expect(nextOpeningDay(ist('2026-11-29T12:00:00'), [])).toBe('2026-11-30'); // Sunday → Mon
    expect(nextOpeningDay(ist('2026-11-30T08:00:00'), [])).toBe('2026-11-30');
  });

  it('uses India time whatever the server clock zone (12:30 UTC = 18:00 IST)', () => {
    expect(isWithinSupportHours(new Date('2026-11-25T12:30:00Z'), [])).toBe(false);
    expect(isWithinSupportHours(new Date('2026-11-25T12:29:00Z'), [])).toBe(true);
  });

  it('customer text names the hours, no weekday names', () => {
    expect(SUPPORT_HOURS_TEXT).toBe('10 am to 6 pm India time, six days a week');
  });
});

describe('followUpInbound', () => {
  const NIGHT = ist('2026-11-25T22:00:00');

  it('a customer reply at night → one after-hours note, Auto-Submitted, no promises', async () => {
    await expect(followUpInbound(reply(), load, { now: NIGHT })).resolves.toEqual({ sent: 'after_hours', reason: undefined });
    const mail = mockSendEmail.mock.calls[0][0];
    expect(mail.to).toBe('c@example.com');
    expect(mail.headers['Auto-Submitted']).toBe('auto-generated');
    expect(mail.text).toContain(AFTER_HOURS_LINES.body);
    for (const re of PROMISES) {
      expect(mail.text).not.toMatch(re);
      expect(mail.html).not.toMatch(re);
      expect(mail.subject).not.toMatch(re);
    }
  });

  it('several mails the same night → still one note; the next night → one more', async () => {
    await followUpInbound(reply(), load, { now: NIGHT });
    await followUpInbound(reply(), load, { now: ist('2026-11-26T03:00:00') });
    await followUpInbound(reply(), load, { now: ist('2026-11-26T09:45:00') });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    await followUpInbound(reply(), load, { now: ist('2026-11-26T20:00:00') });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('a queue retry of the same job → one email (once-only key)', async () => {
    await followUpInbound(reply(), load, { now: NIGHT });
    await expect(followUpInbound(reply(), load, { now: NIGHT })).resolves.toEqual({ sent: null, reason: 'already_sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('during working hours → nothing', async () => {
    await expect(followUpInbound(reply(), load, { now: ist('2026-11-25T11:00:00') })).resolves.toMatchObject({ reason: 'open' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('never answers an auto-reply / no-reply / bounce (processInbound flags them)', async () => {
    await expect(followUpInbound(reply({ isAutoReply: true }), load, { now: NIGHT })).resolves.toMatchObject({ reason: 'auto_reply' });
    await expect(followUpInbound(reply({ isAutoReply: true, shouldAcknowledge: true, created: true }), load, { now: NIGHT }))
      .resolves.toMatchObject({ reason: 'auto_reply' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('never answers our own support address', async () => {
    const prev = process.env.SUPPORT_EMAIL;
    const own = 'support@autobacsindia.com';
    process.env.SUPPORT_EMAIL = own;
    try {
    await expect(followUpInbound(reply({ fromEmail: own.toUpperCase() }), load, { now: NIGHT })).resolves.toMatchObject({ reason: 'own_address' });
    tickets['ABI-1042'] = ticket({ requester: { name: 'x', email: own } });
    await expect(followUpInbound(reply(), load, { now: NIGHT })).resolves.toMatchObject({ reason: 'own_address' });
    expect(mockSendEmail).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SUPPORT_EMAIL; else process.env.SUPPORT_EMAIL = prev;
    }
  });

  it('a backlog processed after we opened → no "we are offline" note', async () => {
    const r = reply({ receivedAt: ist('2026-11-25T22:00:00') });
    await expect(followUpInbound(r, load, { now: ist('2026-11-26T19:00:00') })).resolves.toMatchObject({ reason: 'stale' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('not processed (spam/rejected) → nothing', async () => {
    await expect(followUpInbound({ status: 'spam' }, load, { now: NIGHT })).resolves.toMatchObject({ reason: 'not_processed' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a NEW ticket at night → ONE email: the acknowledgement carrying the after-hours line', async () => {
    const r = reply({ created: true, shouldAcknowledge: true });
    await expect(followUpInbound(r, load, { now: NIGHT })).resolves.toMatchObject({ sent: 'ack' });
    // A follow-up mail the same night gets no second note.
    await followUpInbound(reply(), load, { now: ist('2026-11-25T23:00:00') });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const { text } = mockSendEmail.mock.calls[0][0];
    expect(text).toContain(ACK_LINES.body);
    expect(text).toContain(AFTER_HOURS_LINES.body);
  });

  it('a NEW ticket during hours → the plain acknowledgement, no after-hours line', async () => {
    await sendAcknowledgement(ticket(), { now: ist('2026-11-25T11:00:00') });
    expect(mockSendEmail.mock.calls[0][0].text).not.toContain(AFTER_HOURS_LINES.body);
  });

  it('a failed send throws for the retry and releases tonight\'s key', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'zepto 503' });
    await expect(sendAfterHoursReply(ticket(), { now: NIGHT })).rejects.toThrow(/zepto 503/);
    expect(mockRelease).toHaveBeenCalledWith('t1', afterHoursKey(NIGHT));
    await expect(sendAfterHoursReply(ticket(), { now: NIGHT })).resolves.toMatchObject({ sent: true });
  });

  it('the fixed copy carries no promises', () => {
    for (const line of Object.values(AFTER_HOURS_LINES)) for (const re of PROMISES) expect(line).not.toMatch(re);
  });
});
