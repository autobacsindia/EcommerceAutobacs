/**
 * The help panel is for questions. The human channels (WhatsApp, Call) already
 * float beside it, and a contact footer inside the panel repeated them in the
 * one place space is scarce — so it was removed on request. A person is still
 * one tap away through the "Talk to a person" answer.
 */
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import HelpBot from './HelpBot';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ suggestions: [] }) } }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));

describe('help panel', () => {
  // jsdom has no scrollIntoView; the panel scrolls to its newest message.
  beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });

  it('has no call / email / WhatsApp footer', () => {
    render(<HelpBot />);
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }));
    const panel = screen.getByRole('dialog', { name: 'Help' });
    const hrefs = within(panel).queryAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((h) => h.startsWith('tel:') || h.startsWith('mailto:'))).toEqual([]);
    expect(within(panel).queryByText('Email')).toBeNull();
  });
});

/**
 * The "Need help?" edge tab was dropped from the root layout when the help bot
 * arrived, and nothing noticed. Both are wanted: the tab is the always-visible
 * route to /contact, the bot answers questions. Asserted on the layout source
 * because the root layout is an async server component that cannot be rendered
 * in jsdom.
 */
describe('root layout', () => {
  const layout = fs.readFileSync(path.join(__dirname, '../../app/layout.tsx'), 'utf8');
  it('mounts the Need-help tab alongside the help bot', () => {
    expect(layout).toMatch(/<HelpWidget\s*\/>/);
    expect(layout).toMatch(/<HelpBot\s*\/>/);
  });
});
