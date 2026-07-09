/**
 * Sales-rep authorization seam.
 *
 * The single source of truth for "can this user own or be assigned CRM leads?".
 * Today reps operate as admins and are flagged with `isSalesRep`. When the
 * role model is split (sales / ops / …), widen the rule HERE — every caller
 * (assignment guard, /leads/reps listing, reporting) goes through this helper,
 * so there is exactly one place to change. See ADR-006 (D4).
 */

export function isSalesRep(user) {
  return !!user?.isSalesRep;
}
