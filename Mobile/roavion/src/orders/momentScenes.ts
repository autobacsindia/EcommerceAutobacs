/**
 * COPIED VERBATIM from the website: Front-end/web/src/components/orders/orderMomentScenes.ts.
 * Change the website first, then re-copy here, so the app and the site always show the
 * same picture. (Only this header and the import path differ.) The CSS that animates it
 * is momentCss.ts, copied from the om-* block at the end of the website's globals.css.
 *
 * The order-moment drawings ("Boxy", owner-picked style A, 2026-11-26): hand-built
 * SVG (viewBox 320×180) animated by the `om-*` keyframes in app/globals.css. Boxy is
 * the Autobacs parcel with a face; his mood follows the update. No animation
 * library — each scene is a few KB of markup.
 *
 * ONE RULE makes reduced motion and play-once free: an element's normal style IS its
 * final frame; keyframes only describe where it starts (`both` fill). Switching
 * animation off (`.om-scene.om-still`, or prefers-reduced-motion) leaves the finished
 * picture. Elements that only exist mid-animation (sparkles, confetti, coins, hearts)
 * rest at opacity 0. No SMIL: CSS is the only thing that moves, so "off" means off.
 *
 * Never put an SVG `transform` attribute and a CSS-animated transform on the same
 * element: position with an outer <g transform>, animate an inner <g class="om-a">.
 *
 * Markup is built as strings from constants only. The two dynamic values (the late
 * scene's promised day and the moved date) go through `esc()`, and the caller passes
 * already-validated "Mon 30" strings. Nothing user- or server-authored is
 * interpolated raw — the team's note is rendered as React text, never here.
 */
import type { MomentKey } from './momentCopy';

const K = '#E3B776', K2 = '#C08A44', KD = '#8a5a1c', G = '#EF9F27', B = '#3B9EE8', BD = '#1A6FB5',
  INK = '#0f1111', GR = '#c9d1ce', LT = '#dff0fc', CHEEK = '#f2a490';
const DISPLAY = 'font-family="inherit" font-weight="800"';
const BODY = 'font-family="inherit"';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** An animated group: `anim` is the CSS animation shorthand (om-* name first). */
const A = (anim: string, inner: string, style = '') => `<g class="om-a" style="${style}animation:${anim}">${inner}</g>`;
/** Position (and optionally scale) a piece. Never animated itself. */
const at = (x: number, y: number, inner: string, s = 1) => `<g transform="translate(${x} ${y})${s !== 1 ? ` scale(${s})` : ''}">${inner}</g>`;

const STAR = '<path d="M0-5 L1.4-1.4 5 0 1.4 1.4 0 5-1.4 1.4-5 0-1.4-1.4z"/>';
function bursts(cx: number, cy: number, n: number, delay: number, colors: string[], dist: number, shape: 'star' | 'conf') {
  let s = '';
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
    const d = dist * (i % 3 === 0 ? 1 : 0.75);
    const dx = Math.round(Math.cos(ang) * d);
    const dy = Math.round(Math.sin(ang) * d * 0.8 - 10);
    const r = (i % 2 ? 1 : -1) * (120 + i * 25);
    const sh = shape === 'star' ? STAR : (i % 3 === 0 ? '<circle r="3"/>' : '<rect x="-3" y="-1.6" width="6" height="3.2" rx="1"/>');
    s += `<g transform="translate(${cx} ${cy})"><g class="om-a" fill="${colors[i % colors.length]}" style="opacity:0;--dx:${dx}px;--dy:${dy}px;--r:${r}deg;animation:om-burst 1.3s ${(delay + i * 0.02).toFixed(2)}s cubic-bezier(.15,.7,.35,1) both">${sh}</g></g>`;
  }
  return s;
}
const POP = (d: number) => `om-pop .45s ${d}s cubic-bezier(.34,1.56,.64,1) both`;
const tick = (cx: number, cy: number, delay: number, col = B) =>
  at(cx, cy, A(POP(delay), `<circle r="14" fill="${col}"/><path d="M-6 0.5 L-1.5 5 L6.5 -4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`));
const closedBox = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${K}" stroke="${K2}" stroke-width="2"/><rect x="${x}" y="${y}" width="${w}" height="9" fill="${K2}" opacity=".35"/>`;

/* ── Boxy ────────────────────────────────────────────────────────────────────
   Local coordinates: bottom-centre at (0,0), body 56×46. */
