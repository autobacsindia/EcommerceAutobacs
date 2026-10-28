'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PushPrompt from '@/components/notifications/PushPrompt';
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
};

/**
 * The frame shared by the admin and team panels: a black sidebar with the
 * Roavion logo (as on the store header), a white top bar, and on phones a menu
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
  user: { name: string; role?: ReactNode };
  /** Extra links in the sidebar footer (change password). */
  footer?: ReactNode;
  onLogout: () => void;
  /** Desktop icon-only rail (admin). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const rail = collapsed && !menuOpen;

  // A tap on a link navigates; the drawer must not stay over the new page.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const width = rail ? 'md:w-[76px]' : 'md:w-64';
  const offset = collapsed ? 'md:ml-[76px]' : 'md:ml-64';

  return (
    <div className="panel-theme admin-panel min-h-screen">
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        id="panel-menu"
        data-open={menuOpen}
        className={`pn-side pn-drawer fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col transition-[width] duration-200 ${width}`}
      >
        <div className={`pn-side-line flex items-center gap-2 border-b px-4 py-4 ${rail ? 'md:justify-center md:px-2' : ''}`}>
          <Link href={homeHref} className={`min-w-0 flex-1 ${rail ? 'md:hidden' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/roavion-logo.png" alt="Roavion" width={960} height={255} className="h-7 w-auto" />
            <span className="pn-side-muted mt-1.5 block truncate text-xs">{subtitle}</span>
          </Link>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              className="pn-nav hidden rounded-lg p-2 md:block"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="pn-nav rounded-lg p-2 md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Panel menu" className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
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
                    {section.items.map(({ href, label, icon: Icon, active, count }) => (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        title={rail ? label : undefined}
                        className={`pn-nav flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${rail ? 'md:justify-center md:px-0' : ''}`}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        <span className={`min-w-0 flex-1 truncate ${rail ? 'md:sr-only' : ''}`}>{label}</span>
                        {!!count && count > 0 && (
                          <span className={`pn-count rounded-full px-1.5 text-[11px] font-bold leading-[18px] ${rail ? 'md:hidden' : ''}`} aria-label={`${count} unread`}>
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={`pn-side-line border-t p-3 ${rail ? 'md:px-2' : ''}`}>
          <div className={`flex items-center gap-3 px-1 ${rail ? 'md:hidden' : ''}`}>
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#12753f] text-xs font-bold text-[#fff]">
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#fff]">{user.name}</p>
              {user.role && <p className="pn-side-muted truncate text-xs">{user.role}</p>}
            </div>
          </div>
          {footer && <div className={`mt-2 px-1 ${rail ? 'md:hidden' : ''}`}>{footer}</div>}
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
            className="-ml-1 rounded-lg p-2 text-gray-700 hover:bg-gray-100 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{heading}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <PushPrompt />
          {children}
        </main>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '·';
}
