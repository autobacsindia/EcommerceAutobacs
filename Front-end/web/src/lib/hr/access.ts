/**
 * Who may open the /hr panel. The HR API enforces the same rule on every route
 * (middleware/hrAuth.js `hrOrAdmin`); this only decides what the layout renders,
 * so a person who would get 403s everywhere sees one friendly page instead.
 */
import type { HrViewer } from './types';

export const HR_TEAM = 'hr';

export type HrAccess = 'signin' | 'allowed' | 'denied';

export function hrAccessFor(user: HrViewer | null | undefined): HrAccess {
  if (!user) return 'signin';
  if (user.role === 'admin') return 'allowed';
  if (user.role === 'staff' && user.staff?.team === HR_TEAM) return 'allowed';
  return 'denied';
}
