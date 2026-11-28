/**
 * Reel conversion (services/reelConvertService.js, queue/workers/reelConvertWorker.js).
 *
 * The cases a "post an HEVC clip and watch it appear" demo misses: the job running
 * twice (BullMQ retry, deploy mid-encode) producing two files or two approvals, a
 * reel staff removed while it was encoding coming back to life, ffmpeg "succeeding"
 * with a file that still is not H.264, a failed conversion being approved anyway, a
 * processing reel leaking into the feed or the review queue, and a reel stuck in
 * "processing" forever because the enqueue was lost.
 *
 * R2 is an in-memory store and ffmpeg is a stand-in that writes a structurally real
 * MP4 (tests/helpers/mp4Fixture.js). What is NOT proven here: that the real ffmpeg
 * command converts a real phone clip — tests/reelConvert.ffmpeg.test.js does that
 * when ffmpeg is installed.
 */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import { makeMp4 } from './helpers/mp4Fixture.js';

const store = new Map();
const r2 = {
  putObject: jest.fn(), headObject: jest.fn(), objectExists: jest.fn(), getObjectBuffer: jest.fn(),
  getObjectHead: jest.fn(), getObjectRange: jest.fn(), deleteObject: jest.fn(), deleteObjects: jest.fn(),
  presignPut: jest.fn(), presignGet: jest.fn(), listKeys: jest.fn(), resetClient: jest.fn(),
  downloadToFile: jest.fn(), putFile: jest.fn(),
};
jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({ ...r2, default: r2 }));

const actualQueues = await import('../queue/queues.js');
const enqueue = jest.fn(async () => true);
jest.unstable_mockModule('../queue/queues.js', () => ({ ...actualQueues, enqueueReelConversion: enqueue }));

const { UnrecoverableError } = await import('bullmq');
const { default: mongoose } = await import('mongoose');
const dbHandler = await import('./db-handler.js');
const { default: Reel } = await import('../models/Reel.js');
const { default: Product } = await import('../models/Product.js');
const reelService = await import('../services/reelService.js');
const { verifyUploadedVideo, reelFolderFor, reelPlaybackUrls } = await import('../services/reelMediaService.js');
const {
  convertReel, failConversion, sweepStuckConversions, convertedKeyFor, ffmpegArgs, checkConverted, ReelConvertError,
} = await import('../services/reelConvertService.js');
const { processConvertJob, onConvertJobFailed } = await import('../queue/workers/reelConvertWorker.js');
const { REEL_STATUS, REEL_CONVERT_FAILED_MESSAGE, reelConversionEnabled } = await import('../config/reels.js');

const oid = () => new mongoose.Types.ObjectId();
const NONCE = '1'.repeat(24);
let n = 0;
const keyFor = (prefix, ext = 'mp4') => { n += 1; return `${prefix}/${NONCE}/video-${String(n).padStart(16, '0')}.${ext}`; };

const wireStore = () => {
  r2.presignGet.mockImplementation(async ({ key }) => `https://get.example/${key}?sig=1`);
  r2.headObject.mockImplementation(async ({ key }) => (store.has(key) ? { key, bytes: store.get(key).length } : null));
  r2.getObjectRange.mockImplementation(async ({ key, start, length }) => {
    const b = store.get(key) || Buffer.alloc(0);
    return b.subarray(start, Math.min(b.length, start + length));
  });
  r2.deleteObject.mockImplementation(async ({ key }) => { store.delete(key); return true; });
  r2.downloadToFile.mockImplementation(async ({ key, filePath }) => {
    if (!store.has(key)) throw new Error('missing');
    await fs.promises.writeFile(filePath, store.get(key));
    return store.get(key).length;
  });
  r2.putFile.mockImplementation(async ({ filePath, key }) => {
    store.set(key, await fs.promises.readFile(filePath));
    return { key, bytes: store.get(key).length };
  });
};

/** Stand-in for ffmpeg: writes `bytes` to the output path (the last argument). */
const fakeFfmpeg = (bytes = makeMp4({ durationSec: 20, moovAtEnd: false })) =>
  jest.fn(async (args) => { await fs.promises.writeFile(args[args.length - 1], bytes); });

const tmpDirs = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('reel-convert-'));

let user;
const mkProcessing = async ({ team = false, bytes = makeMp4({ codec: 'hvc1' }), ...over } = {}) => {
  const key = keyFor(team ? 'autobacs/reels/team' : `autobacs/reels/u_${user}`, 'mov');
  store.set(key, bytes);
  const reel = await Reel.create({
    creator: user, uploadedBy: user, source: team ? 'team' : 'customer', product: oid(),
    media: { publicId: key, format: 'mov', durationSec: 20, bytes: bytes.length, convert: 'pending' },
    status: REEL_STATUS.PROCESSING, ...over,
  });
  return { reel, key };
};

