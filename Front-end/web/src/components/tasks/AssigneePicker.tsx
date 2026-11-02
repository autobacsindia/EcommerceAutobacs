'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { Avatar } from './ui';
import type { Assignee } from './types';

/**
 * Pick people: a search box ("Search or enter name…"), you at the top, then
 * everyone else as the API orders them (team heads first). Arrow keys move,
 * Enter ticks or unticks, Escape closes. Several may be ticked.
 *
 * `people` is who may be picked (the API decides); someone already ticked who is
 * no longer in that list (they left the panel) still shows, so they can be taken off.
 */
export function PeopleMenu({ people, selected, onChange, onClose, max, autoFocus = true, label = 'People' }: {
  people: Assignee[]; selected: string[]; onChange: (ids: string[]) => void; onClose?: () => void;
  max?: number; autoFocus?: boolean; label?: string;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listId = useId();
  const term = q.trim().toLowerCase();
  const known = new Set(people.map((p) => p.id));
  // Picked people the list no longer has: shown first so they can be taken off.
  const gone = selected.filter((id) => !known.has(id)).map((id) => ({ id, name: 'Someone no longer here', team: null, teamLabel: '', isHead: false, me: false }));
  const all = [...gone, ...[...people].sort((a, b) => Number(b.me) - Number(a.me))];
  const shown = term
    ? all.filter((p) => p.name.toLowerCase().includes(term) || p.teamLabel.toLowerCase().includes(term))
    : all;
  const full = max != null && selected.length >= max;
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (!full) onChange([...selected, id]);
  };
  const at = Math.min(hi, Math.max(shown.length - 1, 0));

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)]">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) toggle(shown[at].id); }
          else if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
        }}
        autoFocus={autoFocus}
        placeholder="Search or enter name…"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[at] ? `${listId}-${shown[at].id}` : undefined}
        aria-label={`Search ${label.toLowerCase()}`}
        className="mb-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <ul id={listId} role="listbox" aria-label={label} aria-multiselectable className="max-h-64 overflow-y-auto py-0.5">
        {shown.map((p, i) => {
          const on = selected.includes(p.id);
          return (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={on}
              aria-disabled={!on && full}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => toggle(p.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${i === at ? 'bg-gray-100' : ''} ${!on && full ? 'opacity-50' : ''}`}
            >
              <Avatar name={p.name} id={p.id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${on ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{p.me ? 'Me' : p.name}</span>
                {(p.teamLabel || p.me) && (
                  <span className="block truncate text-[11px] text-gray-500">
                    {p.me ? p.name : ''}{p.me && p.teamLabel ? ' · ' : ''}{p.teamLabel}{p.isHead ? ' head' : ''}
                  </span>
                )}
              </span>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${on ? 'bg-blue-600 text-white' : 'border border-gray-300'}`}>
                {on && <Check aria-hidden className="h-3 w-3" />}
              </span>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-2 text-sm text-gray-500">Nobody matches “{q.trim()}”.</li>}
      </ul>
      {full && <p className="px-2 pt-1 text-[11px] text-gray-500">{max} people at most.</p>}
    </div>
  );
}

/** The pop-over's size, for placing it (w-72 plus its padding; the list at its tallest). */
const POP_W = 304;
const POP_H = 360;
const GAP = 4;

/**
 * Where the pop-over goes for a button at `r`: below it, or above when there is
 * more room there; never past the window's edges.
 */
export function placePopover(r: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>, align: 'left' | 'right', vw: number, vh: number): CSSProperties {
  const left = Math.max(8, Math.min((align === 'right' ? r.right - POP_W : r.left), vw - POP_W - 8));
  const below = vh - r.bottom;
  return below >= POP_H || below >= r.top ? { top: r.bottom + GAP, left } : { bottom: vh - r.top + GAP, left };
}

/**
 * A button that opens `PeopleMenu` in a small pop-over next to it. The pop-over
 * is drawn on the page itself (a portal), so a scrolling board column, the side
 * panel or the new-task dialog never cuts it off; it follows the button when
 * the page scrolls. Clicking outside or Escape closes it and puts focus back on
 * the button. `onDone` runs when it closes — a screen that saves to the server
 * ticks people in a draft and saves once, there, instead of once per tick.
 */
export default function AssigneePicker({ trigger, triggerLabel, align = 'left', disabled = false, onDone, ...menu }: {
  trigger: ReactNode; triggerLabel: string; align?: 'left' | 'right'; disabled?: boolean; onDone?: () => void;
} & Omit<Parameters<typeof PeopleMenu>[0], 'onClose' | 'autoFocus'>) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The latest onDone, read when it closes (never written during render).
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  const shut = () => { setOpen(false); done.current?.(); };
  const close = () => { shut(); button.current?.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const inside = (n: Node) => !!(wrap.current?.contains(n) || pop.current?.contains(n));
    const away = (e: MouseEvent) => { if (!inside(e.target as Node)) { setOpen(false); done.current?.(); } };
    const measure = () => {
      const r = button.current?.getBoundingClientRect();
      if (r) setPlace(placePopover(r, align, window.innerWidth, window.innerHeight));
    };
    measure();
    document.addEventListener('mousedown', away);
    // Capture: a scroll inside any column or panel moves the button too.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, align]);

  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        onClick={() => (open ? shut() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        className="inline-flex items-center rounded-md disabled:cursor-default"
      >
        {trigger}
      </button>
      {open && place && createPortal(
        // In the panel's and the task screens' style scopes, so it matches them.
        <div ref={pop} data-popover style={place} className="panel-theme admin-panel tk-theme fixed z-[60] rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <PeopleMenu {...menu} onClose={close} />
        </div>,
        document.body,
      )}
    </div>
  );
}