type Mood = 'happy' | 'grin' | 'wink' | 'sorry' | 'calm';
type Arms = 'side' | 'up' | 'hold' | 'wave' | 'waveL' | 'phone';
function boxy({ mood = 'happy', arms = 'side', open = false, wave = 0, blinkAt = 1.2, prop = '' }:
  { mood?: Mood; arms?: Arms; open?: boolean; wave?: number; blinkAt?: number; prop?: string } = {}) {
  const arm = (d: string, hx: number, hy: number) =>
    `<path d="${d}" fill="none" stroke="${KD}" stroke-width="3.4" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="3.4" fill="${K}" stroke="${KD}" stroke-width="1.6"/>`;
  const L = { side: arm('M-28 -20 q-8 5 -9 13', -37, -7), up: arm('M-28 -24 q-10 -6 -12 -20', -40, -44), hold: arm('M-28 -22 q-4 12 12 12', -16, -10) };
  const R = {
    side: arm('M28 -20 q8 5 9 13', 37, -7), up: arm('M28 -24 q10 -6 12 -20', 40, -44), hold: arm('M28 -22 q4 12 -12 12', 16, -10),
    phone: `${arm('M28 -18 q9 -4 7 -16', 35, -34)}<rect x="31" y="-46" width="9" height="16" rx="2.5" fill="${INK}"/><rect x="33" y="-43.5" width="5" height="9" rx="1" fill="#5fb0ee"/>`,
  };
  const waveArm = (side: 'L' | 'R') =>
    A(`om-wave .55s ${wave}s ease-in-out 3 both`, side === 'R' ? R.up : L.up, `transform-origin:${side === 'R' ? 'left' : 'right'} bottom;`);
  let la = L.side, ra = R.side;
  if (arms === 'up') { la = L.up; ra = R.up; }
  if (arms === 'hold') { la = L.hold; ra = R.hold; }
  if (arms === 'wave') ra = waveArm('R');
  if (arms === 'waveL') la = waveArm('L');
  if (arms === 'phone') ra = R.phone;

  const eye = (x: number) => `<circle cx="${x}" cy="-26" r="3.3" fill="${INK}"/><circle cx="${x + 1.1}" cy="-27.2" r="1.1" fill="#fff"/>`;
  const line = (d: string) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
  let eyes = eye(-11) + eye(11);
  if (mood === 'wink') eyes = eye(-11) + line('M7 -26 q4 -4 8 0');
  if (mood === 'calm') eyes = line('M-15 -26 q4 3 8 0 M7 -26 q4 3 8 0');
  const brows = mood === 'sorry' ? `<path d="M-16 -32 l8 -3 M16 -32 l-8 -3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` : '';
  const mouth = {
    happy: line('M-6 -15 q6 6 12 0'),
    wink: line('M-6 -15 q6 6 12 0'),
    grin: `<path d="M-8 -17 h16 q0 10 -8 10 q-8 0 -8 -10z" fill="${INK}"/><path d="M-4 -9.5 q4 -3 8 0 q-4 2 -8 0z" fill="#e0675a"/>`,
    sorry: line('M-5 -12 q5 -4 10 0'),
    calm: line('M-5 -14 q5 3 10 0'),
  }[mood];
  const top = open
    ? `<path d="M-28 -46 L-42 -58 L-16 -60 L-4 -46z" fill="${K}" stroke="${K2}" stroke-width="2" stroke-linejoin="round"/><path d="M28 -46 L42 -58 L16 -60 L4 -46z" fill="${K}" stroke="${K2}" stroke-width="2" stroke-linejoin="round"/><rect x="-27" y="-46" width="54" height="6" fill="${KD}" opacity=".35"/>`
    : `<rect x="-5" y="-46" width="10" height="13" fill="${G}"/>`;
  return `<ellipse cx="0" cy="2" rx="30" ry="4" fill="#000" opacity=".08"/>
    <ellipse cx="-12" cy="0" rx="6.5" ry="3.2" fill="${KD}"/><ellipse cx="12" cy="0" rx="6.5" ry="3.2" fill="${KD}"/>
    ${la}${ra}
    <rect x="-28" y="-46" width="56" height="46" rx="7" fill="${K}" stroke="${K2}" stroke-width="2"/>
    <rect x="-28" y="-6" width="56" height="6" rx="3" fill="${K2}" opacity=".3"/>
    ${top}${A(`om-blink 3.2s ${blinkAt}s both`, eyes)}${brows}
    <circle cx="-19" cy="-17" r="4" fill="${CHEEK}" opacity=".6"/><circle cx="19" cy="-17" r="4" fill="${CHEEK}" opacity=".6"/>
    ${mouth}${prop}`;
}

