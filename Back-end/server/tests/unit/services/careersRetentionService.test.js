/**
 * Unit tests — services/careersRetentionService.js
 *
 * This deletes applicants' videos and CVs permanently (Cloudinary backup is off
 * on this account), so the tests are weighted toward everything that must SPARE
 * an application rather than the happy path:
 *   - anything not rejected, or already purged;
 *   - an undeterminable retention clock;
 *   - a partially failed delete, which must NOT clear the refs — dropping the
 *     pointer to a surviving asset makes it permanently unreachable, because the
 *     application still owns its folder so the abandoned-folder sweep skips it.
 */
import { jest } from '@jest/globals';
import {
  DEFAULT_RETENTION_DAYS, retentionClock, daysSince, isDue, filesOf,
  selectDue, purgeApplicationMedia, summarise,
} from '../../../services/careersRetentionService.js';

const DAY = 86400000;
const NOW = new Date('2026-09-01T00:00:00Z').getTime();
const ago = (d) => new Date(NOW - d * DAY);

const app = (over = {}) => ({
  _id: 'a1',
  fullName: 'Test Person',
  email: 'test@example.com',
  status: 'rejected',
  rejectedAt: ago(30),
  mediaPurgedAt: null,
  files: {
    videoOne: { publicId: 'autobacs/careers/n/v1', resourceType: 'video', bytes: 10 * 1048576 },
    resume:   { publicId: 'autobacs/careers/n/cv.pdf', resourceType: 'raw', bytes: 1048576 },
  },
  ...over,
});

describe('retentionClock', () => {
  test('prefers the explicit rejectedAt stamp', () => {
    const a = app({ rejectedAt: ago(5), rejectionEmailedAt: ago(20), updatedAt: ago(1) });
    expect(retentionClock(a)).toEqual(ago(5));
  });

  test('falls back to rejectionEmailedAt for pre-existing rejections', () => {
    const a = app({ rejectedAt: null, rejectionEmailedAt: ago(20), updatedAt: ago(1) });
    expect(retentionClock(a)).toEqual(ago(20));
  });

  test('falls back to updatedAt when neither stamp exists', () => {
    const a = app({ rejectedAt: null, rejectionEmailedAt: null, updatedAt: ago(9) });
    expect(retentionClock(a)).toEqual(ago(9));
  });

  test('returns null for an application that is not rejected', () => {
    expect(retentionClock(app({ status: 'reviewing' }))).toBeNull();
  });
});

describe('isDue — the guards that spare an application', () => {
  const opts = { now: NOW };

  test('is due when rejected longer ago than the window and media remains', () => {
    expect(isDue(app({ rejectedAt: ago(15) }), opts)).toBe(true);
  });

  test.each(['new', 'reviewing', 'shortlisted', 'hired'])('is NOT due when status is %s', (status) => {
    expect(isDue(app({ status, rejectedAt: ago(90) }), opts)).toBe(false);
  });

  test('is NOT due exactly ON the boundary — the window must ELAPSE', () => {
    expect(isDue(app({ rejectedAt: ago(DEFAULT_RETENTION_DAYS) }), opts)).toBe(false);
    expect(isDue(app({ rejectedAt: ago(DEFAULT_RETENTION_DAYS + 0.5) }), opts)).toBe(true);
  });

  test('is NOT due when media was already purged', () => {
    expect(isDue(app({ mediaPurgedAt: ago(1) }), opts)).toBe(false);
  });

  test('is NOT due when there are no files left', () => {
    expect(isDue(app({ files: {} }), opts)).toBe(false);
    expect(isDue(app({ files: { videoOne: {}, resume: {} } }), opts)).toBe(false);
  });

  test('is NOT due when the clock is undeterminable — an unparseable date KEEPS the media', () => {
    expect(isDue(app({ rejectedAt: 'not-a-date', rejectionEmailedAt: null, updatedAt: null }), opts)).toBe(false);
    expect(isDue(app({ rejectedAt: null, rejectionEmailedAt: null, updatedAt: null }), opts)).toBe(false);
  });

  test.each([undefined, null, {}])('is NOT due for unusable input %p', (a) => {
    expect(isDue(a, opts)).toBe(false);
  });

  test('honours a custom window', () => {
    expect(isDue(app({ rejectedAt: ago(20) }), { retentionDays: 30, now: NOW })).toBe(false);
    expect(isDue(app({ rejectedAt: ago(40) }), { retentionDays: 30, now: NOW })).toBe(true);
  });

  test('a reconsidered applicant (rejectedAt cleared, status moved on) is spared', () => {
    expect(isDue(app({ status: 'shortlisted', rejectedAt: null }), opts)).toBe(false);
  });
});

describe('selectDue', () => {
  test('picks only the due applications out of a mixed list', () => {
    const list = [
      app({ _id: 'due', rejectedAt: ago(30) }),
      app({ _id: 'tooRecent', rejectedAt: ago(3) }),
      app({ _id: 'hired', status: 'hired' }),
      app({ _id: 'done', mediaPurgedAt: ago(1) }),
    ];
    expect(selectDue(list, { now: NOW }).map((a) => a._id)).toEqual(['due']);
  });
});

describe('filesOf', () => {
  test('returns only populated slots, tagged with their slot name', () => {
    expect(filesOf(app()).map((f) => f.slot)).toEqual(['videoOne', 'resume']);
  });

  test('is empty for an application with no files', () => {
    expect(filesOf(app({ files: {} }))).toEqual([]);
    expect(filesOf({})).toEqual([]);
  });
});

