/**
 * Every hard-coded "/something.jpg" in app code must exist in public/.
 *
 * '/placeholder-product.jpg' and '/placeholder.jpg' never existed: each product
 * without a photo showed a broken image, and the miss fell through to the
 * catch-all [slug] route, which asked the API for an article called
 * "placeholder-product.jpg" (a 404 in the production logs on every hit).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.resolve(ROOT, '..', 'public');
const ASSET = /['"`](\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg|gif|ico|avif))['"`]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('every literal public-asset path in app code points at a real file', () => {
  const missing: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return; // docs/examples
      for (const m of line.matchAll(ASSET)) {
        const asset = m[1];
        if (asset.startsWith('//') || asset.startsWith('/api/')) continue;
        if (!fs.existsSync(path.join(PUBLIC, asset))) missing.push(`${path.relative(ROOT, file)}:${i + 1} ${asset}`);
      }
    });
  }
  expect(missing).toEqual([]);
});
