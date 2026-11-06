/**
 * Festival effects engine — sparks, the flying lamp, badge pop, fireworks.
 *
 * Loaded ONLY by dynamic import, after the page is interactive and only while a
 * festival is live, so it costs nothing on first load and nothing all year.
 * Plain canvas + Web Animations, no library.
 *
 * Safety rules baked in:
 *  - every overlay is `pointer-events: none` and aria-hidden — it can never
 *    swallow a tap or be read out by a screen reader;
 *  - the canvas exists only while something is animating (no idle rAF loop);
 *  - particle counts scale down on phones and low-end devices.
 * Callers are responsible for not loading this under prefers-reduced-motion.
 */

export interface EngineOptions {
  colors: string[];
  lamp: string;
  glow: string;
  /** 0–1 particle budget multiplier; see computeQuality(). */
  quality: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
  gravity: number; drag: number;
  /** Rockets explode into a burst when they run out of life. */
  rocket?: boolean;
}

const Z_INDEX = '9990';
const MAX_DPR = 2;

/** Fewer particles on small screens and weak hardware. */
export function computeQuality(): number {
  if (typeof window === 'undefined') return 0.5;
  let q = 1;
  if (window.innerWidth < 640) q *= 0.55;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) || (nav.deviceMemory && nav.deviceMemory <= 4)) q *= 0.6;
  return Math.max(0.25, q);
}

/** The cart button that is actually on screen (desktop and phone headers differ). */
function findVisible(selector: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

export function createEngine(opts: EngineOptions) {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let particles: Particle[] = [];
  let raf = 0;
  let last = 0;
  let launchUntil = 0;
  let nextLaunch = 0;
  const nodes = new Set<HTMLElement>();

  const pick = () => opts.colors[Math.floor(Math.random() * opts.colors.length)];
  const n = (base: number) => Math.max(3, Math.round(base * opts.quality));

  const ensureCanvas = () => {
    if (canvas && ctx) return;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.festivalFx = 'canvas';
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: Z_INDEX,
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  };

  const resize = () => {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const removeCanvas = () => {
    window.removeEventListener('resize', resize);
    canvas?.remove();
    canvas = null;
    ctx = null;
  };

  const spray = (x: number, y: number, count: number, speed: number, life: number, size: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life, maxLife: life, size: size * (0.6 + Math.random() * 0.8),
        color: pick(), gravity: 0.06, drag: 0.96,
      });
    }
  };

  const launch = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    particles.push({
      x: w * (0.15 + Math.random() * 0.7), y: h + 4,
      vx: (Math.random() - 0.5) * 1.2, vy: -(h / 70) * (0.8 + Math.random() * 0.35),
      life: 48 + Math.random() * 14, maxLife: 60, size: 2.4,
      color: '#fff3b0', gravity: 0.12, drag: 0.995, rocket: true,
    });
  };

  const frame = (t: number) => {
    if (!ctx) return;
    const dt = Math.min(3, last ? (t - last) / 16.67 : 1);
    last = t;

    if (t < launchUntil && t >= nextLaunch) {
      launch();
      nextLaunch = t + 260 / Math.max(0.4, opts.quality);
    }

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const next: Particle[] = [];
    for (const p of particles) {
      p.vx *= p.drag ** dt;
      p.vy = p.vy * p.drag ** dt + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.rocket) spray(p.x, p.y, n(64), 5.2, 60, 2.8);
        continue;
      }
      const alpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      next.push(p);
    }
    ctx.globalAlpha = 1;
    particles = next;

    if (particles.length || t < launchUntil) {
      raf = requestAnimationFrame(frame);
    } else {
      raf = 0;
      last = 0;
      removeCanvas();
    }
  };

  const run = () => {
    ensureCanvas();
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const addNode = (el: HTMLElement) => {
    el.setAttribute('aria-hidden', 'true');
    el.style.pointerEvents = 'none';
    el.style.position = 'fixed';
    el.style.zIndex = Z_INDEX;
    document.body.appendChild(el);
    nodes.add(el);
    return () => { el.remove(); nodes.delete(el); };
  };

  return {
    /** Small spark burst, e.g. from the add-to-cart button. */
    burst(x: number, y: number) {
      spray(x, y, n(22), 3.4, 34, 2.4);
      run();
    },

    /** 0.5s tap sparkle on primary buttons. */
    sparkle(x: number, y: number) {
      spray(x, y, n(10), 2.2, 26, 1.8);
      run();
    },

    /** The glowing lamp arcs from (x, y) to the cart; the badge pops on landing. */
    flyToCart(x: number, y: number): Promise<void> {
      const cart = findVisible('.sh-cart, [data-cart-icon]');
      if (!cart || typeof document.body.animate !== 'function') return Promise.resolve();
      const r = cart.getBoundingClientRect();
      const tx = r.left + r.width / 2;
      const ty = r.top + r.height / 2;

      const lamp = document.createElement('span');
      lamp.textContent = opts.lamp;
      Object.assign(lamp.style, {
        left: '0', top: '0', fontSize: '26px', lineHeight: '1',
        filter: `drop-shadow(0 0 8px ${opts.glow}) drop-shadow(0 0 16px ${opts.glow})`,
        willChange: 'transform, opacity',
      });
      const remove = addNode(lamp);

      const midX = (x + tx) / 2;
      const midY = Math.min(y, ty) - 80;
      const at = (px: number, py: number, s: number) => `translate(${px - 13}px, ${py - 13}px) scale(${s})`;
      const anim = lamp.animate(
        [
          { transform: at(x, y, 0.6), opacity: 0 },
          { transform: at(x, y, 1.1), opacity: 1, offset: 0.12 },
          { transform: at(midX, midY, 1), opacity: 1, offset: 0.55 },
          { transform: at(tx, ty, 0.45), opacity: 0.9 },
        ],
        { duration: 720, easing: 'cubic-bezier(.45,.05,.55,.95)' },
      );
      return anim.finished.then(
        () => {
          remove();
          this.popBadge();
          this.sparkle(tx, ty);
        },
        () => remove(),
      );
    },

    /** Scale-pop the cart count. The number itself is React's, untouched here. */
    popBadge() {
      const badge = findVisible('.sh-cart-count, [data-cart-count]');
      if (!badge || typeof badge.animate !== 'function') return;
      badge.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
        { duration: 420, easing: 'ease-out' },
      );
    },

    /** Rockets for `durationMs`; particles then fade out on their own. */
    fireworks(durationMs = 3000) {
      const now = performance.now();
      launchUntil = now + durationMs;
      nextLaunch = now;
      run();
    },

    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      particles = [];
      launchUntil = 0;
      removeCanvas();
      nodes.forEach((el) => el.remove());
      nodes.clear();
    },
  };
}

export type FestivalEngine = ReturnType<typeof createEngine>;
