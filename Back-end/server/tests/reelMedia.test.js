/**
 * Reel video verification on R2 (services/reelMediaService.js, services/storage/mp4Probe.js).
 *
 * The abuse cases: a key in someone else's folder, an oversize file, a renamed
 * non-video, a clip over 60 seconds, an HEVC clip that half the browsers cannot play,
 * a file whose length cannot be read — and storage being down, which must never turn
 * into "accepted unchecked". R2 is mocked with an in-memory object store; the MP4s
 * are structurally real (tests/helpers/mp4Fixture.js).
 */
import { jest } from '@jest/globals';
import { makeMp4, bufferReader, box } from './helpers/mp4Fixture.js';

const store = new Map();
const r2 = {
  presignPut: jest.fn(),
  presignGet: jest.fn(),
  headObject: jest.fn(),
  getObjectRange: jest.fn(),
  deleteObject: jest.fn(),
};
jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({ ...r2, default: r2 }));

const { probeIsoMedia, MAX_MOOV_BYTES } = await import('../services/storage/mp4Probe.js');
const {
  buildUploadTarget, verifyUploadedVideo, reelFolderFor, reelPlaybackUrls,
} = await import('../services/reelMediaService.js');
const { REEL_MAX_BYTES } = await import('../config/reels.js');

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const folder = reelFolderFor({ userId: USER });
const keyIn = (prefix, ext = 'mp4') => `${prefix}/${'1'.repeat(24)}/video-${'2'.repeat(16)}.${ext}`;

const wireStore = () => {
  r2.presignPut.mockImplementation(async ({ key }) => ({ url: `https://put.example/${key}`, expiresIn: 900 }));
  r2.presignGet.mockImplementation(async ({ key }) => `https://get.example/${key}?sig=1`);
  r2.headObject.mockImplementation(async ({ key }) => (store.has(key) ? { key, bytes: store.get(key).length } : null));
  r2.getObjectRange.mockImplementation(async ({ key, start, length }) => {
    const b = store.get(key) || Buffer.alloc(0);
    return b.subarray(start, Math.min(b.length, start + length));
  });
  r2.deleteObject.mockImplementation(async ({ key }) => { store.delete(key); return true; });
};

beforeEach(() => { store.clear(); wireStore(); });

// ── The MP4 reader ────────────────────────────────────────────────────────────

