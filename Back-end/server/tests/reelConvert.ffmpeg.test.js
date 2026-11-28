/**
 * Reel conversion against the REAL ffmpeg (services/reelConvertService.js).
 *
 * reelConvert.test.js uses a stand-in for ffmpeg, so it cannot prove the command
 * itself is valid — a wrong flag there passes every unit test and fails every
 * conversion in production. This file runs the real binary on a real HEVC clip.
 *
 * Skipped when ffmpeg (with libx265, to make the input) is not installed, so it
 * never blocks a machine without it. The production image installs ffmpeg
 * (Dockerfile); run this there or anywhere ffmpeg exists: `npm test -- reelConvert.ffmpeg`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { ffmpegArgs, runFfmpeg, checkConverted } = await import('../services/reelConvertService.js');
const { probeIsoMedia } = await import('../services/storage/mp4Probe.js');

const bin = process.env.FFMPEG_PATH || 'ffmpeg';
const encoders = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const usable = encoders.status === 0 && /libx265/.test(encoders.stdout) && /libx264/.test(encoders.stdout);
const maybe = usable ? describe : describe.skip;

const probeFile = async (file) => {
  const buf = await fs.promises.readFile(file);
  return probeIsoMedia(async (s, l) => buf.subarray(s, Math.min(buf.length, s + l)), { size: buf.length });
};

maybe('real ffmpeg', () => {
  let dir;
  beforeAll(async () => { dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-ffmpeg-test-')); });
  afterAll(async () => { await fs.promises.rm(dir, { recursive: true, force: true }); });

  const make = (name, extra) => {
    const out = path.join(dir, name);
    const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...extra, out], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return out;
  };

  it('turns a 4K 60fps HEVC phone clip into H.264 + AAC that passes our own upload check', async () => {
    const input = make('hevc.mov', [
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=2160x3840:rate=60',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le',
      '-c:a', 'aac', '-metadata', 'location=+12.9716+077.5946/',
    ]);
    expect((await probeFile(input)).videoCodecs).toEqual(['hvc1']);

    const output = path.join(dir, 'out.mp4');
    await runFfmpeg(ffmpegArgs(input, output));
    const checked = await checkConverted(output);
    expect(checked.durationSec).toBeGreaterThan(1.5);
    expect(checked.durationSec).toBeLessThan(2.6);

    const probe = await probeFile(output);
    expect(probe.videoCodecs).toEqual(['avc1']);
    expect(probe.audioCodecs).toEqual(['mp4a']);
    // moov first (fast start), and the phone's GPS tag is gone.
    const bytes = await fs.promises.readFile(output);
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
    expect(bytes.includes('+12.9716')).toBe(false);
  }, 120_000);

  it('converts a silent clip, and one with AMR-style non-AAC sound', async () => {
    const silent = make('silent.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=30', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1']);
    const out1 = path.join(dir, 'silent-out.mp4');
    await runFfmpeg(ffmpegArgs(silent, out1));
    expect((await probeFile(out1)).audioCodecs).toEqual([]);
    await expect(checkConverted(out1)).resolves.toBeTruthy();

    const mp3 = make('mp3sound.mov', [
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le',
    ]);
    const out2 = path.join(dir, 'pcm-out.mp4');
    await runFfmpeg(ffmpegArgs(mp3, out2));
    expect((await probeFile(out2)).audioCodecs).toEqual(['mp4a']);
  }, 120_000);

  it('cuts a clip longer than 60 seconds to 60', async () => {
    const long = make('long.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=64:size=160x90:rate=5', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1']);
    const out = path.join(dir, 'long-out.mp4');
    await runFfmpeg(ffmpegArgs(long, out));
    expect((await checkConverted(out)).durationSec).toBeLessThanOrEqual(60.5);
  }, 120_000);

  it('fails cleanly (not retryable) on a file that is not a video', async () => {
    const junk = path.join(dir, 'junk');
    await fs.promises.writeFile(junk, 'File not found');
    await expect(runFfmpeg(ffmpegArgs(junk, path.join(dir, 'junk-out.mp4')))).rejects.toMatchObject({ name: 'ReelConvertError', retry: false });
  }, 60_000);

  it('stops at the time limit', async () => {
    const input = make('slow.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=30:size=1920x1080:rate=30', '-c:v', 'libx264', '-preset', 'ultrafast']);
    await expect(runFfmpeg(ffmpegArgs(input, path.join(dir, 'slow-out.mp4')), { timeoutMs: 50 })).rejects.toThrow(/timed out/);
  }, 60_000);
});

if (!usable) {
  it('real-ffmpeg checks skipped: ffmpeg with libx264 + libx265 is not installed here', () => {
    expect(usable).toBe(false);
  });
}
