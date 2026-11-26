/**
 * The order-moment drawings: hand-built SVG (viewBox 320×180) animated by the
 * `om-*` keyframes in app/globals.css. No animation library — each scene is a few KB.
 *
 * ONE RULE makes reduced motion and play-once free: an element's normal style IS its
 * final frame; keyframes only describe where it starts (`both` fill). Switching
 * animation off (`.om-scene.om-still`, or prefers-reduced-motion) leaves the finished
 * picture. Elements that only exist mid-animation (sparkles, confetti, coins) rest at
 * opacity 0.
 *
 * Markup is built as strings from constants only. The one dynamic value (the late
 * scene's date) goes through `esc()`, and the caller passes an already-validated
 * "Mon 30" string. Nothing user- or server-authored is interpolated raw.
 */
import type { MomentKey } from './orderMomentCopy';

const K = '#E3B776', K2 = '#C08A44', KD = '#8a5a1c', G = '#EF9F27', B = '#3B9EE8', BD = '#1A6FB5',
  INK = '#0f1111', GR = '#c9d1ce', LT = '#dff0fc';
const DISPLAY = 'font-family="inherit" font-weight="800"';
const BODY = 'font-family="inherit"';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const ground = (y = 150, w = 110) => `<ellipse cx="160" cy="${y}" rx="${w}" ry="7" fill="#e1e7e5"/>`;
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

const tick = (cx: number, cy: number, delay: number) =>
  `<g transform="translate(${cx} ${cy})"><g class="om-a" style="animation:om-pop .45s ${delay}s cubic-bezier(.34,1.56,.64,1) both"><circle r="14" fill="${B}"/><path d="M-6 0.5 L-1.5 5 L6.5 -4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;

const closedBox = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${K}" stroke="${K2}" stroke-width="2"/><rect x="${x}" y="${y}" width="${w}" height="9" fill="${K2}" opacity=".35"/>`;

function truck() {
  const wheel = (cx: number) => `<g class="om-a" style="animation:om-spin .45s linear 0s 6"><circle cx="${cx}" cy="136" r="11" fill="#1d2224"/><circle cx="${cx}" cy="136" r="4.5" fill="#c4c4c4"/><rect x="${cx - 1}" y="126" width="2" height="6" fill="#c4c4c4"/></g>`;
  return `<rect x="90" y="76" width="100" height="58" rx="5" fill="#fff" stroke="${GR}" stroke-width="2"/>
    <rect x="91" y="118" width="98" height="6" fill="${G}"/>
    <text x="140" y="102" text-anchor="middle" ${DISPLAY} font-size="14" fill="${INK}">AUTOBACS</text>
    <text x="140" y="112" text-anchor="middle" ${DISPLAY} font-size="6.5" letter-spacing="2" fill="${BD}">INDIA</text>
    <path d="M192 92 h22 a8 8 0 0 1 7 4 l9 14 v24 h-38z" fill="${B}"/>
    <path d="M198 97 h14 a4 4 0 0 1 3.5 2 l6 10 h-23.5z" fill="${LT}"/>
    <rect x="225" y="121" width="6" height="4" rx="1" fill="${G}"/>${wheel(115)}${wheel(210)}`;
}

