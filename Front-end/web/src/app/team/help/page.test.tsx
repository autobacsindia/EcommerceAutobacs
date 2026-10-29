/**
 * /team/help: every team's "how do I…" in one page, each answer pointing at the
 * panel page that does it — and kept private (staff only, never crawled).
 */
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import TeamHelpPage from './page';
import robots from '../../robots';
import { TEAM_HELP } from '@/lib/help/teamFaq';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

const APP = path.join(__dirname, '../..');
const routeExists = (href: string) =>
  ['page.tsx', 'page.ts'].some((f) => fs.existsSync(path.join(APP, ...href.split(/[?#]/)[0].split('/').filter(Boolean), f)));

it('covers every team, with every question on the page', () => {
  render(<TeamHelpPage />);
  const items = TEAM_HELP.flatMap((s) => s.items);
  expect(items.length).toBeGreaterThanOrEqual(20);
  for (const i of items) expect(screen.getByText(i.question)).toBeInTheDocument();
  for (const who of ['GTM', 'Procurement', 'Accounts', 'Operations']) {
    expect(TEAM_HELP.some((s) => s.forWho === who)).toBe(true);
  }
});

it('every link goes to a real panel page', () => {
  render(<TeamHelpPage />);
  const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') || '').filter((h) => h.startsWith('/'));
  expect(hrefs.length).toBeGreaterThan(15);
  for (const href of hrefs) expect([href, routeExists(href)]).toEqual([href, true]);
});

it('the section shortcuts jump to sections that exist', () => {
  const { container } = render(<TeamHelpPage />);
  const anchors = within(screen.getByRole('navigation', { name: 'Help sections' })).getAllByRole('link');
  expect(anchors).toHaveLength(TEAM_HELP.length);
  for (const a of anchors) expect(container.querySelector(a.getAttribute('href')!)).not.toBeNull();
});

it('shows step-by-step answers as a list', () => {
  render(<TeamHelpPage />);
  const colours = screen.getByText('What do the stage colours mean?').closest('details')!;
  expect(within(colours).getAllByRole('listitem').length).toBeGreaterThanOrEqual(7);
});

it('stays private: crawlers are kept out of the whole team panel', () => {
  const rules = robots().rules;
  const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) => r.disallow ?? []);
  expect(disallow).toContain('/team');
});
