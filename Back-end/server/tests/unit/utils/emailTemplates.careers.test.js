/**
 * Smoke tests for the two candidate-facing careers email templates.
 * Pure functions — assert they render, interpolate name/role, escape HTML, and
 * carry the required copy ("received"/"shortlisted"; the verbatim rejection text).
 */

import { careersAcknowledgementEmail, careersRejectionEmail } from '../../../utils/emailTemplates.js';

const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };

describe('careersAcknowledgementEmail', () => {
  const out = careersAcknowledgementEmail({
    application: { fullName: 'Asha K', roleTitle: 'Marketing Manager' },
    company,
  });

  test('subject + body confirm receipt and set the shortlist expectation', () => {
    expect(out.subject).toMatch(/received your application/i);
    expect(out.text).toMatch(/received your application/i);
    expect(out.text).toMatch(/notified if your application is shortlisted/i);
    expect(out.html).toContain('Asha K');
    expect(out.html).toContain('Marketing Manager');
    expect(out.html).toMatch(/© \d{4} Autobacs India/);
  });
});

describe('careersRejectionEmail', () => {
  test('fills candidate name + position and includes the HR closing', () => {
    const out = careersRejectionEmail({
      application: { fullName: 'Asha K', roleTitle: 'Marketing Manager' },
      company,
    });
    expect(out.text).toMatch(/^Dear Asha K,/);
    expect(out.text).toMatch(/not been selected to proceed to the interview stage for the Marketing Manager position/);
    expect(out.text).toMatch(/Human Resources Department/);
    expect(out.text).toMatch(/Human Resources Department\nAutobacs India/);
    expect(out.text + out.html).not.toMatch(/roavion/i);
    expect(out.html).toContain('Marketing Manager');
  });

  test('HTML-escapes a hostile candidate name (no raw tag injection)', () => {
    const out = careersRejectionEmail({
      application: { fullName: '<script>x</script>', roleTitle: 'Ops' },
      company,
    });
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('careersReplyEmail', () => {
  test('keeps HR\'s text, escapes HTML, and keeps paragraphs + line breaks', async () => {
    const { careersReplyEmail } = await import('../../../utils/emailTemplates.js');
    const out = careersReplyEmail({ subject: 'Interview', message: 'Hi <b>there</b>,\nLine two\n\nPara two' });
    expect(out.subject).toBe('Interview');
    expect(out.text).toBe('Hi <b>there</b>,\nLine two\n\nPara two');
    expect(out.html).toContain('Hi &lt;b&gt;there&lt;/b&gt;,<br>Line two');
    expect(out.html).toContain('>Para two</p>');
    expect(out.html).not.toContain('<b>there</b>');
  });
});
