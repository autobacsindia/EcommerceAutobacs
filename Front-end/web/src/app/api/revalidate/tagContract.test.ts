/**
 * Drift guard: every Next.js cache tag declared anywhere in the app must be one
 * the backend revalidator can actually emit.
 *
 * The failure this prevents is silent. Both the backend
 * (services/frontendRevalidator.js) and this route filter incoming tags to
 * ALLOWED_PREFIXES and drop the rest without erroring, so a page tagged with a
 * name outside the list looks fully wired — `revalidate` + `tags` are right
 * there in the fetch — while nothing can ever purge it. That is exactly how
 * /products came to serve up to 300s stale and /categories up to 600s after
 * every admin edit.
 *
 * This test reads the real source files rather than a fixture list so a newly
 * added page is covered the moment it lands.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { isAllowedTag } from '@/lib/revalidateTags';

const SRC = join(__dirname, '..', '..', '..');

/**
 * Tags refreshed by a dedicated same-origin route the ADMIN BROWSER calls, not
 * by the backend revalidator — so they legitimately sit outside ALLOWED_PREFIXES.
 * Adding a tag here is a claim that an admin write path calls its route; the
 * next test enforces that claim.
 */
const BROWSER_REVALIDATED = new Set(['warehouses']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Pull the string literals out of every `tags: [ ... ]` in a Next fetch option. */
function declaredTags(source: string): string[] {
  const tags: string[] = [];
  for (const block of source.matchAll(/next:\s*\{[^}]*?tags:\s*\[([^\]]*)\]/gs)) {
    for (const literal of block[1].matchAll(/['"`]([^'"`$]+)['"`]/g)) {
      tags.push(literal[1]);
    }
  }
  return tags;
}

describe('Next.js cache tag contract', () => {
  const files = walk(SRC);

  it('finds the pages that declare cache tags (guards the scanner itself)', () => {
    const withTags = files.filter((f) => declaredTags(readFileSync(f, 'utf8')).length > 0);
    // If this drops to zero the regex silently stopped matching and every
    // assertion below would vacuously pass.
    expect(withTags.length).toBeGreaterThan(3);
  });

  it('every declared tag uses a prefix the backend revalidator can emit', () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const tag of declaredTags(readFileSync(file, 'utf8'))) {
        if (!isAllowedTag(tag) && !BROWSER_REVALIDATED.has(tag)) {
          offenders.push(`${file.replace(SRC, 'src')} → "${tag}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every browser-revalidated tag has a live admin caller on each write path', () => {
    // The exception above is only safe while the admin write paths actually call
    // the route. Assert the wiring exists, or the exception quietly becomes the
    // very bug this file guards against.
    //
    // Named files rather than a count: a bare `>= 4` passes for the wrong reasons
    // after any refactor that moves or merges callers, which is exactly when this
    // guard needs to speak up.
    const requiredCallers = [
      join(SRC, 'lib', 'revalidateWarehouses.ts'), // the helper itself
      join(SRC, 'app', 'admin', 'warehouses', 'WarehouseForm.tsx'), // create + edit
      join(SRC, 'app', 'admin', 'warehouses', 'page.tsx'), // delete
      join(SRC, 'app', 'admin', 'warehouses', '[id]', 'page.tsx'), // homepage toggle
    ];

    const missing = requiredCallers.filter(
      (f) => !readFileSync(f, 'utf8').includes('revalidateWarehouses')
    );
    expect(missing).toEqual([]);
  });

  it('keeps the catalog and category listings on revalidatable tags', () => {
    // Named explicitly because these two are the highest-traffic stale surfaces:
    // a wrong price or availability on /products is a consumer-trust problem.
    const products = readFileSync(join(SRC, 'app', 'products', 'page.tsx'), 'utf8');
    const categories = readFileSync(join(SRC, 'app', 'categories', 'page.tsx'), 'utf8');
    expect(declaredTags(products)).toContain('product:list');
    expect(declaredTags(categories)).toContain('category:list');
  });
});
