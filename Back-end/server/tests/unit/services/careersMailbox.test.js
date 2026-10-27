/**
 * The careers mailbox receives employment email only (utils/careersMailbox.js),
 * enforced in emailHandler.sendEmail — the one place every email passes.
 *
 * What must hold:
 *   - store email (no purpose) to the careers mailbox is never handed to Postmark,
 *     whichever variable names it, in any letter case — and it is not retryable
 *   - careers email (purpose 'careers') still reaches it
 *   - candidates still get their acknowledgement and rejection emails
 *   - nothing is blocked when no careers mailbox is configured
 */

import { jest } from '@jest/globals';

const { default: emailHandler } = await import('../../../services/emailHandler.js');
const { careersAlertRecipients, careersMailboxes, isCareersMailbox } = await import('../../../utils/careersMailbox.js');

let fakeClient;
beforeEach(() => {
  delete process.env.CAREERS_NOTIFICATION_EMAILS;
  delete process.env.CAREERS_FROM_EMAIL;
  delete process.env.EMAIL_REDIRECT_TO;
  fakeClient = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'm-1' }) };
  emailHandler.client = fakeClient;
  emailHandler.isEnabled = true;
  emailHandler.fromEmail = 'noreply@autobacsindia.com';
  emailHandler.fromName = 'Autobacs India';
  emailHandler.defaultStream = 'outbound';
});

describe('the careers mailbox', () => {
  test('store email to it is refused before Postmark — named by either variable, any case', async () => {
    process.env.CAREERS_NOTIFICATION_EMAILS = 'careers@autobacsindia.com';
    process.env.CAREERS_FROM_EMAIL = 'jobs@autobacsindia.com';

    for (const to of ['careers@autobacsindia.com', 'Careers@AutobacsIndia.com', ' jobs@autobacsindia.com ']) {
      const res = await emailHandler.sendEmail({ to, subject: 'Overdue orders — 3 waiting', text: 'x' });
      expect(res).toMatchObject({ success: false, skipped: true, retryable: false });
    }
    expect(fakeClient.sendEmail).not.toHaveBeenCalled();
  });

  test('careers email still reaches it', async () => {
    process.env.CAREERS_FROM_EMAIL = 'careers@autobacsindia.com';
    const res = await emailHandler.sendEmail({ to: 'careers@autobacsindia.com', subject: 'New job application', text: 'x', purpose: 'careers' });
    expect(res.success).toBe(true);
    expect(fakeClient.sendEmail.mock.calls[0][0].To).toBe('careers@autobacsindia.com');
  });

  test('other inboxes are untouched', async () => {
    process.env.CAREERS_FROM_EMAIL = 'careers@autobacsindia.com';
    const res = await emailHandler.sendEmail({ to: 'info@autobacsindia.com', subject: 'Overdue orders', text: 'x' });
    expect(res.success).toBe(true);
  });

  test('nothing is blocked when no careers mailbox is configured', async () => {
    const res = await emailHandler.sendEmail({ to: 'careers@autobacsindia.com', subject: 'Overdue orders', text: 'x' });
    expect(res.success).toBe(true);
    expect(careersMailboxes().size).toBe(0);
    expect(careersAlertRecipients()).toEqual([]);
  });

  test('candidates still get their acknowledgement and rejection, sent from the careers address', async () => {
    process.env.CAREERS_FROM_EMAIL = 'careers@autobacsindia.com';
    const application = { fullName: 'Nikhil R', roleTitle: 'Service Advisor' };

    expect((await emailHandler.sendCareersAcknowledgement({ to: 'nikhil@example.com', application })).success).toBe(true);
    expect((await emailHandler.sendCareersRejection({ to: 'nikhil@example.com', application })).success).toBe(true);
    const sent = fakeClient.sendEmail.mock.calls.map(([m]) => m);
    expect(sent.map((m) => m.To)).toEqual(['nikhil@example.com', 'nikhil@example.com']);
    expect(sent.every((m) => m.From.includes('careers@autobacsindia.com'))).toBe(true);
  });

  test('alert recipients: the explicit list wins, else the careers sender; de-duplicated, lower-cased', () => {
    process.env.CAREERS_FROM_EMAIL = 'jobs@autobacsindia.com';
    expect(careersAlertRecipients()).toEqual(['jobs@autobacsindia.com']);
    process.env.CAREERS_NOTIFICATION_EMAILS = 'Careers@autobacsindia.com, careers@autobacsindia.com,, hr@autobacsindia.com';
    expect(careersAlertRecipients()).toEqual(['careers@autobacsindia.com', 'hr@autobacsindia.com']);
    expect(isCareersMailbox('JOBS@autobacsindia.com')).toBe(true); // still employment-only
    expect(isCareersMailbox('')).toBe(false);
  });
});
