'use client';

import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';

/**
 * Keyboard shortcuts shared by the panel's work screens (Tasks, Team chat):
 * one way to bind a key, one way to show the list ("?").
 *
 * A single-key shortcut ("n", "/", "?") must never fire while someone is
 * typing — in a field, a text box or a contenteditable — or "n" in a comment
 * would open a new task. Modified shortcuts (Ctrl/⌘+K) work everywhere, as in
 * Google Chat and ClickUp.
 */

/** Is the key going into something the person is typing in? */
export function isTypingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/** ⌘ on a Mac, Ctrl elsewhere — the label people expect to see. */
export const modKeyLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

export interface Hotkey {
  /** `KeyboardEvent.key`, compared case-insensitively for letters. */
  key: string;
  /** Needs Ctrl (or ⌘ on a Mac). */
  mod?: boolean;
  alt?: boolean;
  run: (e: KeyboardEvent) => void;
}

/**
 * Bind shortcuts on the window while `enabled`. Single keys are ignored while
 * typing and while another dialog is open (its own keys win); modified keys
 * always fire. The latest `keys` are used without re-binding on every render.
 */
export function useHotkeys(keys: Hotkey[], enabled = true) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      for (const k of latest.current) {
        if (k.key.toLowerCase() !== e.key.toLowerCase()) continue;
        if (!!k.mod !== mod || !!k.alt !== e.altKey) continue;
        if (!k.mod && !k.alt && (isTypingIn(e.target) || document.querySelector('[aria-modal="true"]'))) continue;
        k.run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** One key, drawn as a key cap. */
export function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-gray-200 bg-white px-1.5 font-sans text-[11px] font-semibold leading-5 text-gray-600 shadow-[0_1px_0_rgba(0,0,0,0.06)] ${className}`}>
      {children}
    </kbd>
  );
}

export interface ShortcutGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

/** The "?" sheet: every shortcut on this screen, grouped. Closes on Escape. */
export function ShortcutsDialog({ groups, onClose }: { groups: ShortcutGroup[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="pn-pop relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><Keyboard className="h-5 w-5" aria-hidden="true" /></span>
          <h2 className="pn-title flex-1 text-lg text-gray-900">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{g.title}</h3>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-4 px-3 py-2 text-sm text-gray-800">
                    {it.label}
                    <span className="flex shrink-0 items-center gap-1">
                      {it.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