describe('probeIsoMedia', () => {
  it.each([
    ['moov at the end (phone recording)', { moovAtEnd: true }],
    ['moov at the front (fast-start)', { moovAtEnd: false }],
    ['a MOV', { container: 'mov' }],
    ['a version-1 mvhd', { mvhdVersion: 1 }],
    ['a 64-bit mdat size', { largeMdat: true }],
  ])('reads duration and codec from %s', async (_label, opts) => {
    const buf = makeMp4({ durationSec: 42.5, ...opts });
    const res = await probeIsoMedia(bufferReader(buf), { size: buf.length });
    expect(res).toEqual({ ok: true, durationSec: 42.5, videoCodecs: ['avc1'] });
  });

  it('finds an end-of-file moov in a handful of small reads, never the whole file', async () => {
    const buf = makeMp4({ mdatBytes: 5_000_000 });
    const reader = bufferReader(buf);
    await probeIsoMedia(reader, { size: buf.length });
    expect(reader.calls).toBeLessThanOrEqual(5);
  });

  it('reports HEVC as hvc1', async () => {
    const buf = makeMp4({ codec: 'hvc1' });
    expect((await probeIsoMedia(bufferReader(buf), { size: buf.length })).videoCodecs).toEqual(['hvc1']);
  });

  it.each([
    ['zero duration (fragmented MP4)', makeMp4({ rawDuration: 0 })],
    ['"unknown" duration', makeMp4({ rawDuration: 0xFFFFFFFF })],
    ['no video track (audio only)', makeMp4({ video: false })],
    ['no moov at all', Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(64))])],
    ['a truncated file', makeMp4().subarray(0, 3000)],
    ['plain text', Buffer.from('<html><script>alert(1)</script></html>')],
  ])('fails closed on %s', async (_label, buf) => {
    expect((await probeIsoMedia(bufferReader(buf), { size: buf.length })).ok).toBe(false);
  });

  it('does not loop on a corrupt box size smaller than its header', async () => {
    const buf = Buffer.concat([Buffer.from([0, 0, 0, 4]), Buffer.from('free'), Buffer.alloc(64)]);
    expect(await probeIsoMedia(bufferReader(buf), { size: buf.length })).toEqual({ ok: false, reason: 'bad-box' });
  });

  it('refuses to read an absurdly large moov', async () => {
    const buf = makeMp4({ moovAtEnd: false });
    expect((await probeIsoMedia(bufferReader(buf), { size: buf.length, maxMoovBytes: 64 })).reason).toBe('moov-too-large');
    expect(MAX_MOOV_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it('propagates a storage error rather than calling it "not a video"', async () => {
    const reader = async () => { throw new Error('ECONNRESET'); };
    await expect(probeIsoMedia(reader, { size: 1000 })).rejects.toThrow('ECONNRESET');
  });
});

// ── Upload target ─────────────────────────────────────────────────────────────

describe('buildUploadTarget', () => {
  it('mints a private PUT under the caller’s prefix, with the exact size signed', async () => {
    const t = await buildUploadTarget({ userId: USER, contentType: 'video/mp4', size: 5_000_000 });
    expect(t.key).toMatch(new RegExp(`^autobacs/reels/u_${USER}/[0-9a-f]{24}/video-[0-9a-f]{16}\\.mp4$`));
    expect(t).toMatchObject({ method: 'PUT', publicId: t.key, contentType: 'video/mp4', maxDurationSec: 60, maxBytes: REEL_MAX_BYTES });
    expect(r2.presignPut).toHaveBeenCalledWith({ key: t.key, scope: 'private', contentType: 'video/mp4', contentLength: 5_000_000 });
  });

  it('gives every upload a fresh folder', async () => {
    const a = await buildUploadTarget({ userId: USER, contentType: 'video/mp4', size: 10 });
    const b = await buildUploadTarget({ userId: USER, contentType: 'video/mp4', size: 10 });
    expect(a.key).not.toBe(b.key);
  });

  it('maps MOV to .mov and team uploads to the team prefix', async () => {
    const t = await buildUploadTarget({ userId: USER, team: true, contentType: 'Video/QuickTime', size: 10 });
    expect(t.key).toMatch(/^autobacs\/reels\/team\/[0-9a-f]{24}\/video-[0-9a-f]{16}\.mov$/);
  });

  it.each([
    ['WebM', 'video/webm', 10, 'REEL_MEDIA_TYPE'],
    ['HTML', 'text/html', 10, 'REEL_MEDIA_TYPE'],
    ['no type', undefined, 10, 'REEL_MEDIA_TYPE'],
    ['no size', 'video/mp4', undefined, 'REEL_MEDIA_SIZE'],
    ['negative size', 'video/mp4', -5, 'REEL_MEDIA_SIZE'],
    ['fractional size', 'video/mp4', 1.5, 'REEL_MEDIA_SIZE'],
    ['oversize', 'video/mp4', REEL_MAX_BYTES + 1, 'REEL_MEDIA_TOO_LARGE'],
  ])('refuses %s before signing anything', async (_l, contentType, size, code) => {
    await expect(buildUploadTarget({ userId: USER, contentType, size })).rejects.toMatchObject({ statusCode: 400, code });
    expect(r2.presignPut).not.toHaveBeenCalled();
  });
});

// ── Verification ──────────────────────────────────────────────────────────────

describe('verifyUploadedVideo', () => {
  const put = (key, buf) => { store.set(key, buf); return key; };

  it('accepts a real 20s H.264 clip in the caller’s folder', async () => {
    const key = put(keyIn(folder), makeMp4({ durationSec: 20 }));
    await expect(verifyUploadedVideo(key, { folder })).resolves.toEqual({
      publicId: key, format: 'mp4', durationSec: 20, bytes: store.get(key).length,
    });
  });

  it('accepts an H.264 MOV and a clip at exactly 60s', async () => {
    const key = put(keyIn(folder, 'mov'), makeMp4({ container: 'mov', durationSec: 60.4 }));
    expect((await verifyUploadedVideo(key, { folder })).durationSec).toBe(60.4);
  });

  it.each([
    ['someone else’s folder', () => keyIn(reelFolderFor({ userId: OTHER }))],
    ['a prefix-sharing user id (u_<id>9)', () => keyIn(`${folder}9`)],
    ['the team folder, for a customer', () => keyIn(reelFolderFor({ team: true }))],
    ['a traversal', () => `${folder}/${'1'.repeat(24)}/../../u_${OTHER}/video-${'2'.repeat(16)}.mp4`],
    ['a key we did not mint', () => `${folder}/clip.mp4`],
    ['a disallowed extension', () => keyIn(folder, 'html')],
    ['nothing', () => ''],
    ['a non-string', () => ({ $gt: '' })],
  ])('403s %s without touching storage', async (_l, mk) => {
    await expect(verifyUploadedVideo(mk(), { folder })).rejects.toMatchObject({ statusCode: 403, code: 'REEL_MEDIA_FOREIGN' });
    expect(r2.headObject).not.toHaveBeenCalled();
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it('400s a key that was never uploaded', async () => {
    await expect(verifyUploadedVideo(keyIn(folder), { folder })).rejects.toMatchObject({ statusCode: 400, code: 'REEL_MEDIA_MISSING' });
  });

  it.each([
    ['over 60 seconds', makeMp4({ durationSec: 75 }), 'REEL_MEDIA_TOO_LONG', /60 seconds/],
    ['HEVC (iPhone High Efficiency)', makeMp4({ codec: 'hvc1' }), 'REEL_MEDIA_CODEC', /Most Compatible/],
    ['a renamed web page', Buffer.from('<!doctype html><script>alert(1)</script>'), 'REEL_MEDIA_NOT_VIDEO', /MP4 or MOV/],
    ['a JPEG', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(600)]), 'REEL_MEDIA_NOT_VIDEO', /MP4 or MOV/],
    ['a WebM', Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(600)]), 'REEL_MEDIA_NOT_VIDEO', /MP4 or MOV/],
    ['an AVIF image in an ftyp box', box('ftyp', Buffer.from('avif0000avifmif1')), 'REEL_MEDIA_NOT_VIDEO', /MP4 or MOV/],
    ['unreadable (no duration)', makeMp4({ rawDuration: 0 }), 'REEL_MEDIA_UNREADABLE', /could not read/],
  ])('refuses %s and deletes the object', async (_l, buf, code, msg) => {
    const key = put(keyIn(folder), buf);
    const err = await verifyUploadedVideo(key, { folder }).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 400, code });
    expect(err.message).toMatch(msg);
    expect(store.has(key)).toBe(false);
  });

  it('refuses an oversize object by its STORED size (the client’s claim is not trusted)', async () => {
    const key = put(keyIn(folder), makeMp4());
    r2.headObject.mockResolvedValueOnce({ key, bytes: REEL_MAX_BYTES + 1 });
    await expect(verifyUploadedVideo(key, { folder })).rejects.toMatchObject({ statusCode: 400, code: 'REEL_MEDIA_TOO_LARGE' });
    expect(store.has(key)).toBe(false);
    expect(r2.getObjectRange).not.toHaveBeenCalled();
  });

  it.each([
    ['HEAD', () => r2.headObject.mockRejectedValueOnce(new Error('timeout'))],
    ['the sniff read', () => r2.getObjectRange.mockRejectedValueOnce(new Error('timeout'))],
    ['the moov read', () => {
      r2.getObjectRange
        .mockImplementationOnce(async ({ key, start, length }) => store.get(key).subarray(start, start + length))
        .mockRejectedValueOnce(new Error('timeout'));
    }],
  ])('503s when storage fails during %s — never accepts unchecked, never deletes', async (_l, fail) => {
    const key = put(keyIn(folder), makeMp4());
    fail();
    await expect(verifyUploadedVideo(key, { folder })).rejects.toMatchObject({ statusCode: 503, code: 'REEL_MEDIA_UNAVAILABLE' });
    expect(store.has(key)).toBe(true);
  });
});

// ── Playback ──────────────────────────────────────────────────────────────────

describe('reelPlaybackUrls', () => {
  it('signs a private GET served as video/mp4, with no HLS or poster', async () => {
    const key = keyIn(folder, 'mov');
    await expect(reelPlaybackUrls({ publicId: key })).resolves.toEqual({
      hlsUrl: null, mp4Url: `https://get.example/${key}?sig=1`, posterUrl: null,
    });
    expect(r2.presignGet).toHaveBeenCalledWith(expect.objectContaining({ key, scope: 'private', contentType: 'video/mp4' }));
  });

  it.each([null, {}, { publicId: 'autobacs/reels/u_x/clip1' }, { publicId: '../secret' }])('gives no URL for %p', async (media) => {
    await expect(reelPlaybackUrls(media)).resolves.toEqual({ hlsUrl: null, mp4Url: null, posterUrl: null });
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('never throws: a signing failure gives a reel without video, not a broken feed', async () => {
    r2.presignGet.mockRejectedValueOnce(new Error('R2 not configured'));
    await expect(reelPlaybackUrls({ publicId: keyIn(folder) })).resolves.toEqual({ hlsUrl: null, mp4Url: null, posterUrl: null });
  });
});
