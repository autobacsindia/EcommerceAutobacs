/**
 * Festive cursor: the diya pointer (CSS) and the sparkle trail (engine).
 */
import fs from 'fs';
import path from 'path';
import { createEngine } from '../effects/engine';

describe('engine.trail', () => {
  let frames: FrameRequestCallback[];
  let fills: number;

  beforeEach(() => {
    frames = [];
    fills = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const ctx = {
      setTransform: jest.fn(), clearRect: jest.fn(), beginPath: jest.fn(), arc: jest.fn(), moveTo: jest.fn(),
      quadraticCurveTo: jest.fn(), fill: () => { fills++; }, globalAlpha: 1, fillStyle: '',
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    document.querySelectorAll('[data-festival-fx]').forEach((el) => el.remove());
  });

  const runFrame = (t: number) => {
    const cb = frames.shift();
    cb?.(t);
  };

  it('a frantic mouse cannot grow the particle count without bound', () => {
    const engine = createEngine({ colors: ['#ffd166'], lamp: '🪔', glow: 'gold', quality: 1 });
    for (let i = 0; i < 1000; i++) engine.trail(i, i);
    runFrame(16);
    // A star is two fills (halo + star), a dot one; the cap is 90 sparks (+2 from the last add of up to 3).
    expect(fills).toBeLessThanOrEqual(2 * 92);
    expect(fills).toBeGreaterThan(0);
    engine.destroy();
  });

  it('the overlay never takes clicks and is hidden from screen readers, and goes away when the sparks fade', () => {
    const engine = createEngine({ colors: ['#ffd166'], lamp: '🪔', glow: 'gold', quality: 1 });
    engine.trail(10, 10);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-festival-fx="canvas"]')!;
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    // Sparks live under 50 frames; run well past that.
    for (let t = 1; t < 120 && frames.length; t++) runFrame(t * 16.67);
    expect(document.querySelector('[data-festival-fx="canvas"]')).toBeNull();
    expect(frames).toHaveLength(0); // no idle animation loop left behind
  });
});

describe('diya cursor CSS', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');
  const start = css.indexOf('/* Festive cursor');
  const block = css.slice(start, css.indexOf('/* Rangoli accent', start)).replace(/\/\*[\s\S]*?\*\//g, '');

  it('exists, only for a real mouse, only while a festival is live', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain('@media (hover: hover) and (pointer: fine)');
    // Every selector in the block is scoped to html[data-festival-cursor] (never set on checkout/sign-in).
    const selectors = block.match(/^\s*([^@/{}\n][^{}]*)\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s.trim().startsWith('html[data-festival-cursor]')).toBe(true);
  });

  it('always names a system fallback cursor, and keeps text fields and disabled controls honest', () => {
    const images = block.match(/cursor:\s*url\([^;]+;/g) ?? [];
    expect(images.length).toBe(2);
    for (const rule of images) expect(rule).toMatch(/,\s*(auto|pointer);$/);
    expect(block).toMatch(/textarea[^{]*\{\s*cursor: text;/);
    expect(block).toMatch(/:disabled[^{]*\{\s*cursor: not-allowed;/);
  });

  it('leaves drag handles their grab hand', () => {
    expect(block).toContain(":not([class*='cursor-grab']) {");
  });

  it('page-styled clickables tagged by FestivalEffects get the diya too, never a disabled one', () => {
    expect(block).toMatch(/html\[data-festival-cursor\] \[data-fx-cursor='base'\]\s*\{\s*cursor: url\(/);
    expect(block).toContain("[data-fx-cursor='hand']:not(:disabled, [aria-disabled='true'])");
  });
});
