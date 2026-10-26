/**
 * The chime: three bell-like notes (3 partials each) through a limiter, loud
 * enough to hear in an office; silent when muted or before the first gesture;
 * never throws.
 */

type Param = { value: number; setValueAtTime: jest.Mock; exponentialRampToValueAtTime: jest.Mock };
const param = (value = 0): Param => ({ value, setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() });

function fakeContext(state: 'running' | 'suspended' = 'running') {
  const oscillators: { frequency: Param; start: jest.Mock }[] = [];
  const gains: { gain: Param }[] = [];
  const compressors: object[] = [];
  const node = <T extends object>(extra: T) => ({ ...extra, connect: jest.fn((n) => n) });
  class Ctx {
    state = state;
    currentTime = 1;
    destination = {};
    // No user gesture yet: the browser leaves the context suspended.
    resume = jest.fn(() => Promise.resolve());
    createOscillator() { const o = node({ type: '', frequency: param(), start: jest.fn(), stop: jest.fn() }); oscillators.push(o); return o; }
    createGain() { const g = node({ gain: param(1) }); gains.push(g); return g; }
    createDynamicsCompressor() {
      const c = node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
      compressors.push(c);
      return c;
    }
  }
  return { Ctx, oscillators, gains, compressors };
}

function load(state?: 'running' | 'suspended') {
  const fake = fakeContext(state);
  (window as unknown as { AudioContext: unknown }).AudioContext = fake.Ctx;
  let mod!: typeof import('./notificationChime');
  jest.isolateModules(() => { mod = require('./notificationChime'); });
  return { mod, ...fake };
}

beforeEach(() => localStorage.clear());

it('plays a rising three-note chime, three partials per note, through one limiter', () => {
  const { mod, oscillators, compressors, gains } = load();
  mod.arm();
  mod.chime();
  expect(oscillators).toHaveLength(9);
  expect(compressors).toHaveLength(1);
  const fundamentals = [0, 3, 6].map((i) => oscillators[i].frequency.value);
  expect(fundamentals).toEqual([880, 1108.73, 1318.51]);
  // Struck loud (the old chime peaked at 0.07).
  const peaks = gains.flatMap((g) => g.gain.exponentialRampToValueAtTime.mock.calls.map((c) => c[0] as number));
  expect(Math.max(...peaks)).toBeGreaterThanOrEqual(0.5);
  // Second chime reuses the same limiter.
  mod.chime();
  expect(compressors).toHaveLength(1);
});

it('is silent when muted', () => {
  const { mod, oscillators } = load();
  mod.setMuted(true);
  mod.arm();
  mod.chime();
  expect(oscillators).toHaveLength(0);
  mod.setMuted(false);
  mod.chime();
  expect(oscillators).toHaveLength(9);
});

it('is silent before the browser allows audio, and never throws', () => {
  const { mod, oscillators } = load('suspended');
  mod.arm();
  expect(() => mod.chime()).not.toThrow();
  expect(oscillators).toHaveLength(0);
});

it('the work alert is a different sound: falling, played twice, triangle notes', () => {
  const { mod, oscillators } = load();
  mod.arm();
  mod.alert();
  // 2 rings × 2 notes × 3 partials
  expect(oscillators).toHaveLength(12);
  const fundamentals = [0, 3, 6, 9].map((i) => oscillators[i].frequency.value);
  expect(fundamentals).toEqual([987.77, 783.99, 987.77, 783.99]); // ding-dong, ding-dong
  expect(fundamentals[1]).toBeLessThan(fundamentals[0]); // falls, where the chat chime rises
  expect((oscillators[0] as unknown as { type: string }).type).toBe('triangle');
});

it('the work alert respects mute and never throws', () => {
  const { mod, oscillators } = load();
  mod.setMuted(true);
  mod.arm();
  expect(() => mod.alert()).not.toThrow();
  expect(oscillators).toHaveLength(0);
});
