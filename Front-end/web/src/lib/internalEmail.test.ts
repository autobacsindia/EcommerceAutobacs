import { displayEmail, isInternalEmail } from './internalEmail';

it('hides internal addresses behind a plain label', () => {
  expect(displayEmail('m9820917286@phone.autobacs.invalid')).toBe('No email (phone-only customer)');
  expect(displayEmail('midhun.operations@staff.autobacs.invalid')).toBe('Company login (no email)');
  expect(displayEmail('m9820917286@phone.autobacs.invalid', { label: false })).toBe('');
});

it('leaves real addresses alone', () => {
  expect(displayEmail('ravi@example.com')).toBe('ravi@example.com');
  expect(displayEmail(undefined)).toBe('');
  expect(isInternalEmail('ravi@example.com')).toBe(false);
  expect(isInternalEmail('x@phone.autobacs.invalid')).toBe(true);
});
