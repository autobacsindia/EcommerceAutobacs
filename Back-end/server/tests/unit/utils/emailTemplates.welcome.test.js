/**
 * The welcome email: the customer's name is the only user input, so it must be
 * escaped wherever it lands (headline, preheader); every link points at the live
 * store; and an account without a name still gets a sensible subject.
 */
import { welcomeEmail } from '../../../utils/emailTemplates.js';

describe('welcomeEmail', () => {
  test('greets by first name in the subject, headline and plain text', () => {
    const { subject, html, text } = welcomeEmail({ name: 'Asha Rao' });
    expect(subject).toBe('Welcome to Autobacs India, Asha 🎉');
    expect(html).toContain('Welcome aboard, Asha');
    expect(text).toMatch(/^Hi Asha,/);
  });

  test('without a name: a plain subject and "there" in the greeting', () => {
    const { subject, html } = welcomeEmail({});
    expect(subject).toBe('Welcome to Autobacs India 🎉');
    expect(html).toContain('Welcome aboard, there');
  });

  test('escapes the name everywhere it is rendered', () => {
    const { html } = welcomeEmail({ name: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  test('links go to the live store: garage, products, consultation', () => {
    const { html, text } = welcomeEmail({ name: 'Asha' });
    expect(html).toContain('href="https://www.autobacsindia.com/account/garage"');
    expect(html).toContain('href="https://www.autobacsindia.com/products"');
    expect(html).toContain('href="https://www.autobacsindia.com/consultation"');
    expect(html).toContain('src="https://www.autobacsindia.com/images/roavion-logo.png"');
    expect(text).toContain('https://www.autobacsindia.com/account/garage');
    expect(html).not.toMatch(/localhost|railway\.app/);
  });

  test('lists the right inbox for each kind of question', () => {
    const { html, text } = welcomeEmail({ name: 'Asha' });
    for (const addr of ['info@autobacsindia.com', 'support@autobacsindia.com', 'grievance@autobacsindia.com']) {
      expect(html).toContain(`mailto:${addr}`);
      expect(text).toContain(addr);
    }
    expect(html).toContain('Roavion Automotive Pvt. Ltd.');
  });

  test('a siteUrl override is used without a trailing slash', () => {
    const { html } = welcomeEmail({ name: 'Asha', siteUrl: 'https://autobacsindia.com/' });
    expect(html).toContain('href="https://autobacsindia.com/account/garage"');
  });
});