/* ── Scenery ─────────────────────────────────────────────────────────────── */
const sky = () => `<defs><linearGradient id="om-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe8fb"/><stop offset="1" stop-color="#f4fafe"/></linearGradient></defs><rect width="320" height="180" fill="url(#om-sky)"/>`;
const sun = (x = 268, y = 34) => `<circle cx="${x}" cy="${y}" r="20" fill="#ffe3a6" opacity=".55"/><circle cx="${x}" cy="${y}" r="13" fill="#ffd27a"/>`;
const cloud = (x: number, y: number, s: number, d: number) =>
  at(x, y, A(`om-drift 4s ${d}s ease-out both`, '<path d="M0 10 a9 9 0 0 1 9 -9 a12 12 0 0 1 22 -2 a8 8 0 0 1 13 9 a5 5 0 0 1 0 2z" fill="#fff" opacity=".95"/>'), s);
const birds = (d: number) => A(`om-drift 3.5s ${d}s ease-out both`, '<path d="M60 40 q4 -4 8 0 q4 -4 8 0 M84 30 q3 -3 6 0 q3 -3 6 0" fill="none" stroke="#6f8f9f" stroke-width="1.6" stroke-linecap="round"/>');
const grass = (y = 150) => `<rect x="0" y="${y}" width="320" height="${180 - y}" fill="#dfe9d9"/><rect x="0" y="${y}" width="320" height="3" fill="#cddcc5"/>`;
const heart = (x: number, y: number, d: number, c = '#f07a8a', s = 1) =>
  at(x, y, A(`om-rise-fade 1.8s ${d}s ease-out both`, `<path d="M0 3 C-7 -3 -5 -9 0 -6 C5 -9 7 -3 0 3z" fill="${c}"/>`, 'opacity:0;'), s);
const chip = (x: number, y: number, w: number, t: string, d: number, col = B) =>
  at(x, y, A(POP(d), `<rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="11" fill="#fff" stroke="${col}" stroke-width="1.6"/><circle cx="${-w / 2 + 11}" cy="0" r="6" fill="${col}"/><path d="M${-w / 2 + 8} 0.3 l2 2 l4 -4.3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="${-w / 2 + 21}" y="3.5" ${BODY} font-weight="600" font-size="9.5" fill="${INK}">${t}</text>`));
const bubble = (x: number, y: number, d: number, inner: string, origin = 'left bottom') =>
  at(x, y, A(POP(d), inner, `transform-origin:${origin};`));
const road = (y = 146) => `<rect x="0" y="${y}" width="320" height="22" fill="#d7dddb"/>
  ${A('om-slide-left .4s linear 0s 7', Array.from({ length: 10 }, (_, i) => `<rect x="${i * 40}" y="${y + 10}" width="18" height="3" rx="1.5" fill="#fff"/>`).join(''))}`;
const HILLS = '<path d="M0 146 C40 120 70 118 110 132 S180 112 230 126 S290 118 320 128 V146 H0z" fill="#e3ebe8"/>';
const TREES = A('om-slide-left-long 3s linear both', [30, 120, 210, 300, 390].map((x) =>
  `<g transform="translate(${x} 118)"><rect x="-1.5" y="0" width="3" height="28" fill="#a99a80"/><circle cy="-6" r="11" fill="#b9d3a9"/><circle cx="-6" cy="-1" r="7" fill="#a9c79a"/></g>`).join(''));
const SPEED = A('om-fade-out .8s 1.5s both', [86, 92, 98].map((y, i) => `<rect x="${52 + i * 8}" y="${y + i * 8}" width="${28 - i * 6}" height="2.5" rx="1.2" fill="#b8c3c0"/>`).join(''));

function truck() {
  const wheel = (cx: number) => A('om-spin .45s linear 0s 6', `<circle cx="${cx}" cy="136" r="11" fill="#1d2224"/><circle cx="${cx}" cy="136" r="4.5" fill="#c4c4c4"/><rect x="${cx - 1}" y="126" width="2" height="6" fill="#c4c4c4"/>`);
  return `<rect x="90" y="76" width="100" height="58" rx="5" fill="#fff" stroke="${GR}" stroke-width="2"/>
    <rect x="91" y="118" width="98" height="6" fill="${G}"/>
    <text x="140" y="102" text-anchor="middle" ${DISPLAY} font-size="14" fill="${INK}">AUTOBACS</text>
    <text x="140" y="112" text-anchor="middle" ${DISPLAY} font-size="6.5" letter-spacing="2" fill="${BD}">INDIA</text>
    <path d="M192 92 h22 a8 8 0 0 1 7 4 l9 14 v24 h-38z" fill="${B}"/>
    <path d="M198 97 h14 a4 4 0 0 1 3.5 2 l6 10 h-23.5z" fill="${LT}"/>
    <rect x="225" y="121" width="6" height="4" rx="1" fill="${G}"/>${wheel(115)}${wheel(210)}`;
}
/** The truck with Boxy peeking over the load and waving. */
const truckWithBoxy = (waveAt: number) => `${at(148, 80, boxy({ mood: 'grin', arms: 'wave', wave: waveAt, blinkAt: 2.4 }), 0.62)}${truck()}`;
const smallTruck = (x: number, y: number, inner: string) =>
  `<g transform="translate(${x} ${y}) scale(.66)">${inner}</g>`;

