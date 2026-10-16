import { isInternalEmail, phoneOnlyEmailFor, publicEmail } from '../../../utils/customerContact.js';

it('derives a stable internal address from a mobile number', () => {
  expect(phoneOnlyEmailFor('9845012345')).toBe('m9845012345@phone.autobacs.invalid');
  expect(phoneOnlyEmailFor(' 9845012345 ')).toBe('m9845012345@phone.autobacs.invalid');
});

it('refuses to make one without a valid mobile', () => {
  for (const p of ['', '12345', '5845012345', undefined]) expect(() => phoneOnlyEmailFor(p)).toThrow(/mobile/);
});

it('recognises internal addresses and never shows them', () => {
  expect(isInternalEmail('m9845012345@phone.autobacs.invalid')).toBe(true);
  expect(isInternalEmail('ravi@staff.autobacs.invalid')).toBe(true);
  expect(isInternalEmail('ravi@example.com')).toBe(false);
  expect(publicEmail('m9845012345@phone.autobacs.invalid')).toBe('');
  expect(publicEmail('ravi@example.com')).toBe('ravi@example.com');
  expect(publicEmail(undefined)).toBe('');
});
