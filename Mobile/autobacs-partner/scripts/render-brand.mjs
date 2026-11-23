#!/usr/bin/env node
/**
 * Renders the Autobacs Partner logo ("A — AB badge", owner-approved 2026-11-22)
 * into every PNG the app needs, from ONE SVG definition, so the icon, splash,
 * favicon and in-app badge can never drift apart.
 *
 *   node scripts/render-brand.mjs
 *
 * Uses the Google Chrome already on the Mac (headless screenshot) and the
 * Montserrat ExtraBold that ships in node_modules — no extra tooling.
 * Re-run after any change to the badge below; commit the PNGs it writes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
const fontFile = join(root, 'node_modules/@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Brand tokens (same as src/theme.ts).
const INK = '#0f1111';
const GREEN_ON_DARK = '#228a57'; // brand green lifted so it reads on the black badge
const STEEL = '#9a9f9e';

/**
 * The badge artwork on a 1024 canvas.
 * @param {{ rounded: boolean, scale: number, bg: boolean }} o
 *   rounded — draw the rounded black square (false = full-bleed, for the iOS icon which the OS masks)
 *   scale   — shrink the artwork toward the centre (adaptive-icon safe zone)
 *   bg      — draw the black background at all (false = artwork only, transparent)
 */
export function badgeSvg({ rounded = true, scale = 1, bg = true, embedFont = true } = {}) {
  const t = (1 - scale) * 512;
  const stripe = (x, fill) =>
    `<polygon points="${x},150 ${x + 54},150 ${x - 14},330 ${x - 68},330" fill="${fill}"/>`;
  const plate = bg
    ? rounded
      ? `<rect x="0" y="0" width="1024" height="1024" rx="230" fill="${INK}"/>`
      : `<rect x="0" y="0" width="1024" height="1024" fill="${INK}"/>`
    : '';
  // When the plate is drawn full-bleed it stays full size; only the artwork scales.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${embedFont ? `<defs><style>@font-face{font-family:MontserratXB;src:url('${pathToFileURL(fontFile)}');}</style></defs>` : ''}
  ${plate}
  <g transform="translate(${t} ${t + 36 * scale}) scale(${scale})">
    ${stripe(744, GREEN_ON_DARK)}${stripe(816, '#ffffff')}${stripe(888, STEEL)}
    <text x="492" y="690" text-anchor="middle" font-family="MontserratXB, Montserrat, 'Arial Black', sans-serif" font-weight="800" font-size="430" letter-spacing="-14" fill="#ffffff">AB</text>
    <rect x="232" y="752" width="520" height="44" rx="22" fill="${GREEN_ON_DARK}"/>
  </g>
</svg>`;
}

function render(name, svg, size, background = 'transparent') {
  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  const html = join(dir, 'a.html');
  writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:${background}">
     <div style="width:${size}px;height:${size}px">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</div>
     </body></html>`,
  );
  const out = join(assets, name);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`,
    '--virtual-time-budget=1500', pathToFileURL(html).href,
  ], { stdio: 'ignore' });
  if (!existsSync(out)) throw new Error(`render failed: ${name}`);
  console.log('wrote', name, `${size}px`);
}

if (!existsSync(chrome)) throw new Error('Google Chrome not found at ' + chrome);
if (!existsSync(fontFile)) throw new Error('Run npm install first (Montserrat font missing)');

// Committed vector source (names Montserrat ExtraBold; no local paths). The PNGs are the shipped form.
writeFileSync(join(assets, 'brand/ab-badge.svg'), badgeSvg({ rounded: true, embedFont: false }));

render('icon.png', badgeSvg({ rounded: false, scale: 0.86 }), 1024);          // iOS/Expo icon (OS masks corners)
render('adaptive-icon.png', badgeSvg({ bg: false, scale: 0.62 }), 1024);      // Android foreground, bg = ink
render('splash-icon.png', badgeSvg({ rounded: true }), 1024);                  // splash on light page
render('badge.png', badgeSvg({ rounded: true }), 512);                         // in-app header/avatar
render('favicon.png', badgeSvg({ rounded: true }), 48);                        // Expo web tab