/** Progress dots along the top: warehouse → on the way → nearly there → you. */
const route = (to: number, d: number) => {
  const xs = [40, 120, 200, 280];
  return `<path d="M40 30 H280" stroke="#d4dcd9" stroke-width="4" stroke-linecap="round"/>
    <path d="M40 30 H${xs[to]}" stroke="${B}" stroke-width="4" stroke-linecap="round" pathLength="1" stroke-dasharray="1" class="om-a" style="animation:om-draw 1.6s ${d}s ease-in-out both"/>
    ${xs.map((x, i) => `<circle cx="${x}" cy="30" r="${i === 3 ? 7 : 5}" fill="${i <= to ? B : '#fff'}" stroke="${i <= to ? B : '#b9c4c1'}" stroke-width="2"/>`).join('')}`;
};

const calendar = (x: number, y: number, head: string, body: string) => `<g transform="translate(${x} ${y})">
  <rect width="80" height="78" rx="8" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
  <path d="M0 8 a8 8 0 0 1 8 -8 h64 a8 8 0 0 1 8 8 v11 h-80z" fill="${head}"/>
  <path d="M22 -5 v10 M58 -5 v10" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>${body}</g>`;

const house = `<rect x="150" y="26" width="140" height="124" fill="#efe7da" stroke="#e0d6c6" stroke-width="2"/>
  <rect x="196" y="56" width="50" height="94" rx="3" fill="${BD}"/><circle cx="238" cy="104" r="2.6" fill="${G}"/>
  <rect x="252" y="62" width="10" height="10" rx="2" fill="${G}"/>`;

type SceneOpts = { lateDay?: string | null; newDay?: string | null };

