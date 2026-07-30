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
    expect(out.html).toMatch(/ROAVION Automotive Private Limited/);
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
    expect(out.text).toMatch(/ROAVION Automotive Private Limited/);
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
