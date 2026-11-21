/**
 * The help panel is for questions. The human channels (WhatsApp, Call) already
 * float beside it, and a contact footer inside the panel repeated them in the
 * one place space is scarce — so it was removed on request. A person is still
 * one tap away through the "Talk to a person" answer.
 */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import HelpBot from './HelpBot';
import { OPEN_HELP_BOT_EVENT } from './helpBotVisibility';
import { capture } from '@/lib/analytics';
import { setBuyBarHeight } from '@/lib/floatingClearance';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ suggestions: [] }) } }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));

describe('help panel', () => {
  // jsdom has no scrollIntoView; the panel scrolls to its newest message.
  beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });

  it('has its own launcher on desktop only — on phones ContactFab\'s Chat button opens it', () => {
    render(<HelpBot />);
    const launcher = screen.getByRole('button', { name: 'Open help' });
    expect(launcher).toHaveClass('hidden', 'md:flex', 'h-14', 'w-14', 'bottom-6');
  });

  it('on phones the panel opens just above the WhatsApp / Call / Chat stack, lifted with the buy bar', () => {
    render(<HelpBot />);
    act(() => { window.dispatchEvent(new Event(OPEN_HELP_BOT_EVENT)); });
    const panel = screen.getByRole('dialog', { name: 'Help' });
    expect(panel.className).toContain('bottom-[calc(176px_+_env(safe-area-inset-bottom))]');
    expect(panel).toHaveClass('md:bottom-28');
    expect(panel.style.transform).toBe('translateY(-0px)');
    act(() => setBuyBarHeight(117));
    expect(panel.style.transform).toBe('translateY(-117px)');
    act(() => setBuyBarHeight(0));
  });

  it('counts one chat contact when opened, none when closed', () => {
    (capture as jest.Mock).mockClear();
    render(<HelpBot />);
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close help' })[0]);
    const contacts = (capture as jest.Mock).mock.calls.filter(([e]) => e === 'contact_click');
    expect(contacts).toEqual([['contact_click', { channel: 'chat', path: '/' }]]);
  });

  it('opens when another control asks it to', () => {
    render(<HelpBot />);
    expect(screen.queryByRole('button', { name: 'Close help' })).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event(OPEN_HELP_BOT_EVENT)); });
    expect(screen.getAllByRole('button', { name: 'Close help' }).length).toBeGreaterThan(0);
  });

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
