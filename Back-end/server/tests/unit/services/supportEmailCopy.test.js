/**
 * Support emails: wording guardrails + once-only sends.
 *
 * The acknowledgement must read as a plain "we're on it" with a Track Order link —
 * never a dispatch/delivery date (the 1 Nov "dispatched today, Monday" email sent
 * on a Sunday is the failure this guards). And each email is sent once: a BullMQ
 * retry or a double-click must not mail the customer twice.
 */

import { jest } from '@jest/globals';

const mockSendEmail = jest.fn();
const mockClaim = jest.fn();
const mockRelease = jest.fn();
const mockAddMessage = jest.fn();
const mockSlot = jest.fn();
const mockFindMessages = jest.fn();

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendEmail: mockSendEmail },
}));
jest.unstable_mockModule('../../../services/ticketService.js', () => ({
  default: { claimOutboundSlot: mockSlot, addMessage: mockAddMessage },
}));
jest.unstable_mockModule('../../../repositories/supportTicketRepository.js', () => ({
  default: { claimEmailKey: mockClaim, releaseEmailKey: mockRelease },
}));
jest.unstable_mockModule('../../../repositories/supportMessageRepository.js', () => ({
  default: { find: mockFindMessages },
}));

const svc = await import('../../../services/supportEmailService.js');
const { sendAcknowledgement, sendAgentReply, ACK_LINES } = svc;

const PROMISES = [
  /dispatch/i, /deliver(ed|y) (by|on|today|tomorrow)/i, /estimated/i, /business days/i,
  /\b(today|tomorrow)\b/i, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /₹|\brs\.?\s?\d/i, /in stock|out of stock/i,
];

const ticket = () => ({
  _id: 't1', reference: 'ABI-1042', subject: 'Where is my order',
  requester: { name: 'Sunny', email: 'c@example.com' },
});

// Keys claimed so far — a tiny in-memory stand-in for the atomic $push claim.
let claimed;
const ORIGINAL = process.env.FRONTEND_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://shop.example.com';
  claimed = new Set();
  mockClaim.mockImplementation(async (_id, key) => (claimed.has(key) ? false : (claimed.add(key), true)));
  mockRelease.mockImplementation(async (_id, key) => { claimed.delete(key); });
  mockSlot.mockResolvedValue({ allowed: true, count: 1 });
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'pm-1' });
  mockAddMessage.mockResolvedValue({});
  mockFindMessages.mockResolvedValue([]);
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL;
});

describe('acknowledgement wording', () => {
  test('is the plain "we\'re on it" message with the Track Order link, and no promises', async () => {
    await sendAcknowledgement(ticket());
    const { text, html, subject } = mockSendEmail.mock.calls[0][0];

    expect(text).toContain(ACK_LINES.body);
    expect(text).toContain('https://shop.example.com/track');
    expect(html).toContain('href="https://shop.example.com/track"');
    expect(html).toContain('Track your order');
    for (const re of PROMISES) {
      expect(text).not.toMatch(re);
      expect(html).not.toMatch(re);
      expect(subject).not.toMatch(re);
    }
  });

  test('the fixed copy itself carries no promises', () => {
    for (const line of Object.values(ACK_LINES)) {
      for (const re of PROMISES) expect(line).not.toMatch(re);
    }
  });

  test('omits the link rather than guessing a host when FRONTEND_URL is unset', async () => {
    delete process.env.FRONTEND_URL;
    await sendAcknowledgement(ticket());
    const { text, html } = mockSendEmail.mock.calls[0][0];
    expect(text).not.toContain('/track');
    expect(html).not.toContain('/track');
  });
});

describe('once-only sends', () => {
  test('acknowledgement: same ticket twice → one email', async () => {
    await expect(sendAcknowledgement(ticket())).resolves.toMatchObject({ sent: true });
    await expect(sendAcknowledgement(ticket())).resolves.toEqual({ sent: false, reason: 'already_sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockAddMessage).toHaveBeenCalledTimes(1);
  });

  test('agent reply: the same queue job retried → one email; a different job → a second email', async () => {
    await sendAgentReply(ticket(), 'Your parcel is with the courier.', { name: 'Asha' }, { onceKey: 'reply:42' });
    await sendAgentReply(ticket(), 'Your parcel is with the courier.', { name: 'Asha' }, { onceKey: 'reply:42' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    await sendAgentReply(ticket(), 'Follow-up.', { name: 'Asha' }, { onceKey: 'reply:43' });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  test('agent reply carries the Track Order link under the agent\'s own words', async () => {
    await sendAgentReply(ticket(), 'Thanks, checking now.', { name: 'Asha' }, { onceKey: 'reply:1' });
    const { text } = mockSendEmail.mock.calls[0][0];
    expect(text).toContain('Thanks, checking now.');
    expect(text).toContain('https://shop.example.com/track');
  });

  test('a provider failure throws (so the queue retries), releases the key, records nothing — and the retry sends once', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'zepto 503' });
    await expect(sendAcknowledgement(ticket())).rejects.toThrow(/zepto 503/);
    expect(mockRelease).toHaveBeenCalledWith('t1', 'ack');
    expect(mockAddMessage).not.toHaveBeenCalled();

    await expect(sendAcknowledgement(ticket())).resolves.toMatchObject({ sent: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockAddMessage).toHaveBeenCalledTimes(1);
  });

  test('a failed thread record after a successful send does not throw (a throw would re-send)', async () => {
    mockAddMessage.mockRejectedValueOnce(new Error('mongo blip'));
    await expect(sendAcknowledgement(ticket())).resolves.toMatchObject({ sent: true });
  });

  test('loop guard still suppresses, without sending', async () => {
    mockSlot.mockResolvedValueOnce({ allowed: false, count: 9 });
    await expect(sendAcknowledgement(ticket())).resolves.toEqual({ sent: false, reason: 'loop_guard' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('there is no "ticket resolved" email any more', () => {
    expect(svc.sendResolutionNotice).toBeUndefined();
    expect(svc.default.sendResolutionNotice).toBeUndefined();
  });
});
