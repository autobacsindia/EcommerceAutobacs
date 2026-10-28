/**
 * Dark theme: white text on a fixed-colour storefront surface must stay white.
 *
 * globals.css inverts `--color-white` under [data-theme='dark'] so `bg-white`
 * cards turn dark. `text-white` reads the same variable, so it turns near-black
 * too. On a surface that ADAPTS (bg-white, bg-gray-*, bg-gold) that is the
 * point. On a surface painted with a literal colour — `bg-[#121414]`,
 * `from-[#0d6b3e]` — the background stays dark and the text vanishes. That is
 * how the floating "Need help?" tab shipped at 1.05:1 in dark mode, along with
 * the help chat's header and the Contact page's green card.
 *
 * On a literal dark surface write `text-[#fff]` (opacity: `text-[#fff]/70`).
 * The mirror image fails the same way: literal dark text (`text-[#333838]`) on
 * a `bg-white` card stays dark while the card turns dark — use `text-ink`.
 *
 * Scope: the storefront. The admin and team panels re-theme their colour ramps
 * in components/panel/panel.css, where dark text on a lightened button is the
 * intended design, so they are left to that file.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');

const PANEL_DIRS = [
  'app/admin', 'app/team', 'app/staff-invite',
  'components/admin', 'components/staff', 'components/panel',
  'components/notifications', 'components/chat', 'components/tasks',
].map((d) => path.join(SRC, d) + path.sep);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [full] : [];
  });
}

/** Relative luminance of a #rgb / #rrggbb colour. */
function luminance(hex: string): number {
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A literal background or gradient stop, with its state prefix ('', 'hover:'…).
// A trailing /NN is a translucent tint, not a surface on its own.
const LITERAL_SURFACE = /(?:^|\s)((?:[\w-]+:)*)(?:bg|from|via|to)-\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\](?!\/)/g;
const INVERTING_WHITE_TEXT = /(?:^|\s)(?:[\w-]+:)*text-white(?:\/\d+)?(?=\s|$)/;
// The mirror image: a base `bg-white` card (dark in the dark theme) with literal dark text.
const ADAPTING_WHITE_SURFACE = /(?:^|\s)bg-white(?=\s|$)/;
const LITERAL_TEXT = /(?:^|\s)text-\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\](?=[\s/]|$)/g;
// Every string literal: '…', "…" and `…` (template literals keep their ${…} parts).
const STRINGS = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;

/**
 * Class strings that show inverting white text on a dark literal surface. A
 * surface that only appears in a state (`hover:bg-[#0b6b3c]` on a `bg-gold`
 * button) needs non-inverting text in that same state: `hover:text-[#fff]`.
 */
function offendingClassStrings(source: string): string[] {
  return (source.match(STRINGS) ?? []).filter((literal) => {
    const s = ` ${literal.slice(1, -1)} `;
    if (ADAPTING_WHITE_SURFACE.test(s) && [...s.matchAll(LITERAL_TEXT)].some((m) => luminance(m[1]) < 0.2)) return true;
    if (!INVERTING_WHITE_TEXT.test(s)) return false;
    return [...s.matchAll(LITERAL_SURFACE)]
      .filter((m) => luminance(m[2]) < 0.2)
      .some(([, state]) => !s.includes(` ${state}text-[#fff]`));
  });
}

describe('dark theme — literal storefront surfaces', () => {
  it('flags text-white on a literal dark surface, and accepts the fixed forms', () => {
    expect(offendingClassStrings(`className="bg-[#121414] px-2 text-white"`)).toHaveLength(1);
    expect(offendingClassStrings(`className="bg-gradient-to-br from-[#0d6b3e] to-[#0a5c33] text-white/85"`)).toHaveLength(1);
    expect(offendingClassStrings(`className="bg-[#0a5c33] hover:text-white"`)).toHaveLength(1);
    expect(offendingClassStrings(`className="bg-[#121414] text-[#fff]"`)).toHaveLength(0);
    // A dark surface that appears only on hover needs white text on hover too.
    expect(offendingClassStrings(`className="bg-gold text-white hover:bg-[#0b6b3c]"`)).toHaveLength(1);
    expect(offendingClassStrings(`className="bg-gold text-white hover:bg-[#0b6b3c] hover:text-[#fff]"`)).toHaveLength(0);
    // Adapting surfaces and light literals are fine.
    expect(offendingClassStrings(`className="bg-gold text-white"`)).toHaveLength(0);
    expect(offendingClassStrings(`className="bg-[#25D366] text-white"`)).toHaveLength(0);
    // Mirror image: literal dark text on a card that turns dark.
    expect(offendingClassStrings(`className="bg-white px-3 text-[#333838]"`)).toHaveLength(1);
    expect(offendingClassStrings(`className="bg-white px-3 text-ink"`)).toHaveLength(0);
    // A translucent tint is not a surface on its own.
    expect(offendingClassStrings(`className="bg-[#0a5c33]/40 text-white"`)).toHaveLength(0);
  });

  it('no storefront component puts inverting white text on a literal dark surface', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !PANEL_DIRS.some((d) => f.startsWith(d)))
      .flatMap((f) => offendingClassStrings(fs.readFileSync(f, 'utf8'))
        .map((s) => `${path.relative(SRC, f)}: ${s.slice(0, 120)}`));
    expect(offenders).toEqual([]);
  });
});
