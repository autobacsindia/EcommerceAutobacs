/**
 * Frontend half of the cancellation-reason drift guard (backend half:
 * Back-end/server/tests/unit/config/cancellationReasons.test.js). The server only
 * accepts the codes in Back-end/server/config/cancellationReasons.js; a picker
 * offering anything else gets every such cancel refused.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ADMIN_CANCELLATION_REASONS, CANCELLATION_REASONS, cancellationReasonLabel } from './constants';

const BACKEND = join(__dirname, '..', '..', '..', '..', 'Back-end', 'server', 'config', 'cancellationReasons.js');

function backendCodes(name: string): string[] {
  const src = readFileSync(BACKEND, 'utf8');
  const block = src.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!block) throw new Error(`${name} not found in ${BACKEND}`);
  return [...block[1].matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
}

describe('cancellation reasons', () => {
  it('customer reasons match the server list', () => {
    expect(CANCELLATION_REASONS.map((r) => r.value)).toEqual(backendCodes('CUSTOMER_CANCELLATION_REASONS'));
  });

  it('admin reasons match the server list', () => {
    expect(ADMIN_CANCELLATION_REASONS.map((r) => r.value)).toEqual(backendCodes('ADMIN_CANCELLATION_REASONS'));
  });

  it('labels stored codes for display', () => {
    expect(cancellationReasonLabel('better_price')).toBe('Found a better price elsewhere');
    expect(cancellationReasonLabel('payment_failed')).toBe('Payment issues');
    expect(cancellationReasonLabel('payment_verified')).toBe('Payment verified');
    expect(cancellationReasonLabel(undefined)).toBe('');
  });
});
