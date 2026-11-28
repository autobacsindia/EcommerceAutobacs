/**
 * Reels — the upload steps: a missing or junk file is never uploaded as a video.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReelUpload, UNREADABLE_VIDEO_MESSAGE, MIN_VIDEO_BYTES } from '../uploadCore.ts';

const MB = 1024 * 1024;
const target = { uploadUrl: 'https://r2.example/put', headers: { 'Content-Type': 'video/mp4' }, publicId: 'reels/abc.mp4', maxBytes: 100 * MB };

function io(over = {}) {
  const calls = { target: [], put: [] };
  return {
    calls,
    isCancelled: () => false,
    fileSize: async () => 5 * MB,
    getTarget: async (input) => { calls.target.push(input); return target; },
    put: async (url, uri, headers, report) => { calls.put.push({ url, uri, headers }); report(0.5); report(1); return { status: 200 }; },
    ...over,
  };
}

test('uploads the file itself, with the size the file system reports', async () => {
  const fake = io();
  const seen = [];
  const uri = 'file:///data/user/0/host.exp.exponent/cache/ExperienceData/%2540anonymous%252Froavion/ImagePicker/a.mp4';
  const out = await runReelUpload(fake, uri, 'video/mp4', (f) => seen.push(f));
  assert.deepEqual(out, { publicId: 'reels/abc.mp4' });
  assert.deepEqual(fake.calls.target, [{ contentType: 'video/mp4', size: 5 * MB }]);
  // The URI goes to the uploader untouched (no decoding, no re-encoding).
  assert.deepEqual(fake.calls.put, [{ url: target.uploadUrl, uri, headers: target.headers }]);
  // Progress never claims "done" until the server said yes.
  assert.deepEqual(seen, [0.5, 0.99, 1]);
});

test('a missing, empty or junk-sized file is refused before anything is uploaded', async () => {
  // 14 = the "File not found" text Android handed back in place of the video.
  for (const size of [null, 0, 14, MIN_VIDEO_BYTES - 1, NaN]) {
    const fake = io({ fileSize: async () => size });
    await assert.rejects(runReelUpload(fake, 'file:///x.mp4', 'video/mp4', () => {}), { message: UNREADABLE_VIDEO_MESSAGE });
    assert.equal(fake.calls.target.length, 0);
    assert.equal(fake.calls.put.length, 0);
  }
  const broken = io({ fileSize: async () => { throw new Error('EACCES'); } });
  await assert.rejects(runReelUpload(broken, 'file:///x.mp4', 'video/mp4', () => {}), { message: UNREADABLE_VIDEO_MESSAGE });
});

test('a video over the limit is refused with the limit in MB', async () => {
  const fake = io({ fileSize: async () => 101 * MB });
  await assert.rejects(runReelUpload(fake, 'file:///x.mp4', 'video/mp4', () => {}), { message: 'Please choose a video under 100 MB.' });
  assert.equal(fake.calls.put.length, 0);
});

test('a refused or failed PUT is an error, never a silent success', async () => {
  const seen = [];
  await assert.rejects(
    runReelUpload(io({ put: async () => ({ status: 403 }) }), 'file:///x.mp4', 'video/mp4', (f) => seen.push(f)),
    { message: 'Upload failed (403). Please try again.' },
  );
  assert.ok(!seen.includes(1));
  await assert.rejects(
    runReelUpload(io({ put: async () => { throw new Error('socket'); } }), 'file:///x.mp4', 'video/mp4', () => {}),
    { message: 'Upload failed — check your internet and try again.' },
  );
});

test('cancel stops at each step', async () => {
  let cancelled = true;
  const early = io({ isCancelled: () => cancelled });
  await assert.rejects(runReelUpload(early, 'file:///x.mp4', 'video/mp4', () => {}), { message: 'Upload cancelled.' });
  assert.equal(early.calls.target.length, 0);

  cancelled = false;
  const mid = io({ isCancelled: () => cancelled, put: async () => { cancelled = true; throw new Error('aborted'); } });
  await assert.rejects(runReelUpload(mid, 'file:///x.mp4', 'video/mp4', () => {}), { message: 'Upload cancelled.' });
});
