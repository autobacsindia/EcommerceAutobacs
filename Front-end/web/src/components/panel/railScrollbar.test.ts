import { readFileSync } from 'fs';
import { join } from 'path';

/** jsdom has no layout, so this pins the rule itself. Without it a visible scrollbar squashes the slim rail's icon highlight. */
describe('slim rail menu', () => {
  const css = readFileSync(join(__dirname, 'panel.css'), 'utf8');
  it('draws no scrollbar while it is the slim rail', () => {
    expect(css).toMatch(/\.pn-side\[data-rail='rail'\] nav\s*{\s*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.pn-side\[data-rail='rail'\] nav::-webkit-scrollbar\s*{\s*display:\s*none/);
  });
});