const ENV = { ...process.env };

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  wireStore();
  enqueue.mockImplementation(async () => true);
  user = oid();
  process.env.QUEUE_REDIS_URL = 'redis://unused.invalid:6379';
  delete process.env.REEL_CONVERT;
});
afterEach(async () => {
  process.env = { ...ENV };
  await dbHandler.clearDatabase();
});

// ── Accepting a clip that needs converting ────────────────────────────────────

describe('upload check with conversion on', () => {
  const folder = () => reelFolderFor({ userId: user });
  const put = (opts, ext = 'mp4') => { const k = keyFor(folder(), ext); store.set(k, Buffer.isBuffer(opts) ? opts : makeMp4(opts)); return k; };

  it.each([
    ['HEVC (iPhone)', { codec: 'hvc1' }],
    ['HEVC (Android)', { codec: 'hev1' }],
    ['an old 3GP: H.263 + AMR', { container: '3gp', codec: 's263', audioCodec: 'samr' }],
    ['H.264 with AMR-only sound', { audioCodec: 'samr' }],
  ])('keeps %s and flags it for conversion', async (_l, opts) => {
    const key = put(opts);
    const res = await verifyUploadedVideo(key, { folder: folder(), convert: true });
    expect(res.needsConversion).toBe(true);
    expect(store.has(key)).toBe(true);
  });

  it('does not flag a clip that already plays everywhere', async () => {
    const res = await verifyUploadedVideo(put({}), { folder: folder(), convert: true });
    expect(res.needsConversion).toBeUndefined();
  });

  it.each([
    ['not a video at all', Buffer.from('File not found'), 'REEL_MEDIA_NOT_VIDEO'],
    ['an HEVC clip over 60 seconds', { codec: 'hvc1', durationSec: 75 }, 'REEL_MEDIA_TOO_LONG'],
    ['a clip whose length cannot be read', { codec: 'hvc1', rawDuration: 0 }, 'REEL_MEDIA_UNREADABLE'],
    ['sound only (no picture to convert)', { video: false, audioCodec: 'samr' }, 'REEL_MEDIA_UNREADABLE'],
  ])('still refuses %s', async (_l, opts, code) => {
    const key = put(opts);
    await expect(verifyUploadedVideo(key, { folder: folder(), convert: true })).rejects.toMatchObject({ code });
    expect(store.has(key)).toBe(false);
  });

  it('is off without a queue, and with the kill switch', () => {
    expect(reelConversionEnabled()).toBe(true);
    process.env.REEL_CONVERT = 'off';
    expect(reelConversionEnabled()).toBe(false);
    delete process.env.REEL_CONVERT;
    delete process.env.QUEUE_REDIS_URL;
    delete process.env.REDIS_URL;
    expect(reelConversionEnabled()).toBe(false);
  });
});

