/**
 * HR audit trail writer (models/hr/HrAuditLog.js). Every HR write calls
 * `recordHrAudit` — inside the same transaction session when the write uses one,
 * so a change and its audit row commit together or not at all.
 *
 * Sensitive values are masked HERE, so no caller can put a PAN, bank account,
 * UPI id, face template or salary figure of another person in clear text into
 * the log by forgetting to.
 */
import hrAuditRepository from '../../repositories/hr/hrAuditRepository.js';

// Fields whose values are never written to the log (only "changed").
const MASKED = new Set(['pan', 'panEnc', 'bankAccount', 'bank.accountEnc', 'upi', 'bank.upiEnc', 'templateEnc', 'aadhaar']);

export const maskValue = (field, value) => {
  if (value === null || value === undefined || value === '') return value ?? null;
  return MASKED.has(field) ? '••••' : value;
};

/** [{ field, from, to }] for the keys of `next` whose value differs from `prev`. */
export function diffFields(prev = {}, next = {}) {
  const changes = [];
  for (const field of Object.keys(next)) {
    const a = prev[field];
    const b = next[field];
    // A sensitive field that was written is always recorded (its values are masked,
    // so "set → set" would otherwise look like no change).
    if (!MASKED.has(field) && JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    changes.push({ field, from: maskValue(field, a), to: maskValue(field, b) });
  }
  return changes;
}

const actorOf = (actor) => ({
  actor: actor?._id || null,
  actorName: actor ? (actor.name || actor.email || 'user') : 'system',
});

export async function recordHrAudit({
  action, entity, entityId = null, subject = null, actor = null, reason = '', changes = [], req = null, session = null,
}) {
  const doc = {
    action, entity, entityId, subject, reason: String(reason || '').slice(0, 1000),
    changes: changes.map((c) => ({ ...c, from: maskValue(c.field, c.from), to: maskValue(c.field, c.to) })),
    requestId: req?.requestId || '',
    ...actorOf(actor),
  };
  return hrAuditRepository.append(doc, session);
}
