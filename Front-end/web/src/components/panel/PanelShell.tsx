'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Ellipsis, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Pin, PinOff, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PushPrompt from '@/components/notifications/PushPrompt';
import PanelThemeSwitch from './PanelThemeSwitch';
import PersonFace from '@/components/profile/PersonFace';
import { moreCount } from './navMore';
import './panel.css';

export type PanelNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Unread count shown beside the label (chat). */
  count?: number;
};

export type PanelNavSection = {
  /** No title = always open, no header (the first group). */
  title?: string;
  items: PanelNavItem[];
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Links folded under one "More" button at the end of the section (see
   * `splitMore`). Opens by itself when the current page is one of them; an
   * empty list shows no button.
   */
  more?: PanelNavItem[];
};

/** This device remembers whether the hover rail is pinned open. */
export const RAIL_PIN_KEY = 'panel-rail-pinned';
const readPinned = () => { try { return localStorage.getItem(RAIL_PIN_KEY) === '1'; } catch { return false; } };
const writePinned = (on: boolean) => { try { localStorage.setItem(RAIL_PIN_KEY, on ? '1' : '0'); } catch { /* storage blocked: this visit only */ } };
// Hover intent: a mouse crossing the rail on its way somewhere does not open it.
const PEEK_OPEN_MS = 120;
const PEEK_CLOSE_MS = 220;

/**
 * The frame shared by the admin and team panels: a deep emerald sidebar with
 * the white Roavion logo, a white top bar, and on phones a menu
 * button that slides the sidebar in over the page. Visual only — every link,
 * section and button is the caller's, so behaviour stays where it was.
 */