describe('createReel', () => {
  let product;
  beforeEach(async () => {
    product = await Product.create({
      name: 'Seat cover', slug: `seat-cover-${Date.now()}-${n}`, description: 'A seat cover', price: 800, originalPrice: 1000,
      stock: 'in', images: [{ url: 'https://img.example.com/a.jpg', public_id: 'p/a' }],
    });
  });
  const post = (key, extra = {}) => reelService.createReel({ uploaderId: user, publicId: key, productId: String(product._id), ...extra });

  it('parks an HEVC clip as processing, with no playback link, and queues one job', async () => {
    const key = keyFor(reelFolderFor({ userId: user }), 'mov');
    store.set(key, makeMp4({ codec: 'hvc1' }));
    const first = await post(key);
    expect(first).toMatchObject({ created: true, reel: { status: 'processing', mp4Url: null } });
    // A double tap is the same reel and not a second job.
    const again = await post(key);
    expect(again).toMatchObject({ created: false, reel: { id: first.reel.id, status: 'processing' } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(String(enqueue.mock.calls[0][0])).toBe(first.reel.id);
    expect(await Reel.countDocuments()).toBe(1);
  });

  it('a team HEVC upload is NOT live until converted', async () => {
    const key = keyFor(reelFolderFor({ userId: user, team: true }), 'mov');
    store.set(key, makeMp4({ codec: 'hvc1' }));
    const res = await post(key, { team: true });
    expect(res.reel.status).toBe('processing');
    const row = await Reel.findById(res.reel.id).lean();
    expect(row.approvedAt).toBeNull();
    expect((await reelService.listFeed({})).reels).toHaveLength(0);
  });

  it('keeps the reel (processing) when the queue is down — the sweep picks it up', async () => {
    enqueue.mockResolvedValueOnce(false);
    const key = keyFor(reelFolderFor({ userId: user }));
    store.set(key, makeMp4({ codec: 'hvc1' }));
    expect((await post(key)).reel.status).toBe('processing');
    expect(store.has(key)).toBe(true);
  });

  it('an H.264 clip is untouched: pending, playable, no job', async () => {
    const key = keyFor(reelFolderFor({ userId: user }));
    store.set(key, makeMp4());
    const res = await post(key);
    expect(res.reel).toMatchObject({ status: 'pending' });
    expect(res.reel.mp4Url).toMatch(/^https:/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('with the kill switch on, HEVC is refused as before', async () => {
    process.env.REEL_CONVERT = 'off';
    const key = keyFor(reelFolderFor({ userId: user }));
    store.set(key, makeMp4({ codec: 'hvc1' }));
    await expect(post(key)).rejects.toMatchObject({ code: 'REEL_MEDIA_CODEC' });
    expect(await Reel.countDocuments()).toBe(0);
  });

  it('a processing reel is not in the feed and not in the review queue', async () => {
    const key = keyFor(reelFolderFor({ userId: user }));
    store.set(key, makeMp4({ codec: 'hvc1' }));
    const { reel } = await post(key);
    expect((await reelService.listFeed({})).reels).toHaveLength(0);
    expect((await reelService.adminList({ status: 'pending' })).reels).toHaveLength(0);
    expect((await reelService.adminList({ status: 'processing' })).reels).toHaveLength(1);
    await expect(reelService.approveReel(reel.id, oid())).rejects.toMatchObject({ statusCode: 409 });
    expect((await Reel.findById(reel.id).lean()).status).toBe('processing');
  });
});

// ── The conversion job ────────────────────────────────────────────────────────

describe('convertReel', () => {
  it('swaps a customer reel onto the converted file and sends it to review', async () => {
    const { reel, key } = await mkProcessing();
    const run = fakeFfmpeg();
    const res = await convertReel(reel._id, { run });
    const outKey = convertedKeyFor(key);
    expect(res).toEqual({ converted: true, key: outKey });

    const row = await Reel.findById(reel._id).lean();
    expect(row.status).toBe('pending');
    expect(row.approvedAt).toBeNull();
    expect(row.media).toMatchObject({ publicId: outKey, format: 'mp4', durationSec: 20 });
    expect(row.media.convert).toBeUndefined();
    // Original gone, converted file is what plays.
    expect(store.has(key)).toBe(false);
    expect(store.has(outKey)).toBe(true);
    expect((await reelPlaybackUrls(row.media)).mp4Url).toContain(outKey);
    expect(tmpDirs()).toHaveLength(0);
  });

  it('a team reel goes live once converted, credited to the uploader', async () => {
    const { reel } = await mkProcessing({ team: true });
    const at = new Date('2026-11-28T10:00:00Z');
    await convertReel(reel._id, { run: fakeFfmpeg(), now: () => at });
    const row = await Reel.findById(reel._id).lean();
    expect(row).toMatchObject({ status: 'approved', approvedAt: at, moderatedAt: at });
    expect(String(row.moderatedBy)).toBe(String(user));
  });

  it('running twice converts once: one file, one transition', async () => {
    const { reel, key } = await mkProcessing({ team: true });
    const run = fakeFfmpeg();
    const at = new Date('2026-11-28T10:00:00Z');
    await convertReel(reel._id, { run, now: () => at });
    const second = await convertReel(reel._id, { run, now: () => new Date('2026-11-28T11:00:00Z') });
    expect(second).toEqual({ skipped: 'not-waiting' });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await Reel.findById(reel._id).lean()).approvedAt).toEqual(at);
    expect([...store.keys()]).toEqual([convertedKeyFor(key)]);
  });

  it('two runs racing end with one playable file and one transition', async () => {
    const { reel, key } = await mkProcessing();
    const results = await Promise.all([
      convertReel(reel._id, { run: fakeFfmpeg() }),
      convertReel(reel._id, { run: fakeFfmpeg() }),
    ]);
    expect(results.filter((r) => r.converted)).toHaveLength(1);
    const row = await Reel.findById(reel._id).lean();
    expect(row.status).toBe('pending');
    // The loser must not delete the file the winner just published.
    expect(store.has(row.media.publicId)).toBe(true);
    expect(row.media.publicId).toBe(convertedKeyFor(key));
  });

  it('a reel removed by staff while encoding is not brought back', async () => {
    const { reel, key } = await mkProcessing();
    const run = jest.fn(async (args) => {
      await Reel.updateOne({ _id: reel._id }, { $set: { status: 'removed' } });
      await fs.promises.writeFile(args[args.length - 1], makeMp4({ moovAtEnd: false }));
    });
    expect(await convertReel(reel._id, { run })).toEqual({ skipped: 'changed-meanwhile' });
    expect((await Reel.findById(reel._id).lean()).status).toBe('removed');
    expect(store.has(convertedKeyFor(key))).toBe(false);
  });

  it.each([
    ['still HEVC', makeMp4({ codec: 'hvc1' })],
    ['sound still AMR', makeMp4({ audioCodec: 'samr' })],
    ['no picture', makeMp4({ video: false })],
    ['longer than 60s', makeMp4({ durationSec: 90 })],
    ['not a video', Buffer.from('oops')],
  ])('refuses ffmpeg output that is %s — never published, never retried', async (_l, bytes) => {
    const { reel, key } = await mkProcessing();
    const err = await convertReel(reel._id, { run: fakeFfmpeg(bytes) }).catch((e) => e);
    expect(err).toBeInstanceOf(ReelConvertError);
    expect(err.retry).toBe(false);
    const row = await Reel.findById(reel._id).lean();
    expect(row.status).toBe('processing');
    expect(row.media.publicId).toBe(key);
    expect(store.has(convertedKeyFor(key))).toBe(false);
    expect(tmpDirs()).toHaveLength(0);
  });

  it('an ffmpeg crash is retryable and leaves everything as it was', async () => {
    const { reel, key } = await mkProcessing();
    const run = jest.fn(async () => { throw new ReelConvertError('ffmpeg failed (SIGKILL)'); });
    await expect(convertReel(reel._id, { run })).rejects.toMatchObject({ retry: true });
    expect((await Reel.findById(reel._id).lean()).status).toBe('processing');
    expect(store.has(key)).toBe(true);
    expect(tmpDirs()).toHaveLength(0);
    // …and the retry then succeeds.
    expect((await convertReel(reel._id, { run: fakeFfmpeg() })).converted).toBe(true);
  });

  it('a storage outage is retryable; a deleted original is not', async () => {
    const { reel, key } = await mkProcessing();
    r2.headObject.mockRejectedValueOnce(new Error('R2 down'));
    await expect(convertReel(reel._id, { run: fakeFfmpeg() })).rejects.toThrow('R2 down');
    store.delete(key);
    await expect(convertReel(reel._id, { run: fakeFfmpeg() })).rejects.toMatchObject({ retry: false });
  });

  it('skips a reel that does not exist or is not waiting', async () => {
    expect(await convertReel(oid(), { run: fakeFfmpeg() })).toEqual({ skipped: 'not-found' });
    expect(await convertReel('nonsense', { run: fakeFfmpeg() })).toEqual({ skipped: 'not-found' });
  });
});

describe('failConversion', () => {
  it('rejects the reel with a plain reason, deletes the original, and blocks approval for good', async () => {
    const { reel, key } = await mkProcessing();
    expect(await failConversion(reel._id)).toBe(true);
    const row = await Reel.findById(reel._id).lean();
    expect(row).toMatchObject({ status: 'rejected', rejectReason: REEL_CONVERT_FAILED_MESSAGE });
    expect(row.media.convert).toBe('failed');
    expect(store.has(key)).toBe(false);
    expect(await reelPlaybackUrls(row.media)).toEqual({ hlsUrl: null, mp4Url: null, posterUrl: null });
    // "rejected" can normally be approved later. Not this one: it has no playable file.
    await expect(reelService.approveReel(String(reel._id), oid())).rejects.toMatchObject({ statusCode: 409 });
    expect((await Reel.findById(reel._id).lean()).status).toBe('rejected');
    // Twice is a no-op.
    expect(await failConversion(reel._id)).toBe(false);
  });

  it('does nothing to a reel that already converted', async () => {
    const { reel } = await mkProcessing();
    await convertReel(reel._id, { run: fakeFfmpeg() });
    expect(await failConversion(reel._id)).toBe(false);
    expect((await Reel.findById(reel._id).lean()).status).toBe('pending');
  });
});

// ── Worker + sweep ────────────────────────────────────────────────────────────

describe('worker', () => {
  it('does not spend retries on a file that can never convert', async () => {
    const convert = jest.fn(async () => { throw new ReelConvertError('bad file', { retry: false }); });
    await expect(processConvertJob({ data: { reelId: 'r1' } }, { convert })).rejects.toBeInstanceOf(UnrecoverableError);
    const flaky = jest.fn(async () => { throw new ReelConvertError('killed'); });
    const err = await processConvertJob({ data: { reelId: 'r1' } }, { convert: flaky }).catch((e) => e);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    await expect(processConvertJob({ data: {} }, { convert })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('fails the reel only when no attempts are left', async () => {
    const fail = jest.fn(async () => true);
    const job = (attemptsMade) => ({ id: 'j', name: 'convert-reel', data: { reelId: 'r1' }, attemptsMade, opts: { attempts: 3 } });
    await onConvertJobFailed(job(1), new Error('flaky'), { fail });
    await onConvertJobFailed(job(2), new Error('flaky'), { fail });
    expect(fail).not.toHaveBeenCalled();
    await onConvertJobFailed(job(3), new Error('flaky'), { fail });
    expect(fail).toHaveBeenCalledTimes(1);
    await onConvertJobFailed(job(1), new UnrecoverableError('bad file'), { fail });
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenLastCalledWith('r1');
  });
});

describe('sweepStuckConversions', () => {
  const now = new Date('2026-11-28T12:00:00Z');
  const ago = (min) => new Date(now.getTime() - min * 60 * 1000);

  it('re-queues what is stuck, gives up on what is hours old, leaves fresh ones alone', async () => {
    const fresh = await mkProcessing({ createdAt: ago(5) });
    const stuck = await mkProcessing({ createdAt: ago(20) });
    const dead = await mkProcessing({ createdAt: ago(200) });
    const res = await sweepStuckConversions({ now });
    expect(res).toEqual({ stuck: 2, requeued: 1, failed: 1 });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [id, opts] = enqueue.mock.calls[0];
    expect(String(id)).toBe(String(stuck.reel._id));
    // A sweep job needs its own id (a failed job keeps the plain one for 7 days), with no ':'.
    expect(opts.jobId).toMatch(/^reel-convert\|[0-9a-f]{24}\|sweep\|\d+$/);

    expect((await Reel.findById(dead.reel._id).lean()).status).toBe('rejected');
    expect((await Reel.findById(fresh.reel._id).lean()).status).toBe('processing');
    expect((await Reel.findById(stuck.reel._id).lean()).status).toBe('processing');
  });

  it('never touches reels in any other state', async () => {
    const { reel } = await mkProcessing({ createdAt: ago(500), status: 'pending' });
    expect(await sweepStuckConversions({ now })).toEqual({ stuck: 0, requeued: 0, failed: 0 });
    expect((await Reel.findById(reel._id).lean()).status).toBe('pending');
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('the converted key is stable and has the shape every reel key has', () => {
    const key = `autobacs/reels/u_${'a'.repeat(24)}/${NONCE}/video-${'2'.repeat(16)}.mov`;
    const out = convertedKeyFor(key);
    expect(out).toBe(convertedKeyFor(key));
    expect(out).toMatch(new RegExp(`^autobacs/reels/u_a{24}/${NONCE}/video-[0-9a-f]{16}\\.mp4$`));
    expect(out).not.toBe(key.replace('.mov', '.mp4'));
  });

  it('the ffmpeg command makes H.264 + AAC, strips metadata, caps size/length/threads', () => {
    const args = ffmpegArgs('/tmp/in', '/tmp/out.mp4');
    const after = (flag) => args[args.indexOf(flag) + 1];
    expect(after('-i')).toBe('/tmp/in');
    expect(after('-c:v')).toBe('libx264');
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-c:a')).toBe('aac');
    expect(after('-map_metadata')).toBe('-1');
    expect(after('-t')).toBe('60');
    expect(after('-threads')).toBe('2');
    expect(after('-movflags')).toBe('+faststart');
    expect(after('-vf')).toContain('1920');
    expect(args).toContain('-nostdin');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('checkConverted accepts a silent H.264 clip', async () => {
    const f = `${os.tmpdir()}/reel-check-${Date.now()}.mp4`;
    await fs.promises.writeFile(f, makeMp4({ audio: false, durationSec: 12 }));
    await expect(checkConverted(f)).resolves.toMatchObject({ durationSec: 12 });
    await fs.promises.rm(f);
  });
});
