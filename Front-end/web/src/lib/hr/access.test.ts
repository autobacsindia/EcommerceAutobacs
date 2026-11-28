/** The /hr role gate: HR team and admin get in; everyone else gets the friendly page. */
import { hrAccessFor } from './access';

describe('hrAccessFor', () => {
  it('asks a signed-out visitor to sign in', () => {
    expect(hrAccessFor(null)).toBe('signin');
    expect(hrAccessFor(undefined)).toBe('signin');
  });

  it('lets admin in (admins have no staff team)', () => {
    expect(hrAccessFor({ role: 'admin', staff: null })).toBe('allowed');
  });

  it('lets HR-team staff in, head or not', () => {
    expect(hrAccessFor({ role: 'staff', staff: { team: 'hr' } })).toBe('allowed');
    expect(hrAccessFor({ role: 'staff', staff: { team: 'hr', isHead: true } })).toBe('allowed');
  });

  it('keeps other teams out, including their heads', () => {
    expect(hrAccessFor({ role: 'staff', staff: { team: 'sales' } })).toBe('denied');
    expect(hrAccessFor({ role: 'staff', staff: { team: 'accounts', isHead: true } })).toBe('denied');
  });

  it('keeps out staff with no team and customers who somehow carry an hr team', () => {
    expect(hrAccessFor({ role: 'staff', staff: null })).toBe('denied');
    expect(hrAccessFor({ role: 'customer', staff: { team: 'hr' } })).toBe('denied');
    expect(hrAccessFor({})).toBe('denied');
  });
});
