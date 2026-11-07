/**
 * Guards the self-hosted font setup (see src/fonts/siteFonts.ts).
 *
 * `next/font/google` downloads font files from Google during `next build`;
 * when that download flaked, CI's Build check (and potentially a Vercel
 * production deploy) failed. These checks keep that dependency from creeping
 * back and keep the local font calls pointing at files that exist.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
const FONT_MODULES = [path.join(SRC, 'fonts/siteFonts.ts'), path.join(SRC, 'lib/chatFont.ts')];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?|mjs)$/.test(e.name) && !/\.test\.[tj]sx?$/.test(e.name) ? [full] : [];
  });
}

/** Split a font module into its `localFont({...})` call bodies. */
function localFontCalls(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('localFont({').slice(1);
}

describe('self-hosted fonts', () => {
  it('no app code imports next/font/google (it downloads at build time)', () => {
    const offenders = sourceFiles(SRC).filter((f) =>
      /from\s+['"]next\/font\/google['"]/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it.each(FONT_MODULES)('every font file referenced by %s exists', (file) => {
    const paths = [...fs.readFileSync(file, 'utf8').matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((p) => !fs.existsSync(path.resolve(path.dirname(file), p)));
    expect(missing).toEqual([]);
  });

  it.each(FONT_MODULES)('%s: exactly one call per family is preloaded, sets the CSS variable and builds the size-matched fallback', (file) => {
    const calls = localFontCalls(file);
    const families = new Set(calls.map((c) => c.match(/prop: 'font-family', value: '([^']+)'/)?.[1]));
    for (const family of families) {
      const own = calls.filter((c) => c.includes(`value: '${family}'`));
      const primary = own.filter((c) => /preload: true/.test(c));
      expect(primary).toHaveLength(1);
      expect(primary[0]).toMatch(/variable: '--font-[a-z-]+'/);
      expect(primary[0]).toMatch(/adjustFontFallback: 'Arial'/);
      expect(primary[0]).toMatch(/\/latin\.woff2'/);
      // The latin subset must be declared last, like Google's CSS, so it wins on overlapping code points.
      expect(own[own.length - 1]).toBe(primary[0]);
      for (const c of own) {
        expect(c).toMatch(/prop: 'unicode-range'/);
        expect(c).toMatch(/display: 'swap'/);
      }
    }
  });

  it('ships the SIL Open Font License beside each font family', () => {
    const fontsDir = path.join(SRC, 'fonts');
    const families = fs.readdirSync(fontsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(families.length).toBeGreaterThan(0);
    for (const fam of families) {
      const licence = fs.readFileSync(path.join(fontsDir, fam.name, 'OFL.txt'), 'utf8');
      expect(licence).toMatch(/SIL Open Font License, Version 1\.1/);
    }
  });
});
