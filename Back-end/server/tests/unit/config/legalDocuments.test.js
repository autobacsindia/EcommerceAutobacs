/**
 * Backend half of the legal-version drift guard.
 *
 * This config is what stamps `Order.legalAcceptance.termsVersion` at order
 * creation, and it does so from server state ONLY — a client that could name its
 * own terms version could choose which contract to be bound by, which is not a
 * theoretical concern when §17B commits Enterprise buyers to arbitration seated
 * in Ernakulam.
 *
 * The mirrored guard is Front-end/web/src/lib/legal/legalVersions.test.ts. Both
 * halves exist because the CI triggers are asymmetric: ci.yml runs only on
 * `Back-end/server/**` and ci-frontend.yml only on `Front-end/web/**`. A guard
 * on one side alone never runs when the other side is what changed — and a
 * version bump here, with no frontend commit, is exactly the likely edit.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  LEGAL_DOCUMENTS,
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  buildAcceptanceSnapshot,
} from '../../../config/legalDocuments.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const FRONTEND_MIRROR = join(
  REPO, 'Front-end', 'web', 'src', 'lib', 'legal', 'legalVersions.ts'
);

/** Pull `version: '…'` out of a named entry in the frontend mirror. */
const frontendVersion = (key) => {
  const src = readFileSync(FRONTEND_MIRROR, 'utf8');
  const match = src.match(new RegExp(`${key}:\\s*\\{[\\s\\S]*?version:\\s*'([^']+)'`));
  if (!match) throw new Error(`no version found for "${key}" in ${FRONTEND_MIRROR}`);
  return match[1];
};

describe('legalDocuments config', () => {
  it('matches the frontend mirror', () => {
    expect(frontendVersion('terms')).toBe(CURRENT_TERMS_VERSION);
    expect(frontendVersion('privacy')).toBe(CURRENT_PRIVACY_VERSION);
  });

  it('every version has a committed snapshot of the text it names', () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      const snapshot = join(REPO, 'docs', 'legal', `${doc.key}-${doc.version}.md`);
      expect({ doc: doc.key, archived: existsSync(snapshot) })
        .toEqual({ doc: doc.key, archived: true });
    }
  });

  it('is frozen, so no import can mutate a version at runtime', () => {
    expect(Object.isFrozen(LEGAL_DOCUMENTS)).toBe(true);
    expect(Object.isFrozen(LEGAL_DOCUMENTS.terms)).toBe(true);
    expect(() => { LEGAL_DOCUMENTS.terms.version = '1999-01-01'; }).toThrow();
    expect(LEGAL_DOCUMENTS.terms.version).toBe(CURRENT_TERMS_VERSION);
  });

  describe('buildAcceptanceSnapshot', () => {
    it('takes its versions from server config, never from a caller', () => {
      // The signature deliberately has no version parameter. This asserts the
      // absence: a snapshot built with attacker-controlled extras still records
      // the server's own versions.
      const snap = buildAcceptanceSnapshot({
        track: 'enterprise',
        termsVersion: '1999-01-01',
        privacyVersion: '1999-01-01',
      });
      expect(snap.termsVersion).toBe(CURRENT_TERMS_VERSION);
      expect(snap.privacyVersion).toBe(CURRENT_PRIVACY_VERSION);
    });

    it('records the track, because 17A and 17B are different contracts', () => {
      expect(buildAcceptanceSnapshot({ track: 'consumer' }).track).toBe('consumer');
      expect(buildAcceptanceSnapshot({ track: 'enterprise' }).track).toBe('enterprise');
    });

    it('defaults acceptedAt to now and omits ipHash when absent', () => {
      const before = Date.now();
      const snap = buildAcceptanceSnapshot({ track: 'consumer' });
      expect(snap.acceptedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(snap).not.toHaveProperty('ipHash');
    });

    it('carries ipHash through when supplied', () => {
      expect(buildAcceptanceSnapshot({ track: 'consumer', ipHash: 'abc123' }).ipHash).toBe('abc123');
    });
  });
});