export default function PanelShell({
  homeHref,
  subtitle,
  sections,
  heading,
  actions,
  user,
  footer,
  onLogout,
  collapsed = false,
  onToggleCollapsed,
  hoverRail = false,
  tightPage = false,
  children,
}: {
  homeHref: string;
  /** Under the logo: "Admin panel", "GTM team". */
  subtitle: ReactNode;
  sections: PanelNavSection[];
  /** Left side of the top bar. */
  heading: ReactNode;
  /** Right side of the top bar. */
  actions?: ReactNode;
  /** `profileHref` makes the sidebar's name card a link to "My profile". */
  user: { name: string; role?: ReactNode; photoUrl?: string; profileHref?: string };
  /** Extra links in the sidebar footer (change password). */
  footer?: ReactNode;
  onLogout: () => void;
  /** Desktop icon-only rail (admin). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Desktop: an icon rail that opens OVER the page on hover or keyboard focus
   * (the page never shifts), with a pin to keep it open. For screens that want
   * the room. Replaces `collapsed`. Phones keep the drawer; touch tablets
   * (no hover) also get the top-bar menu button, which opens it over the page.
   */
  hoverRail?: boolean;
  /** Less padding round the page, for screens that want every pixel (Tasks). */
  tightPage?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const userCard = (
    <>
      <PersonFace name={user.name} photoUrl={user.photoUrl} className="pn-avatar h-9 w-9 text-xs font-bold" />
      <div className="min-w-0">
        <p className="pn-side-name truncate text-sm font-semibold">{user.name}</p>
        {user.role && <p className="pn-side-muted truncate text-xs">{user.role}</p>}
        {user.profileHref && <p className="pn-side-muted truncate text-[11px] underline-offset-2">My profile</p>}
      </div>
    </>
  );
  const [menuOpen, setMenuOpen] = useState(false);
  // "More" open/closed per section, as the person left it on this page. Cleared
  // on navigation so the next page opens it only if it lives inside "More".
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read after mount: the server cannot know this browser's choice.
  useEffect(() => { if (hoverRail) setPinned(readPinned()); }, [hoverRail]);
  const peekLater = useCallback((on: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(on), on ? PEEK_OPEN_MS : PEEK_CLOSE_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    writePinned(next);
    if (!next) setPeek(false);
  };

  const isRail = hoverRail ? !pinned : collapsed;
  // Open over the page: the rail is peeking, not pinned.
  const overlay = hoverRail && !pinned && peek && !menuOpen;
  const rail = isRail && !menuOpen && !overlay;

  // A tap on a link navigates; the drawer must not stay over the new page.
  useEffect(() => { setMenuOpen(false); setPeek(false); setMoreOpen({}); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const railWidth = hoverRail ? 'md:w-[60px]' : 'md:w-[76px]';
  const width = rail ? railWidth : 'md:w-64';
  const offset = !isRail ? 'md:ml-64' : hoverRail ? 'md:ml-[60px]' : 'md:ml-[76px]';
  const railEvents = hoverRail && !pinned ? {
    onMouseEnter: () => peekLater(true),
    onMouseLeave: () => peekLater(false),
    onFocus: () => { if (timer.current) clearTimeout(timer.current); setPeek(true); },
    onBlur: (e: FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) peekLater(false); },
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Escape' && peek) { e.stopPropagation(); setPeek(false); } },
  } : {};

  const navLink = ({ href, label, icon: Icon, active, count }: PanelNavItem) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? 'page' : undefined}
      title={rail ? label : undefined}
      className={`pn-nav flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${rail ? 'md:justify-center md:px-0' : ''}`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className={`min-w-0 flex-1 truncate ${rail ? 'md:sr-only' : ''}`}>{label}</span>
      {!!count && count > 0 && (
        <span className={`pn-count rounded-full px-1.5 text-[11px] font-bold leading-[18px] ${rail ? 'md:hidden' : ''}`} aria-label={`${count} unread`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );

  return (
    <div className={`panel-theme admin-panel min-h-screen${hoverRail ? ' pn-rail-touch' : ''}`}>
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="pn-menu-backdrop fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        id="panel-menu"
        data-open={menuOpen}
        data-rail={hoverRail ? (pinned ? 'pinned' : overlay ? 'peek' : 'rail') : undefined}
        className={`pn-side pn-drawer fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col transition-[width] duration-200 ${width}${hoverRail ? ' md:overflow-x-hidden' : ''}${overlay ? ' pn-rail-peek' : ''}`}
        {...railEvents}
      >
        <div className={`pn-brand flex items-center gap-2 px-5 py-5 ${rail ? 'md:justify-center md:px-2' : ''}`}>
          <Link href={homeHref} className={`min-w-0 flex-1 ${rail ? 'md:hidden' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/roavion-logo.png" alt="Roavion" width={960} height={255} className="pn-logo h-7 w-auto" />
            <span className="pn-brand-sub mt-2 block truncate">{subtitle}</span>
          </Link>
          {hoverRail ? (
            <button
              type="button"
              onClick={togglePin}
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin menu' : 'Keep menu open'}
              title={pinned ? 'Unpin menu' : 'Keep menu open'}
              className="pn-brand-btn hidden p-2 md:block"
            >
              {pinned ? <PinOff className="h-4 w-4" /> : rail ? <PanelLeftOpen className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          ) : onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              className="pn-brand-btn hidden p-2 md:block"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="pn-brand-btn p-2 md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Panel menu" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {sections.map((section, i) => {
            const open = !section.title || section.expanded !== false || rail;
            return (
              <div key={section.title || i} className={section.title ? 'pt-2' : ''}>
                {section.title && !rail && (
                  <button
                    type="button"
                    onClick={section.onToggle}
                    aria-expanded={open}
                    className="pn-section flex w-full items-center justify-between rounded-md px-3 py-1.5"
                  >
                    <span>{section.title}</span>
                    {section.onToggle && <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />}
                  </button>
                )}
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {section.items.map(navLink)}
                    {!!section.more?.length && (() => {
                      const key = section.title || String(i);
                      const hasActive = section.more.some((m) => m.active);
                      const isOpen = moreOpen[key] ?? hasActive;
                      const hidden = isOpen ? 0 : moreCount(section.more);
                      const listId = `panel-more-${i}`;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => setMoreOpen((prev) => ({ ...prev, [key]: !isOpen }))}
                            aria-expanded={isOpen}
                            aria-controls={listId}
                            aria-label={hidden > 0 ? `More, ${hidden} unread` : undefined}
                            data-active={hasActive && !isOpen}
                            title={rail ? 'More' : undefined}
                            className={`pn-nav pn-more flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${rail ? 'md:justify-center md:px-0' : ''}`}
                          >
                            <Ellipsis className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            <span className={`min-w-0 flex-1 truncate ${rail ? 'md:sr-only' : ''}`}>More</span>
                            {hidden > 0 && (
                              <span className={`pn-count rounded-full px-1.5 text-[11px] font-bold leading-[18px] ${rail ? 'md:hidden' : ''}`} aria-hidden="true">
                                {hidden > 99 ? '99+' : hidden}
                              </span>
                            )}
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''} ${rail ? 'md:hidden' : ''}`} aria-hidden="true" />
                          </button>
                          {isOpen && (
                            <div id={listId} className={`pn-more-list space-y-0.5 ${rail ? '' : 'ml-4 pl-2'}`}>
                              {section.more.map(navLink)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={`pn-side-line border-t p-3 ${rail ? 'md:px-2' : ''}`}>
          <div className={`pn-user rounded-xl p-2.5 ${rail ? 'md:hidden' : ''}`}>
            {user.profileHref ? (
              <Link href={user.profileHref} title="My profile" className="flex items-center gap-3 rounded-lg hover:opacity-90">
                {userCard}
              </Link>
            ) : (
              <div className="flex items-center gap-3">{userCard}</div>
            )}
            {footer && <div className="mt-2 border-t border-white/10 pt-2">{footer}</div>}
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            className={`pn-logout mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-colors`}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className={rail ? 'md:sr-only' : ''}>Log out</span>
          </button>
        </div>
      </aside>

      <div className={`flex min-h-screen min-w-0 flex-col transition-[margin] duration-200 ${offset}`}>
        <header className="pn-bar sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-controls="panel-menu"
            aria-expanded={menuOpen}
            className="pn-menu-btn -ml-1 rounded-lg p-2 text-gray-700 hover:bg-gray-100 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{heading}</div>
          <div className="flex flex-wrap items-center gap-2">
            <PanelThemeSwitch />
            {actions}
          </div>
        </header>
        <main className={`min-w-0 flex-1 ${tightPage ? 'p-3 md:p-5' : 'p-4 md:p-6 lg:p-8'}`}>
          <PushPrompt />
          {children}
        </main>
      </div>
    </div>
  );
}
