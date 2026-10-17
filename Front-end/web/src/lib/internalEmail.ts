/**
 * Internal `.invalid` addresses (RFC 2606) — never shown to a person.
 *
 * Every account needs a unique email, but two kinds of account have none, so the
 * API gives them an internal one that can never receive mail
 * (Back-end/server/utils/customerContact.js, config/staff.js):
 *   m9820917286@phone.autobacs.invalid   a customer who gave only a mobile number
 *   midhun.operations@staff.autobacs.invalid   a staff member's company login
 * They are correct and needed in the database; on screen they read as a label.
 */
export const isInternalEmail = (email?: string | null) => /@[^@\s]+\.invalid$/i.test(String(email ?? '').trim());

/** What to show where an email would be: the address, a label, or '' (nothing). */
export function displayEmail(email?: string | null, { label = true }: { label?: boolean } = {}): string {
  const e = String(email ?? '').trim();
  if (!isInternalEmail(e)) return e;
  if (!label) return '';
  return /@staff\.autobacs\.invalid$/i.test(e) ? 'Company login (no email)' : 'No email (phone-only customer)';
}
