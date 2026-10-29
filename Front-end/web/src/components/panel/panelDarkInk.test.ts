/**
 * Dark theme in the staff panels: text must flip with the surface it sits on.
 *
 * panel.css re-themes the colour ramps under [data-theme='dark']: status tints
 * (`bg-amber-100`) turn dark and their inks (`text-amber-900`) turn light. Only
 * the steps it redefines flip. Three ways a screen went unreadable anyway:
 *
 *   • an ink step panel.css does not redefine on a tint it does — `bg-amber-100
 *     text-amber-950` became dark brown on near-black ("Request supplier
 *     payment"), `bg-emerald-100 text-emerald-950` dark green on dark (the
 *     selected chat row). Use the 700–900 inks.
 *   • a tint from a family panel.css does not re-theme at all — `bg-violet-100`
 *     stayed a pale bubble on the dark chat list. Add the family to panel.css.
 *   • a literal near-white surface — `bg-[#f2f6fc]` stayed light behind the chat
 *     list while its grey text turned light. Use a token (`--pn-*`).
 *   • `text-white` on an inline literal colour (`style={{ background: GREEN }}`):
 *     `text-white` turns dark in the dark theme, the inline colour does not. Use
 *     `text-[#fff]`.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const PANEL_DIRS = [
  'app/admin', 'app/team', 'components/admin', 'components/staff', 'components/panel',
  'components/chat', 'components/payments', 'components/tasks', 'components/notifications',
].map((d) => path.join(SRC, d));

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** `--color-<family>-<step>` names the dark panel theme redefines. */
function darkRedefined(): Set<string> {
  const css = fs.readFileSync(path.join(SRC, 'components/panel/panel.css'), 'utf8');
  const start = css.indexOf("[data-theme='dark'] .panel-theme {");
  const block = css.slice(start, css.indexOf('\n}', start));
  return new Set([...block.matchAll(/--color-([a-z]+-\d+):/g)].map((m) => m[1]));
}

const STATUS = 'green|emerald|red|rose|amber|yellow|orange|sky|purple|indigo|teal|blue|pink|lime|cyan|violet|fuchsia';
const TINT = new RegExp(`(?:^|\\s)bg-(${STATUS})-(50|100|200)(?=[\\s/]|$)`, 'g');
const INK = new RegExp(`(?:^|\\s)text-(${STATUS})-(\\d+)(?=[\\s/]|$)`, 'g');
const LITERAL_BG = /(?:^|\s)bg-\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\](?!\/)/g;
const STRINGS = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;

function luminance(hex: string): number {
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function offences(source: string, redefined: Set<string>): string[] {
  const out: string[] = [];
  for (const literal of source.match(STRINGS) ?? []) {
    const s = ` ${literal.slice(1, -1)} `;
    const tints = [...s.matchAll(TINT)];
    const unthemed = tints.find((m) => !redefined.has(`${m[1]}-${m[2]}`));
    if (unthemed) out.push(`${unthemed[0].trim()} has no dark-theme value in panel.css: ${literal}`);
    const tinted = tints.some((m) => redefined.has(`${m[1]}-${m[2]}`));
    const stuckInk = [...s.matchAll(INK)].find((m) => !redefined.has(`${m[1]}-${m[2]}`));
    if (tinted && stuckInk) out.push(`${stuckInk[0].trim()} on a dark-theme tint: ${literal}`);
    const light = [...s.matchAll(LITERAL_BG)].find((m) => luminance(m[1]) > 0.7);
    if (light) out.push(`literal light surface ${light[0].trim()}: ${literal}`);
  }
  // className="… text-white …" followed by style={{ background: … }} on the same element.
  for (const m of source.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})[^<>]{0,120}?style=\{\{\s*background:/g)) {
    if (/(?:^|[\s"`])text-white(?=[\s"`/])/.test(m[0])) out.push(`text-white on an inline colour: ${m[0]}`);
  }
  for (const m of source.matchAll(/style=\{\{\s*background:[^}]*\}\}[^<>]{0,120}?className=(?:"[^"]*"|\{`[^`]*`\})/g)) {
    if (/(?:^|[\s"`])text-white(?=[\s"`/])/.test(m[0])) out.push(`text-white on an inline colour: ${m[0]}`);
  }
  return out;
}

describe('panel dark theme — inks that flip with their surface', () => {
  const redefined = darkRedefined();

  it('reads the redefined steps from panel.css', () => {
    expect(redefined.has('amber-100')).toBe(true);
    expect(redefined.has('amber-900')).toBe(true);
    expect(redefined.has('amber-950')).toBe(false);
  });

  it('flags the shapes that shipped unreadable, and accepts their fixes', () => {
    expect(offences(`className="bg-amber-100 text-amber-950"`, redefined)).toHaveLength(1);
    expect(offences(`'bg-emerald-100 text-emerald-950'`, redefined)).toHaveLength(1);
    expect(offences(`className="bg-[#f2f6fc] p-0"`, redefined)).toHaveLength(1);
    expect(offences(`'bg-fuchsia-100 text-fuchsia-800'`, redefined)).toHaveLength(1);
    expect(offences(`<span className="rounded-full text-white" style={{ background: GREEN }}>`, redefined)).toHaveLength(1);
    expect(offences(`<button className="h-10 text-white"\n  style={{ background: GREEN }}>`, redefined)).toHaveLength(1);

    expect(offences(`className="bg-amber-100 text-amber-900"`, redefined)).toHaveLength(0);
    // A bright step that does not flip, with an ink that does not either: the same pair in both themes.
    expect(offences(`'bg-amber-300 text-amber-950'`, redefined)).toHaveLength(0);
    expect(offences(`className="bg-[var(--pn-chat,#f2f6fc)]"`, redefined)).toHaveLength(0);
    expect(offences(`className="bg-[#25D366] text-white"`, redefined)).toHaveLength(0);
    expect(offences(`<span className="text-[#fff]" style={{ background: GREEN }}>`, redefined)).toHaveLength(0);
  });

  it('no panel screen has one', () => {
    const found = PANEL_DIRS.flatMap(sourceFiles).flatMap((file) =>
      offences(fs.readFileSync(file, 'utf8'), redefined).map((o) => `${path.relative(SRC, file)}: ${o}`));
    expect(found).toEqual([]);
  });
});