const road = (y = 146) => `<rect x="0" y="${y}" width="320" height="22" fill="#d7dddb"/>
  <g class="om-a" style="animation:om-slide-left .4s linear 0s 7">${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 40}" y="${y + 10}" width="18" height="3" rx="1.5" fill="#fff"/>`).join('')}</g>`;
const HILLS = '<path d="M0 146 C40 120 70 118 110 132 S180 112 230 126 S290 118 320 128 V146 H0z" fill="#e3ebe8"/>';
const drop = (x: number, y: number, d: number, inner: string) =>
  `<g transform="translate(${x} ${y})"><g class="om-a" style="animation:om-drop .7s ${d}s cubic-bezier(.3,.7,.3,1) both">${inner}</g></g>`;

const SCENES: Record<MomentKey, (o: { lateDay?: string | null }) => string> = {
  payment_failed: () => `${ground(150, 90)}
    <g transform="translate(96 64)"><g class="om-a" style="animation:om-rise-in .5s .1s ease-out both">
      <rect width="112" height="72" rx="9" fill="${BD}"/><rect y="16" width="112" height="12" fill="#0f4f86"/>
      <rect x="12" y="38" width="18" height="13" rx="3" fill="${G}"/><rect x="12" y="56" width="52" height="5" rx="2.5" fill="#8cc2ee"/></g></g>
    <g transform="translate(232 96)"><g class="om-a" style="animation:om-spin-back 1.2s .5s cubic-bezier(.3,.6,.3,1) both">
      <circle r="20" fill="#fff" stroke="${GR}" stroke-width="2"/>
      <path d="M8 -6 A10 10 0 1 0 10 4" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M4 -10 L9 -6 L4 -1.5" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g></g>`,

  placed: () => `${ground()}${closedBox(110, 80, 100, 66)}
    <g class="om-a" style="transform-origin:left bottom;animation:om-flap-l .6s .2s cubic-bezier(.3,.7,.3,1) both"><rect x="110" y="74" width="50" height="7" rx="2" fill="${K}" stroke="${K2}" stroke-width="2"/></g>
    <g class="om-a" style="transform-origin:right bottom;animation:om-flap-r .6s .45s cubic-bezier(.3,.7,.3,1) both"><rect x="160" y="74" width="50" height="7" rx="2" fill="${K}" stroke="${K2}" stroke-width="2"/></g>
    <g class="om-a" style="transform-origin:top;animation:om-scale-y .35s .95s ease-out both"><rect x="151" y="73" width="18" height="34" fill="${G}"/></g>
    <text x="160" y="132" text-anchor="middle" ${DISPLAY} font-size="9" letter-spacing="1" fill="${KD}">AUTOBACS</text>
    ${bursts(160, 84, 12, 1.15, [G, B, BD, '#f6c56c'], 70, 'star')}${tick(212, 76, 1.3)}`,

  preparing: () => `${ground(150, 120)}
    <path d="M58 92 L40 74 L92 74 L110 92z" fill="${K}" stroke="${K2}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M182 92 L200 74 L148 74 L130 92z" fill="${K}" stroke="${K2}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="58" y="80" width="124" height="14" fill="#b07c3b" opacity=".35"/>
    ${drop(92, 84, 0.2, `<circle r="17" fill="#cfd3d2" stroke="#8d9391" stroke-width="2"/><circle r="6" fill="#8d9391"/>${[0, 72, 144, 216, 288].map((a) => `<circle cx="${Math.round(Math.cos((a * Math.PI) / 180) * 11)}" cy="${Math.round(Math.sin((a * Math.PI) / 180) * 11)}" r="1.8" fill="#8d9391"/>`).join('')}`)}
    ${drop(128, 82, 0.6, '<rect x="-6" y="-16" width="12" height="9" rx="2" fill="#fff" stroke="#8d9391" stroke-width="1.6"/><rect x="-4.5" y="-7" width="9" height="12" fill="#c4c4c4"/><rect x="-1.5" y="5" width="3" height="8" fill="#8d9391"/>')}
    ${drop(156, 84, 1.0, `<rect x="-12" y="-14" width="24" height="26" rx="5" fill="${B}"/><rect x="-12" y="-6" width="24" height="5" fill="${BD}"/>`)}
    <rect x="58" y="92" width="124" height="54" rx="4" fill="${K}" stroke="${K2}" stroke-width="2"/>
    <g transform="translate(206 38)"><rect width="80" height="100" rx="6" fill="#fff" stroke="${GR}" stroke-width="2"/>
      <rect x="26" y="-5" width="28" height="10" rx="3" fill="${G}"/>
      ${['Part checked', 'Quality check', 'Packed safely'].map((t, i) => `
        <rect x="10" y="${20 + i * 26}" width="12" height="12" rx="3" fill="none" stroke="${GR}" stroke-width="1.6"/>
        <path d="M12.5 ${26 + i * 26} l3 3 l6 -7" fill="none" stroke="${B}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" class="om-a" style="animation:om-draw .35s ${(0.9 + i * 0.55).toFixed(2)}s ease-out both"/>
        <text x="27" y="${30 + i * 26}" ${BODY} font-size="8.5" fill="#5b6563">${t}</text>`).join('')}</g>`,

  packed: () => `${ground()}${closedBox(105, 72, 110, 74)}<rect x="151" y="72" width="18" height="30" fill="${G}"/>
    <g class="om-a" style="animation:om-from-right .5s .25s cubic-bezier(.3,.7,.3,1) both">
      <rect x="120" y="104" width="56" height="34" rx="3" fill="#fff" stroke="#dfe4e2"/>
      ${[0, 3, 5, 9, 11, 14, 17, 19, 23, 26, 28, 31, 35, 38].map((x, i) => `<rect x="${125 + x}" y="109" width="${i % 3 ? 1.4 : 2.4}" height="14" fill="${INK}"/>`).join('')}
      <rect x="125" y="127" width="34" height="3" rx="1.5" fill="#c4cbc9"/><rect x="125" y="132" width="22" height="3" rx="1.5" fill="#c4cbc9"/></g>
    <g transform="translate(222 70)"><g class="om-a" style="transform:rotate(-12deg);animation:om-stamp .5s .95s cubic-bezier(.3,.7,.3,1) both">
      <circle r="24" fill="none" stroke="${B}" stroke-width="2.5"/><circle r="19" fill="none" stroke="${B}" stroke-width="1"/>
      <text y="3.5" text-anchor="middle" ${DISPLAY} font-size="10" letter-spacing="1" fill="${B}">PACKED</text></g></g>`,

  shipped: () => `${HILLS}
    <g class="om-a" style="animation:om-slide-left-long 3s linear both">${[30, 120, 210, 300, 390].map((x) => `<g transform="translate(${x} 120)"><rect x="-1.5" y="0" width="3" height="26" fill="#c5cfcc"/><circle cy="-4" r="9" fill="#d3ddda"/></g>`).join('')}</g>
    ${road()}
    <g class="om-a" style="animation:om-from-left-far 1.3s cubic-bezier(.2,.8,.3,1) both"><g class="om-a" style="animation:om-bob .3s ease-in-out 0s 9">
      <g class="om-a" style="animation:om-fade-out .8s 1.4s both">${[86, 92, 98].map((y, i) => `<rect x="${52 + i * 8}" y="${y + i * 8}" width="${28 - i * 6}" height="2.5" rx="1.2" fill="#b8c3c0"/>`).join('')}</g>
      ${truck()}</g></g>`,

  delivered: () => `<rect x="0" y="146" width="320" height="34" fill="#e1e7e5"/>
    <rect x="96" y="22" width="128" height="126" fill="#f4f1ec" stroke="#e1dcd3" stroke-width="2"/>
    <rect x="132" y="48" width="56" height="98" rx="3" fill="${BD}"/>
    <rect x="138" y="56" width="44" height="34" rx="2" fill="#2a7cc0"/><rect x="138" y="96" width="44" height="42" rx="2" fill="#2a7cc0"/>
    <circle cx="176" cy="100" r="2.6" fill="${G}"/><rect x="120" y="146" width="80" height="6" rx="2" fill="#d2cbbf"/>
    <rect x="200" y="44" width="10" height="10" rx="2" fill="${G}"/>
    <g class="om-a" style="animation:om-drop .8s .2s cubic-bezier(.3,.7,.3,1) both">${closedBox(196, 112, 46, 34)}<rect x="214" y="112" width="10" height="14" fill="${G}"/></g>
    ${bursts(219, 108, 16, 1.0, [G, B, BD, INK, '#f6c56c'], 86, 'conf')}${tick(252, 98, 1.05)}`,

  partly: () => `${HILLS}${road()}
    <g transform="translate(150 0)"><g class="om-a" style="animation:om-from-left-near 1.4s cubic-bezier(.2,.8,.3,1) both">
      <g transform="translate(0 46) scale(.68)"><g transform="translate(-60 20)">${truck()}</g></g></g></g>
    <g transform="translate(34 104)">${closedBox(0, 0, 46, 42)}<rect x="18" y="0" width="10" height="14" fill="${G}"/></g>
    <g transform="translate(80 98)"><g class="om-a" style="transform-origin:top left;animation:om-sway 1.6s .8s ease-in-out both">
      <path d="M0 0 L8 14" stroke="#9aa5a2" stroke-width="1.4"/>
      <rect x="2" y="14" width="40" height="18" rx="4" fill="#fff" stroke="${G}" stroke-width="1.6"/>
      <text x="22" y="26.5" text-anchor="middle" ${BODY} font-weight="600" font-size="8.5" fill="#8a5200">Next</text></g></g>`,

  on_hold: () => `${ground(152, 100)}
    <g transform="translate(70 40)"><g class="om-a" style="transform-origin:left bottom;animation:om-pop .45s .15s cubic-bezier(.34,1.56,.64,1) both">
      <path d="M0 10 a10 10 0 0 1 10 -10 h100 a10 10 0 0 1 10 10 v34 a10 10 0 0 1 -10 10 h-86 l-14 12 v-12 a10 10 0 0 1 -10 -10z" fill="#fff" stroke="${G}" stroke-width="2"/>
      <rect x="14" y="14" width="26" height="22" rx="3" fill="${K}" stroke="${K2}" stroke-width="1.5"/>
      <rect x="48" y="16" width="56" height="5" rx="2.5" fill="#d9dfdd"/><rect x="48" y="27" width="40" height="5" rx="2.5" fill="#d9dfdd"/></g></g>
    <g transform="translate(140 98)"><g class="om-a" style="transform-origin:right bottom;animation:om-pop .45s .9s cubic-bezier(.34,1.56,.64,1) both">
      <path d="M0 10 a10 10 0 0 1 10 -10 h90 a10 10 0 0 1 10 10 v22 a10 10 0 0 1 -10 10 v12 l-14 -12 h-76 a10 10 0 0 1 -10 -10z" fill="${B}"/>
      ${[0, 1, 2].map((i) => `<circle cx="${40 + i * 14}" cy="21" r="4" fill="#fff" class="om-a" style="animation:om-typing .9s ${(1.2 + i * 0.18).toFixed(2)}s ease-in-out 3 both"/>`).join('')}</g></g>`,

  late: ({ lateDay }) => `${ground(152, 110)}
    <g transform="translate(70 34)"><circle r="17" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
      <path d="M0 -10 V0" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      <g class="om-a" style="transform-origin:0 0;animation:om-spin 1.6s .2s cubic-bezier(.4,0,.2,1) both"><path d="M0 0 L8 5" stroke="${G}" stroke-width="2.4" stroke-linecap="round"/></g></g>
    <g class="om-a" style="transform-origin:center bottom;animation:om-bow 1.4s .6s ease-in-out both">
      <rect x="96" y="72" width="84" height="74" rx="6" fill="${K}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M96 84 H180" stroke="${INK}" stroke-width="1.6" opacity=".35"/>
      <path d="M114 96 l9 -3 M162 96 l-9 -3" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      <g class="om-a" style="animation:om-blink 3s .3s both"><circle cx="120" cy="104" r="3" fill="${INK}"/><circle cx="156" cy="104" r="3" fill="${INK}"/></g>
      <path d="M130 120 q8 5 16 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="112" cy="116" r="4.5" fill="#f2a490" opacity=".55"/><circle cx="164" cy="116" r="4.5" fill="#f2a490" opacity=".55"/>
      <path d="M180 112 q16 -2 26 -14" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/></g>
    <g transform="translate(196 56)"><rect width="78" height="72" rx="7" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
      <path d="M0 7 a7 7 0 0 1 7 -7 h64 a7 7 0 0 1 7 7 v11 h-78z" fill="${G}"/>
      <path d="M20 -5 v10 M58 -5 v10" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      ${lateDay ? `<g class="om-a" style="opacity:.4;animation:om-dim-old .4s 1.4s both"><text x="39" y="38" text-anchor="middle" ${BODY} font-weight="600" font-size="11" fill="#5b6563">${esc(lateDay)}</text></g>
      <path d="M20 34 H58" stroke="#d9822b" stroke-width="2" stroke-linecap="round" pathLength="1" stroke-dasharray="1" class="om-a" style="animation:om-draw .35s 1.45s ease-out both"/>` : ''}
      <g class="om-a" style="animation:om-rise-in .45s 1.9s ease-out both"><text x="39" y="${lateDay ? 60 : 50}" text-anchor="middle" ${DISPLAY} font-size="13" fill="${INK}">On it</text></g></g>`,

  cancelled: () => `${ground()}${closedBox(112, 78, 96, 68)}
    <g class="om-a" style="animation:om-fade-in .8s .4s ease-out both"><rect x="112" y="78" width="96" height="68" rx="4" fill="#e4e8e7" stroke="#b9c2bf" stroke-width="2"/><rect x="112" y="78" width="96" height="9" fill="#cfd6d4"/></g>
    <g transform="translate(160 112)"><g class="om-a" style="animation:om-pop .4s 1s ease-out both"><circle r="15" fill="#fff" stroke="#9aa5a2" stroke-width="2"/><path d="M-6 0 H6" stroke="#6f7b78" stroke-width="2.6" stroke-linecap="round"/></g></g>`,

  refunded: () => `${ground(152, 120)}
    <g transform="translate(46 80)"><rect width="56" height="62" rx="6" fill="#fff" stroke="${GR}" stroke-width="2"/><rect width="56" height="16" rx="6" fill="${INK}"/><rect x="0" y="10" width="56" height="6" fill="${INK}"/><rect x="18" y="5" width="20" height="5" rx="2.5" fill="${G}"/><rect x="10" y="28" width="36" height="4" rx="2" fill="#d9dfdd"/><rect x="10" y="38" width="24" height="4" rx="2" fill="#d9dfdd"/></g>
    ${[0, 1, 2, 3].map((i) => `<g transform="translate(96 84)"><g class="om-a" style="opacity:0;animation:om-coin 1.1s ${(0.25 + i * 0.28).toFixed(2)}s cubic-bezier(.4,.1,.5,1) both"><circle r="10" fill="${G}" stroke="#d1861a" stroke-width="1.5"/><text y="4" text-anchor="middle" ${BODY} font-weight="700" font-size="10.5" fill="#7a4a00">₹</text></g></g>`).join('')}
    <g transform="translate(212 78)"><g class="om-a" style="animation:om-thump .35s 1.55s ease-in-out 2 both">
      <rect width="72" height="58" rx="10" fill="${BD}"/><path d="M0 18 H72" stroke="#0f4f86" stroke-width="2"/>
      <rect x="44" y="24" width="28" height="18" rx="6" fill="${B}"/><circle cx="56" cy="33" r="3.5" fill="${G}"/></g></g>${tick(282, 74, 2.1)}`,

  returning: () => `${HILLS}${road()}
    <g transform="translate(238 74)"><path d="M0 26 L36 4 L72 26 V72 H0z" fill="#fff" stroke="${GR}" stroke-width="2"/><rect x="24" y="44" width="24" height="28" fill="#d7dddb"/><rect x="8" y="26" width="56" height="10" rx="2" fill="${INK}"/><text x="36" y="33.5" text-anchor="middle" ${DISPLAY} font-size="6.5" letter-spacing=".5" fill="#fff">AUTOBACS</text></g>
    <g transform="translate(38 40) scale(.66)"><g class="om-a" style="animation:om-from-left-far 1.4s cubic-bezier(.2,.8,.3,1) both"><g transform="translate(-60 20)">${truck()}</g></g></g>
    <g transform="translate(58 30)"><g class="om-a" style="animation:om-pop .4s 1.4s ease-out both"><circle r="13" fill="#fff" stroke="${B}" stroke-width="2"/><path d="M5 -3 H-4 M-1 -7 L-5 -3 L-1 1 M-4 -3 A6 6 0 1 0 6 3" fill="none" stroke="${B}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></g>`,
};

/** The SVG inner markup for a moment (viewBox 0 0 320 180). */
export function sceneMarkup(key: MomentKey, opts: { lateDay?: string | null } = {}): string {
  return (SCENES[key] || SCENES.placed)(opts);
}