describe('purgeApplicationMedia', () => {
  const deps = (over = {}) => ({
    deleteAsset: jest.fn().mockResolvedValue(true),
    persist: jest.fn().mockResolvedValue(undefined),
    apply: true,
    ...over,
  });

  test('dry run deletes nothing and persists nothing', async () => {
    const d = deps({ apply: false });
    const r = await purgeApplicationMedia(app(), d);
    expect(r.status).toBe('would-purge');
    expect(d.deleteAsset).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
    expect(r.bytes).toBe(11 * 1048576);
  });

  test('deletes every asset, THEN clears the refs and stamps mediaPurgedAt', async () => {
    const d = deps();
    const r = await purgeApplicationMedia(app(), d);
    expect(d.deleteAsset).toHaveBeenCalledTimes(2);
    expect(d.deleteAsset).toHaveBeenCalledWith({ publicId: 'autobacs/careers/n/v1', resourceType: 'video' });
    expect(d.deleteAsset).toHaveBeenCalledWith({ publicId: 'autobacs/careers/n/cv.pdf', resourceType: 'raw' });
    const [, patch] = d.persist.mock.calls[0];
    expect(patch.files).toEqual({ videoOne: {}, videoTwo: {}, resume: {}, support: {} });
    expect(patch.mediaPurgedAt).toBeInstanceOf(Date);
    expect(r).toMatchObject({ status: 'purged', deleted: 2, failed: [] });
  });

  /*
    The purge must follow each file's OWN provider, not the deployment's current
    STORAGE_PROVIDER. Routed to the wrong store, an R2 delete of a key that is
    not there SUCCEEDS — so the sweep would report a clean purge, stamp
    mediaPurgedAt, and leave the applicant's CV in the other bucket permanently.
    A retention breach indistinguishable from a completed purge.
  */
  test('threads each file\'s own provider through to the deleter', async () => {
    const mixed = {
      ...app(),
      files: {
        videoOne: { publicId: 'autobacs/careers/n/v1', resourceType: 'video', bytes: 1, provider: 'r2' },
        resume:   { publicId: 'autobacs/careers/n/cv.pdf', resourceType: 'raw', bytes: 1 },
      },
    };
    const d = deps();
    await purgeApplicationMedia(mixed, d);
    expect(d.deleteAsset).toHaveBeenCalledWith(expect.objectContaining({
      publicId: 'autobacs/careers/n/v1', provider: 'r2',
    }));
    // Absent means Cloudinary — the same rule as privateAssetUrl.providerOf.
    expect(d.deleteAsset).toHaveBeenCalledWith(expect.objectContaining({
      publicId: 'autobacs/careers/n/cv.pdf', provider: undefined,
    }));
  });

  test('storage delete happens BEFORE the DB write', async () => {
    const order = [];
    const d = deps({
      deleteAsset: jest.fn().mockImplementation(async () => { order.push('delete'); return true; }),
      persist: jest.fn().mockImplementation(async () => { order.push('persist'); }),
    });
    await purgeApplicationMedia(app(), d);
    expect(order).toEqual(['delete', 'delete', 'persist']);
  });

  test('a PARTIAL failure does not clear the refs, so the next run retries', async () => {
    // Clearing here would strand the surviving asset permanently: nothing would
    // reference it, and the abandoned-folder sweep spares folders that still
    // map to an application.
    const d = deps({ deleteAsset: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
    const r = await purgeApplicationMedia(app(), d);
    expect(r.status).toBe('partial');
    expect(r.failed).toEqual(['autobacs/careers/n/cv.pdf']);
    expect(d.persist).not.toHaveBeenCalled();
  });

  test('a total failure does not clear the refs either', async () => {
    const d = deps({ deleteAsset: jest.fn().mockResolvedValue(false) });
    const r = await purgeApplicationMedia(app(), d);
    expect(r.status).toBe('partial');
    expect(r.deleted).toBe(0);
    expect(d.persist).not.toHaveBeenCalled();
  });

  test('re-purging after a crash between delete and save self-heals', async () => {
    // Cloudinary reports an already-deleted asset as not_found, which the
    // adapter maps to success — so the retry completes the DB half.
    const d = deps({ deleteAsset: jest.fn().mockResolvedValue(true) });
    const r = await purgeApplicationMedia(app(), d);
    expect(r.status).toBe('purged');
    expect(d.persist).toHaveBeenCalled();
  });

  test('carries the applicant identity into the row for the audit manifest', async () => {
    const r = await purgeApplicationMedia(app(), deps());
    expect(r).toMatchObject({ applicationId: 'a1', applicant: 'Test Person', email: 'test@example.com' });
  });
});

describe('summarise', () => {
  test('tallies purged, dry-run and partial rows separately', () => {
    const s = summarise([
      { status: 'purged', deleted: 3, bytes: 100, files: [1, 2, 3] },
      { status: 'purged', deleted: 2, bytes: 50, files: [1, 2] },
      { status: 'partial', deleted: 1, bytes: 10, files: [1] },
      { status: 'would-purge', bytes: 20, files: [1, 2] },
    ]);
    expect(s).toEqual({ purged: 2, wouldPurge: 1, partial: 1, files: 7, bytes: 170 });
  });
});

describe('daysSince', () => {
  test('measures elapsed days', () => expect(daysSince(ago(10), NOW)).toBeCloseTo(10));
  test('returns null for a missing date', () => expect(daysSince(null, NOW)).toBeNull());
});
