import fs from 'node:fs';
import path from 'node:path';
import {
  pickSequence,
  readDeviceSignals,
  DESKTOP_MEDIA_QUERY,
  type DeviceSignals,
} from './HeroSequence';
import { heroSequence, heroSequenceMobile } from './homeContent';

/** Signals for a healthy phone: not desktop, motion allowed, no data saver. */
const phone: DeviceSignals = {
  isDesktop: false,
  reducedMotion: false,
  saveData: false,
  deviceMemory: 4,
};
const desktop: DeviceSignals = { ...phone, isDesktop: true, deviceMemory: 8 };

const BYTES_PER_PIXEL = 4; // decoded ImageBitmap
function decodedMegabytes(seq: typeof heroSequence) {
  return (seq.naturalWidth * seq.naturalHeight * BYTES_PER_PIXEL * seq.count) / 1e6;
}

describe('pickSequence — which frame set (if any) a device scrubs', () => {
  it('gives phones the mobile set, not the desktop one', () => {
    expect(pickSequence(phone)).toBe(heroSequenceMobile);
  });

  it('gives desktops the full-resolution set', () => {
    expect(pickSequence(desktop)).toBe(heroSequence);
  });

  it('opts out entirely under prefers-reduced-motion, at every width', () => {
    expect(pickSequence({ ...phone, reducedMotion: true })).toBeNull();
    expect(pickSequence({ ...desktop, reducedMotion: true })).toBeNull();
  });

  it('opts out under data-saver — the frames are the single biggest download', () => {
    expect(pickSequence({ ...phone, saveData: true })).toBeNull();
    expect(pickSequence({ ...desktop, saveData: true })).toBeNull();
  });

  it('opts out on sub-2GB devices', () => {
    expect(pickSequence({ ...phone, deviceMemory: 1 })).toBeNull();
    expect(pickSequence({ ...phone, deviceMemory: 0.5 })).toBeNull();
  });

  it('does not penalize browsers that do not report deviceMemory (Safari)', () => {
    expect(pickSequence({ ...phone, deviceMemory: undefined })).toBe(heroSequenceMobile);
    // 0 is "not reported", not "no memory" — must not be read as a low-end device.
    expect(pickSequence({ ...phone, deviceMemory: 0 })).toBe(heroSequenceMobile);
  });
});

describe('mobile frame budget', () => {
  // The reason a separate set exists at all: HeroSequence holds every decoded
  // frame for the life of the section, and the desktop set at ~674 MB is past
  // what iOS Safari kills a tab over. If someone points mobile at a heavier set,
  // this fails before a phone does.
  it('keeps decoded-bitmap memory well inside a mobile tab budget', () => {
    expect(decodedMegabytes(heroSequenceMobile)).toBeLessThan(120);
    expect(decodedMegabytes(heroSequence)).toBeGreaterThan(120); // why mobile can't reuse it
  });

  it('is a strict subset of the desktop set — fewer, smaller frames', () => {
    expect(heroSequenceMobile.count).toBeLessThan(heroSequence.count);
    expect(heroSequenceMobile.naturalWidth).toBeLessThan(heroSequence.naturalWidth);
  });

  it('preserves the desktop aspect ratio, so both scrub the same framing', () => {
    const ratio = (s: typeof heroSequence) => s.naturalWidth / s.naturalHeight;
    expect(ratio(heroSequenceMobile)).toBeCloseTo(ratio(heroSequence), 2);
  });
});

describe('frame assets on disk match the declared config', () => {
  // Drift guard. `count` is what the client requests; if a regenerated set has
  // fewer files than declared, the extra frames 404 silently and the scrub just
  // stops moving near the end — exactly the kind of failure nobody notices in a
  // manual smoke test.
  const publicDir = path.join(__dirname, '..', '..', '..', '..', 'public');

  for (const [label, seq] of [
    ['desktop', heroSequence],
    ['mobile', heroSequenceMobile],
  ] as const) {
    it(`${label}: every declared frame exists, and none are unused`, () => {
      const dir = path.join(publicDir, seq.dir.replace(/^\//, ''));
      expect(fs.existsSync(dir)).toBe(true);

      const onDisk = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(seq.prefix) && f.endsWith(`.${seq.ext}`));
      expect(onDisk).toHaveLength(seq.count);

      const first = `${seq.prefix}${'1'.padStart(seq.pad, '0')}.${seq.ext}`;
      const last = `${seq.prefix}${String(seq.count).padStart(seq.pad, '0')}.${seq.ext}`;
      expect(fs.existsSync(path.join(dir, first))).toBe(true);
      expect(fs.existsSync(path.join(dir, last))).toBe(true);
    });
  }

  it('mobile frames are small enough to ship over mobile data', () => {
    const dir = path.join(publicDir, heroSequenceMobile.dir.replace(/^\//, ''));
    const bytes = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(`.${heroSequenceMobile.ext}`))
      .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    expect(bytes / 1e6).toBeLessThan(1.5);
  });
});

describe('readDeviceSignals', () => {
  function stubWindow(over: {
    matches?: (q: string) => boolean;
    saveData?: boolean;
    deviceMemory?: number;
  }) {
    return {
      matchMedia: (q: string) => ({ matches: over.matches ? over.matches(q) : false }),
      navigator: {
        connection: over.saveData === undefined ? undefined : { saveData: over.saveData },
        deviceMemory: over.deviceMemory,
      },
    } as unknown as Window;
  }

  it('reads the desktop breakpoint, motion, data-saver and memory', () => {
    const win = stubWindow({
      matches: (q) => q === DESKTOP_MEDIA_QUERY,
      saveData: true,
      deviceMemory: 8,
    });
    expect(readDeviceSignals(win)).toEqual({
      isDesktop: true,
      reducedMotion: false,
      saveData: true,
      deviceMemory: 8,
    });
  });

  it('treats a missing Network Information API as "not saving data"', () => {
    expect(readDeviceSignals(stubWindow({})).saveData).toBe(false);
  });
});
