/**
 * posthog-js must stay OUT of the first-load bundle (225 KB, the biggest file on
 * every storefront page until 2026-11-28). The only thing that can put it back is a
 * value import somewhere, so that is what this guards. Type-only imports are erased.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const ALLOWED = path.join(SRC, 'lib', 'posthogLoader.ts');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('posthog-js is loaded on demand only', () => {
  it('has no value import outside lib/posthogLoader.ts', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file === ALLOWED) return false;
      const src = fs.readFileSync(file, 'utf8');
      const valueImport = /import\s+(?!type\b)[^;]*?from\s+['"]posthog-js(\/[^'"]*)?['"]/;
      const sideEffect = /import\s+['"]posthog-js/;
      const required = /require\(\s*['"]posthog-js/;
      return valueImport.test(src) || sideEffect.test(src) || required.test(src);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('the loader itself only uses a dynamic import()', () => {
    const src = fs.readFileSync(ALLOWED, 'utf8');
    expect(src).toMatch(/import\(\s*'posthog-js'\s*\)/);
    expect(src).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'posthog-js'/m);
  });
});

describe('loadPostHog', () => {
  beforeEach(() => jest.resetModules());

  it('fetches once and hands back the same client', async () => {
    jest.doMock('posthog-js', () => ({ __esModule: true, default: { __loaded: false } }));
    const { loadPostHog, readyPostHog } = await import('./posthogLoader');
    const [a, b] = await Promise.all([loadPostHog(), loadPostHog()]);
    expect(a).toBe(b);
    expect(readyPostHog()).toBeNull(); // fetched but not started
    (a as { __loaded: boolean }).__loaded = true;
    expect(readyPostHog()).toBe(a);
  });
});
