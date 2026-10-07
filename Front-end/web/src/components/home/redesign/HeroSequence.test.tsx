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

describe('HERO_LAYOUT_SCRIPT — the pre-paint twin of pickSequence', () => {
  // The inline script cannot import pickSequence (it runs before any bundle), so it is
  // a hand-written copy. Run it against every signal combination and require the same
  // answer: if the two ever disagree, the page paints one layout and switches to the
  // other — the exact jump this script exists to remove.
  const { HERO_LAYOUT_SCRIPT, LAYOUT_CLASS } = jest.requireActual('./HeroSequence') as typeof import('./HeroSequence');

  function runScript(signals: DeviceSignals, opts: { noConnection?: boolean } = {}) {
    const el = document.createElement('div');
    const fakeWindow = {
      matchMedia: (q: string) => ({ matches: q.includes('reduce') ? signals.reducedMotion : signals.isDesktop }),
      navigator: {
        ...(opts.noConnection ? {} : { connection: { saveData: signals.saveData } }),
        deviceMemory: signals.deviceMemory,
      },
    };
    const fakeDocument = { currentScript: { parentElement: el } };
    // The script reads the globals `window` and `document`; shadow them.
    new Function('window', 'document', HERO_LAYOUT_SCRIPT)(fakeWindow, fakeDocument);
    return el.classList.contains(LAYOUT_CLASS);
  }

  const memories = [undefined, 0, 0.5, 1, 1.99, 2, 4, 8];
  for (const isDesktop of [false, true]) {
    for (const reducedMotion of [false, true]) {
      for (const saveData of [false, true]) {
        for (const deviceMemory of memories) {
          const s: DeviceSignals = { isDesktop, reducedMotion, saveData, deviceMemory };
          it(`agrees with pickSequence for ${JSON.stringify(s)}`, () => {
            expect(runScript(s)).toBe(pickSequence(s) !== null);
          });
        }
      }
    }
  }

  it('treats a missing Network Information API as "not saving data", like readDeviceSignals', () => {
    expect(runScript(phone, { noConnection: true })).toBe(true);
  });

  it('never throws, even with no parent or no matchMedia', () => {
    expect(() => new Function('window', 'document', HERO_LAYOUT_SCRIPT)({ navigator: {} }, { currentScript: null })).not.toThrow();
    expect(() => new Function('window', 'document', HERO_LAYOUT_SCRIPT)({ navigator: {} }, { currentScript: { parentElement: document.createElement('div') } })).not.toThrow();
  });
});