const SCENES: Record<MomentKey, (o: SceneOpts) => string> = {
  placed: () => `${sky()}${sun(52, 36)}${cloud(196, 26, 1, 0)}${cloud(250, 52, 0.7, 0.2)}${grass(148)}
    <g transform="translate(78 148)"><rect x="-22" y="-30" width="44" height="30" fill="#fff" stroke="${GR}" stroke-width="1.6"/><path d="M-26 -30 L0 -46 L26 -30z" fill="${G}"/><rect x="-6" y="-16" width="12" height="16" fill="${GR}"/></g>
    ${at(168, 148, A('om-land .8s .1s cubic-bezier(.3,.7,.3,1) both', boxy({ mood: 'grin', arms: 'up', blinkAt: 1.6 }), 'transform-origin:center bottom;'))}
    ${bursts(168, 96, 16, 0.8, [G, B, BD, '#f6c56c', '#f07a8a'], 84, 'conf')}
    ${bubble(232, 72, 1.05, `<path d="M-30 -14 a8 8 0 0 1 8 -8 h44 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-34 l-10 8 v-8 a8 8 0 0 1 -8 -8z" fill="#fff" stroke="${G}" stroke-width="1.8"/><text x="0" y="-2" text-anchor="middle" ${DISPLAY} font-size="10" fill="${INK}">Thank you!</text>`)}`,

  preparing: () => {
    const peg = Array.from({ length: 7 }, (_, c) => Array.from({ length: 3 }, (_, r) => `<circle cx="${30 + c * 40}" cy="${22 + r * 18}" r="1.4" fill="#d9cdb8"/>`).join('')).join('');
    const part = (ex: number, ey: number, dx: number, dy: number, d: number, inner: string) =>
      at(ex, ey, A(`om-arc .75s ${d}s cubic-bezier(.3,.6,.4,1) both`, inner, `--dx:${dx}px;--dy:${dy}px;`));
    return `<rect width="320" height="180" fill="#f6f1e8"/><rect x="14" y="10" width="292" height="68" rx="6" fill="#efe6d6"/>${peg}
    <g stroke="#b8a888" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M46 30 v28 M40 30 a6 6 0 0 1 12 0"/><path d="M262 28 l0 30 M256 28 h12"/><path d="M228 30 a7 7 0 1 0 0.1 0 M228 37 v20"/></g>
    <rect x="0" y="140" width="320" height="40" fill="#c9a67a"/><rect x="0" y="140" width="320" height="5" fill="#b38f62"/>
    ${part(148, 96, -100, -20, 0.25, '<circle r="11" fill="#cfd3d2" stroke="#8d9391" stroke-width="2"/><circle r="4" fill="#8d9391"/>')}
    ${part(173, 96, 100, -30, 0.75, `<rect x="-9" y="-11" width="18" height="20" rx="4" fill="${B}"/><rect x="-9" y="-5" width="18" height="4" fill="${BD}"/>`)}
    ${part(161, 92, -70, -60, 1.25, '<rect x="-4" y="-11" width="8" height="7" rx="1.5" fill="#fff" stroke="#8d9391" stroke-width="1.4"/><rect x="-3" y="-4" width="6" height="9" fill="#c4c4c4"/><rect x="-1" y="5" width="2" height="6" fill="#8d9391"/>')}
    ${at(160, 140, A('om-hop .45s 2.2s ease-out both', boxy({ mood: 'happy', open: true, blinkAt: 2.8 }), 'transform-origin:center bottom;'))}
    ${bursts(160, 92, 8, 1.95, [G, '#f6c56c'], 38, 'star')}
    ${chip(246, 116, 96, 'Quality checked', 2.4)}${chip(74, 116, 90, 'Part matched', 1.7, G)}`;
  },

  packed: () => {
    const shelf = (y: number) => `<rect x="0" y="${y}" width="320" height="4" fill="#d4dad8"/>` +
      [20, 52, 250, 286].map((x, i) => `<rect x="${x}" y="${y - 22 + (i % 2) * 6}" width="${26 - (i % 2) * 6}" height="${22 - (i % 2) * 6}" rx="2" fill="${K}" opacity=".45"/>`).join('');
    return `<rect width="320" height="180" fill="#eef3f6"/>${shelf(60)}${shelf(112)}<rect x="0" y="146" width="320" height="34" fill="#dde3e1"/>
    ${at(150, 148, A('om-hop .5s .2s ease-out both', boxy({ mood: 'wink', blinkAt: 3 }), 'transform-origin:center bottom;'))}
    ${at(106, 84, A('om-swing 1.3s .55s cubic-bezier(.3,.7,.3,1) both', `<path d="M-8 -10 L-12 6 M8 -10 L12 6" stroke="${B}" stroke-width="4"/><g transform="translate(0 15)"><circle r="12" fill="${G}"/><circle r="8.5" fill="#ffd27a"/><text y="2.6" text-anchor="middle" ${DISPLAY} font-size="5.6" fill="#7a4a00">READY</text></g>`, 'transform-origin:center top;'))}
    ${at(234, 72, A('om-stamp .5s 1.4s cubic-bezier(.3,.7,.3,1) both', `<circle r="24" fill="none" stroke="${B}" stroke-width="2.5"/><circle r="19" fill="none" stroke="${B}" stroke-width="1"/><text y="3.5" text-anchor="middle" ${DISPLAY} font-size="10" letter-spacing="1" fill="${B}">PACKED</text>`, 'transform:rotate(-12deg);'))}
    ${bursts(150, 96, 8, 1.6, [G, B], 50, 'star')}`;
  },

  shipped: () => `${sky()}${sun()}${cloud(40, 24, 1, 0)}${cloud(170, 40, 0.7, 0.3)}${birds(0.4)}${HILLS}${TREES}${road()}
    ${A('om-from-left-far 1.4s cubic-bezier(.2,.8,.3,1) both', A('om-bob .3s ease-in-out 0s 9', `${SPEED}${truckWithBoxy(1.4)}`))}`,

  in_transit: () => `${sky()}${cloud(140, 50, 0.7, 0)}${route(2, 0.2)}${HILLS}${road()}
    ${A('om-from-left-near 1.4s cubic-bezier(.2,.8,.3,1) both', A('om-bob .3s ease-in-out 0s 8', smallTruck(70, 40, `<g transform="translate(-60 20)">${truckWithBoxy(1.4)}</g>`)))}`,

  out_for_delivery: () => {
    const p = 'M44 140 C 110 140, 100 74, 170 82 S 250 96, 268 58';
    return `<rect width="320" height="180" fill="#eef4f1"/>
    ${[[60, 30, 70, 40], [150, 114, 60, 36], [214, 14, 70, 30], [20, 84, 50, 30], [230, 114, 70, 44]].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#dde8e3"/>`).join('')}
    <path d="M0 104 H320 M120 0 V180" stroke="#fff" stroke-width="8"/>
    <path d="${p}" fill="none" stroke="#c3ceca" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>
    <path d="${p}" fill="none" stroke="${B}" stroke-width="3.5" stroke-linecap="round" pathLength="1" stroke-dasharray="1" class="om-a" style="animation:om-draw 2s .1s ease-in-out both"/>
    <rect x="34" y="130" width="20" height="20" rx="4" fill="${INK}"/><rect x="40" y="136" width="8" height="8" rx="1" fill="${G}"/>
    ${at(268, 58, `${A('om-pulse-ring 1.2s 2s ease-out 2 both', `<circle r="12" fill="${G}"/>`, 'opacity:0;')}<path d="M0 10 C-14 -4 -10 -18 0 -18 S14 -4 0 10z" fill="${G}"/><path d="M-5 -8 L0 -12 L5 -8 V-3 H-5z" fill="#fff"/>`)}
    ${at(236, 70, A('om-hop-in 1s 1.6s cubic-bezier(.3,.6,.4,1) both', boxy({ mood: 'grin', arms: 'up', blinkAt: 2.8 }), 'transform-origin:center bottom;'), 0.48)}`;
  },

  delivery_failed: () => `<rect width="320" height="180" fill="#f3efe9"/>${house}${grass(150)}
    ${at(232, 90, A('om-knock .9s .5s ease-out both', '<path d="M0 -8 q5 8 0 16 M7 -12 q7 12 0 24" fill="none" stroke="#8d9391" stroke-width="2" stroke-linecap="round"/>', 'opacity:0;'))}
    ${at(130, 150, boxy({ mood: 'calm', arms: 'waveL', wave: 0.4, blinkAt: 1.8 }))}
    ${bubble(66, 62, 1.4, `<rect x="-44" y="-16" width="88" height="32" rx="10" fill="#fff" stroke="${G}" stroke-width="1.8"/><text y="-2" text-anchor="middle" ${BODY} font-size="8.5" fill="#5b6563">We’ll try</text><text y="10" text-anchor="middle" ${DISPLAY} font-size="10.5" fill="${INK}">again</text>`, 'center')}`,

  date_moved: ({ newDay }) => `<rect width="320" height="180" fill="#eef5fb"/><circle cx="214" cy="84" r="64" fill="#e0eefa"/>${grass(150)}
    ${at(96, 150, A('om-hop .45s 1.5s ease-out both', boxy({ mood: 'happy', arms: 'wave', wave: 1.4, blinkAt: 2.2 }), 'transform-origin:center bottom;'))}
    ${calendar(174, 42, B, A('om-flip .6s 1s cubic-bezier(.3,.7,.3,1) both',
      `<text x="40" y="38" text-anchor="middle" ${BODY} font-size="9" fill="#5b6563">New date</text><text x="40" y="60" text-anchor="middle" ${DISPLAY} font-size="${newDay ? 17 : 13}" fill="${INK}">${newDay ? esc(newDay) : 'Updated'}</text>`,
      'transform-origin:center top;'))}
    ${bursts(214, 62, 10, 1.5, [B, G], 48, 'star')}`,

  delivered: () => `<rect width="320" height="180" fill="#eaf2ec"/>${sun(40, 30)}
    <rect x="96" y="20" width="132" height="130" fill="#f4ede2" stroke="#e0d6c6" stroke-width="2"/>
    <path d="M88 22 L162 2 L236 22z" fill="${G}" opacity=".85"/>
    <rect x="134" y="48" width="56" height="102" fill="#ffe2a0"/><circle cx="162" cy="78" r="14" fill="#fff3d1"/>
    ${A('om-door 1s .2s cubic-bezier(.4,.1,.3,1) both', `<rect x="134" y="48" width="56" height="102" rx="2" fill="${BD}"/><circle cx="182" cy="102" r="2.6" fill="${G}"/>`, 'transform-origin:left center;transform:scaleX(.22);')}
    <rect x="200" y="44" width="10" height="10" rx="2" fill="${G}"/>
    ${grass(150)}<rect x="124" y="148" width="78" height="9" rx="2" fill="#c6553f"/><text x="163" y="155" text-anchor="middle" ${DISPLAY} font-size="6" letter-spacing="1.5" fill="#ffe7df">WELCOME</text>
    ${at(164, 148, A('om-hop-in 1s .9s cubic-bezier(.3,.6,.4,1) both', boxy({ mood: 'grin', arms: 'up', blinkAt: 2.6 }), 'transform-origin:center bottom;'))}
    ${bursts(164, 96, 16, 1.8, [G, B, BD, '#f6c56c', '#f07a8a'], 90, 'conf')}
    ${heart(122, 86, 2.0)}${heart(206, 80, 2.3, '#f6a3ae', 0.8)}${tick(262, 70, 2.2)}`,

  partly: () => `${sky()}${sun(40, 32)}${cloud(220, 22, 0.8, 0)}${HILLS}${road()}
    <g transform="translate(150 0)">${A('om-from-left-near 1.4s cubic-bezier(.2,.8,.3,1) both', `<g transform="translate(0 46) scale(.68)"><g transform="translate(-60 20)">${truckWithBoxy(1.3)}</g></g>`)}</g>
    ${at(62, 146, boxy({ mood: 'happy', arms: 'waveL', wave: 1.5, blinkAt: 2.6 }), 0.62)}
    ${at(92, 108, A('om-sway 1.6s .9s ease-in-out both', `<path d="M0 0 V36" stroke="#8d9391" stroke-width="1.8"/><path d="M0 0 h28 l-6 7 l6 7 h-28z" fill="${G}"/><text x="11" y="10" text-anchor="middle" ${BODY} font-weight="700" font-size="7.5" fill="#5a3400">Next</text>`, 'transform-origin:left bottom;'))}`,

  late: ({ lateDay }) => `<rect width="320" height="180" fill="#fbf4ea"/><circle cx="160" cy="96" r="78" fill="#fdebd2"/>${grass(150)}
    ${at(58, 58, `<circle r="20" fill="#fff" stroke="${INK}" stroke-width="2.2"/><path d="M0 -12 V0" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>${A('om-spin 1.6s .2s cubic-bezier(.4,0,.2,1) both', `<path d="M0 0 L9 6" stroke="${G}" stroke-width="2.4" stroke-linecap="round"/>`, 'transform-origin:0 0;')}`)}
    ${at(146, 150, A('om-bow 1.4s .5s ease-in-out both', boxy({
      mood: 'sorry', arms: 'hold', blinkAt: 2.2,
      prop: `<g transform="translate(0 -4) scale(.85)"><rect x="-19" y="-9" width="38" height="17" rx="3" fill="#fff" stroke="${G}" stroke-width="1.6"/><text y="3.4" text-anchor="middle" ${DISPLAY} font-size="8.5" fill="#8a5200">Sorry!</text></g>`,
    }), 'transform-origin:center bottom;'))}
    ${heart(176, 92, 1.6)}${heart(124, 96, 2.0, '#f6a3ae', 0.8)}
    ${calendar(212, 52, G, `${lateDay ? `<text x="40" y="40" text-anchor="middle" ${BODY} font-weight="600" font-size="11" fill="#5b6563" opacity=".45">${esc(lateDay)}</text>
      <path d="M20 36 H60" stroke="#d9822b" stroke-width="2" stroke-linecap="round" pathLength="1" stroke-dasharray="1" class="om-a" style="animation:om-draw .35s 1.3s ease-out both"/>` : ''}
      ${A('om-rise-in .45s 1.7s ease-out both', `<rect x="14" y="${lateDay ? 50 : 36}" width="52" height="18" rx="9" fill="${B}"/><text x="40" y="${lateDay ? 62.5 : 48.5}" text-anchor="middle" ${DISPLAY} font-size="10" fill="#fff">On it</text>`)}`)}`,

  on_hold: () => `<rect width="320" height="180" fill="#f1f6f9"/>${grass(150)}
    <g transform="translate(24 46)"><rect width="74" height="70" rx="4" fill="#fff" stroke="${GR}" stroke-width="2"/><path d="M0 35 H74" stroke="${GR}" stroke-width="2"/>
      <rect x="6" y="14" width="18" height="21" fill="${K}" opacity=".7"/><rect x="50" y="18" width="18" height="17" fill="${K}" opacity=".7"/>
      <rect x="27" y="11" width="20" height="24" rx="2" fill="none" stroke="${G}" stroke-width="1.6" stroke-dasharray="3 2"/>
      ${A(POP(0.5), `<text x="37" y="28.5" text-anchor="middle" ${DISPLAY} font-size="14" fill="${G}">?</text>`)}
      <rect x="6" y="46" width="62" height="19" fill="${K}" opacity=".45"/></g>
    ${at(148, 150, boxy({ mood: 'happy', arms: 'phone', blinkAt: 1.8 }))}
    ${bubble(214, 46, 0.9, `<path d="M0 8 a8 8 0 0 1 8 -8 h66 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 h-56 l-12 10 v-10 h-6 a8 8 0 0 1 -8 -8z" fill="#fff" stroke="${G}" stroke-width="1.8"/><text x="41" y="20" text-anchor="middle" ${BODY} font-weight="600" font-size="9" fill="${INK}">Wait or refund?</text>`)}
    ${bubble(222, 98, 1.6, `<path d="M0 8 a8 8 0 0 1 8 -8 h50 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 v9 l-11 -9 h-39 a8 8 0 0 1 -8 -8z" fill="${B}"/>${[0, 1, 2].map((i) => `<circle cx="${21 + i * 12}" cy="15" r="3.4" fill="#fff" class="om-a" style="animation:om-typing .9s ${(1.9 + i * 0.18).toFixed(2)}s ease-in-out 3 both"/>`).join('')}`, 'right bottom')}`,

  payment_failed: () => `<rect width="320" height="180" fill="#eef2f6"/>${grass(150)}
    ${at(140, 150, boxy({
      mood: 'calm', blinkAt: 1.5,
      prop: A('om-rise-in .5s .2s ease-out both', `<g transform="translate(52 -16) rotate(-10) scale(.8)"><rect x="-22" y="-13" width="44" height="28" rx="4" fill="${BD}"/><rect x="-22" y="-7" width="44" height="5" fill="#0f4f86"/><rect x="-17" y="3" width="8" height="6" rx="1.5" fill="${G}"/></g>`),
    }))}
    ${at(232, 90, A('om-spin-back 1.2s .6s cubic-bezier(.3,.6,.3,1) both', `<circle r="22" fill="#fff" stroke="${GR}" stroke-width="2"/><path d="M9 -7 A11 11 0 1 0 11 4" fill="none" stroke="${B}" stroke-width="2.8" stroke-linecap="round"/><path d="M4 -11 L10 -7 L5 -2" fill="none" stroke="${B}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`))}
    ${at(232, 128, A('om-rise-in .4s 1.4s ease-out both', `<text text-anchor="middle" ${BODY} font-weight="600" font-size="9.5" fill="#5b6563">Try again</text>`))}`,

  cancelled: () => `<rect width="320" height="180" fill="#f2f4f3"/>${grass(150)}
    ${at(150, 150, A('om-gray 1.4s .9s ease-out both', boxy({ mood: 'calm', arms: 'waveL', wave: 0.2, blinkAt: 2 }), 'filter:grayscale(.85) opacity(.75);'))}
    ${at(196, 96, A('om-pop .4s 1.5s ease-out both', '<circle r="12" fill="#fff" stroke="#9aa5a2" stroke-width="2"/><path d="M-5 0 H5" stroke="#6f7b78" stroke-width="2.6" stroke-linecap="round"/>'))}`,

  refunded: () => `<rect width="320" height="180" fill="#eef6f0"/>${grass(150)}
    ${at(86, 150, A('om-hop .4s .2s ease-out both', boxy({ mood: 'grin', arms: 'up', blinkAt: 2 }), 'transform-origin:center bottom;'))}
    ${[0, 1, 2, 3].map((i) => at(106, 104, A(`om-coin 1.1s ${(0.35 + i * 0.28).toFixed(2)}s cubic-bezier(.4,.1,.5,1) both`, `<circle r="9" fill="${G}" stroke="#d1861a" stroke-width="1.5"/><text y="3.6" text-anchor="middle" ${BODY} font-weight="700" font-size="9.5" fill="#7a4a00">₹</text>`, 'opacity:0;'))).join('')}
    ${at(250, 150, A('om-thump .35s 1.7s ease-in-out 2 both', `<rect x="-36" y="-56" width="72" height="56" rx="10" fill="${BD}"/><path d="M-36 -40 H36" stroke="#0f4f86" stroke-width="2"/><rect x="8" y="-34" width="28" height="18" rx="6" fill="${B}"/><circle cx="20" cy="-25" r="3.5" fill="${G}"/><circle cx="-18" cy="-26" r="2.6" fill="#fff"/><circle cx="-4" cy="-26" r="2.6" fill="#fff"/><path d="M-17 -16 q6 5 12 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`, 'transform-origin:center bottom;'))}
    ${tick(286, 70, 2.2)}`,

  returning: () => `${sky()}${sun(40, 30)}${cloud(120, 22, 0.8, 0)}${HILLS}${road()}
    <g transform="translate(238 74)"><path d="M0 26 L36 4 L72 26 V72 H0z" fill="#fff" stroke="${GR}" stroke-width="2"/><rect x="24" y="44" width="24" height="28" fill="#d7dddb"/><rect x="8" y="26" width="56" height="10" rx="2" fill="${INK}"/><text x="36" y="33.5" text-anchor="middle" ${DISPLAY} font-size="6.5" letter-spacing=".5" fill="#fff">AUTOBACS</text></g>
    ${smallTruck(38, 40, A('om-from-left-far 1.4s cubic-bezier(.2,.8,.3,1) both', `<g transform="translate(-60 20)">${truckWithBoxy(1.3)}</g>`))}
    ${at(274, 60, A('om-pop .4s 1.5s ease-out both', `<circle r="12" fill="#fff" stroke="${B}" stroke-width="2"/><path d="M5 -3 H-4 M-1 -7 L-5 -3 L-1 1 M-4 -3 A6 6 0 1 0 6 3" fill="none" stroke="${B}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`))}`,
};

/** The SVG inner markup for a moment (viewBox 0 0 320 180). */
export function sceneMarkup(key: MomentKey, opts: SceneOpts = {}): string {
  return (SCENES[key] || SCENES.placed)(opts);
}
