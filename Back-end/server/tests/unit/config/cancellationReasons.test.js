/**
 * Backend half of the cancellation-reason drift guard.
 *
 * config/cancellationReasons.js is the list orderStatusService ACCEPTS; the cancel
 * screens pick from the mirror in Front-end/web/src/lib/constants.ts. They drifted
 * once and every cancel with the odd reason out was refused. The mirrored guard is
 * Front-end/web/src/lib/cancellationReasons.test.ts — both halves exist because
 * ci.yml runs only on `Back-end/server/**` and ci-frontend.yml only on `Front-end/web/**`.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  CUSTOMER_CANCELLATION_REASONS,
  ADMIN_CANCELLATION_REASONS,
  CANCELLATION_REASON_CODES,
  cancellationReasonLabel,
} from '../../../config/cancellationReasons.js';
import { TRANSITION_REASONS } from '../../../services/orderStatusService.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const FRONTEND_MIRROR = join(REPO, 'Front-end', 'web', 'src', 'lib', 'constants.ts');

/** The `value:` codes inside `export const <name> = [ ... ]` of the frontend file. */
function frontendCodes(name) {
  const src = readFileSync(FRONTEND_MIRROR, 'utf8');
  const block = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!block) throw new Error(`${name} not found in ${FRONTEND_MIRROR}`);
  return [...block[1].matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
}

describe('cancellation reasons', () => {
  it.each([
    ['CANCELLATION_REASONS', CUSTOMER_CANCELLATION_REASONS],
    ['ADMIN_CANCELLATION_REASONS', ADMIN_CANCELLATION_REASONS],
  ])('frontend %s matches the backend list', (name, list) => {
    expect(frontendCodes(name)).toEqual(list.map((r) => r.value));
  });

  it.each([
    ['customer', CUSTOMER_CANCELLATION_REASONS],
    ['admin', ADMIN_CANCELLATION_REASONS],
  ])('every %s reason has a unique code', (_who, list) => {
    const values = list.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('the status service accepts every reason any screen offers', () => {
    for (const r of [...CUSTOMER_CANCELLATION_REASONS, ...ADMIN_CANCELLATION_REASONS]) {
      expect(TRANSITION_REASONS.cancelled).toContain(r.value);
    }
    expect(TRANSITION_REASONS.cancelled).toEqual(CANCELLATION_REASON_CODES);
  });

  it('labels known codes and passes unknown ones through', () => {
    expect(cancellationReasonLabel('payment_failed')).toBe('Payment issues');
    expect(cancellationReasonLabel('changed_mind')).toBe('Changed my mind');
    expect(cancellationReasonLabel('something_else')).toBe('something_else');
    expect(cancellationReasonLabel(undefined)).toBe('');
  });
});
