#!/usr/bin/env node
/**
 * Renders the Autobacs Team logo ("logo A", owner-approved 2026-11-22: dark
 * rounded square, white "AB", green check badge, three slanted green stripes)
 * into every PNG the app needs, from ONE SVG, so icon, splash and in-app badge
 * never drift apart. Artwork matches hr-mockups.html / hr-system-plan.html.
 *
 *   npm run brand      (needs Google Chrome on the Mac and `npm install` done)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
const fontFile = join(root, 'node_modules/@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const INK = '#0f1111';
const GREEN = '#0a5c33';

/** Logo A on a 96 grid. rounded=false → full-bleed square (iOS masks the corners). */
export function logoSvg({ rounded = true, scale = 1, bg = true, embedFont = true } = {}) {
  const t = (1 - scale) * 48;
  const plate = bg ? `<rect width="96" height="96" rx="${rounded ? 22 : 0}" fill="${INK}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="1024" height="1024">
  ${embedFont ? `<defs><style>@font-face{font-family:MontserratXB;src:url('${pathToFileURL(fontFile)}');}</style></defs>` : ''}
  ${plate}
  <g transform="translate(${t} ${t}) scale(${scale})">
    <text x="15" y="60" font-family="MontserratXB, Montserrat, 'Arial Black', Arial, sans-serif" font-weight="800" font-size="34" fill="#ffffff">AB</text>
    <g transform="skewX(-20)"><rect x="40" y="70" width="10" height="6" fill="${GREEN}"/><rect x="53" y="70" width="10" height="6" fill="${GREEN}"/><rect x="66" y="70" width="10" height="6" fill="${GREEN}"/></g>
    <circle cx="74" cy="24" r="12" fill="${GREEN}"/>
    <path d="M68 24l4 4 8-8" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

function render(name, svg, size) {
  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  const html = join(dir, 'a.html');
  writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</div></body></html>`);
  const out = join(assets, name);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`, '--virtual-time-budget=1500', pathToFileURL(html).href], { stdio: 'ignore' });
  if (!existsSync(out)) throw new Error(`render failed: ${name}`);
  console.log('wrote', name, `${size}px`);
}

if (!existsSync(chrome)) throw new Error('Google Chrome not found at ' + chrome);
if (!existsSync(fontFile)) throw new Error('Run npm install first (Montserrat font missing)');

writeFileSync(join(assets, 'brand/logo-a.svg'), logoSvg({ embedFont: false }));
render('icon.png', logoSvg({ rounded: false, scale: 0.9 }), 1024);
render('adaptive-icon.png', logoSvg({ bg: false, scale: 0.62 }), 1024);
render('splash-icon.png', logoSvg(), 1024);
render('badge.png', logoSvg(), 192);
render('favicon.png', logoSvg(), 48);
