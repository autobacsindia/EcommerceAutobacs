'use client';

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { filesFromClipboard, matchesAccept, namePastedFile } from '@/lib/clipboardFiles';

/**
 * Ctrl/Cmd+V of a screenshot attaches it to a file picker, exactly as if it had
 * been chosen — the picker's own `take` runs, with its own type, size and count
 * checks. There is one document-level listener for every picker on the page.
 *
 * A paste only fires on the focused element (the page body when nothing is), so
 * the listener decides which picker it is for:
 *   1. the picker the focus is in, or that was clicked last;
 *   2. otherwise a picker in the same form as the focus / the last click — the
 *      first one in it that takes this kind of file and has room;
 *   3. otherwise the only picker on the page.
 * Anything else is ambiguous and left alone, rather than attached to the wrong
 * form. Text pasted into a text field is never intercepted, and a paste a field
 * already handled itself (the chat composer) is skipped.
 */

type Zone = {
  el: RefObject<HTMLElement | null>;
  accept: () => string;
  hasRoom: () => boolean;
  take: (files: File[]) => void;
};

const zones = new Set<Zone>();
let lastPointer: EventTarget | null = null;
let installed = false;

const isNode = (t: EventTarget | null): t is Node => typeof Node !== 'undefined' && t instanceof Node;

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && !['file', 'checkbox', 'radio', 'button', 'submit'].includes(t.type);
}

/** Zones in document order, so "the first picker in the form" means what it says. */
function inDocumentOrder(list: Zone[]): Zone[] {
  return [...list].sort((a, b) => {
    const x = a.el.current, y = b.el.current;
    if (!x || !y) return 0;
    return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

export function pickZone(target: EventTarget | null, files: File[]): Zone | null {
  const all = inDocumentOrder([...zones].filter((z) => z.el.current));
  const fits = (z: Zone) => z.hasRoom() && files.some((f) => matchesAccept(f, z.accept()));
  for (const t of [target, lastPointer]) {
    if (!isNode(t)) continue;
    const own = all.find((z) => z.el.current!.contains(t));
    if (own) return own;
  }
  for (const t of [target, lastPointer]) {
    if (!isNode(t)) continue;
    const form = (t instanceof Element ? t : t.parentElement)?.closest('form');
    if (!form) continue;
    const inForm = all.filter((z) => form.contains(z.el.current));
    if (inForm.length) return inForm.find(fits) ?? inForm[0];
  }
  return all.length === 1 ? all[0] : null;
}

function onPaste(e: ClipboardEvent) {
  if (e.defaultPrevented || !zones.size) return;
  const types = Array.from(e.clipboardData?.types ?? []);
  if (isTextField(e.target) && types.includes('text/plain')) return;
  const files = filesFromClipboard(e.clipboardData);
  if (!files.length) return;
  const zone = pickZone(e.target, files);
  if (!zone) return;
  e.preventDefault();
  zone.take(files.map((f) => namePastedFile(f)));
}

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (e) => { lastPointer = e.target; }, true);
  document.addEventListener('paste', onPaste);
}

/**
 * Register `el` as a paste target. `take` receives the pasted files (screenshots
 * renamed from "image.png") and applies the same checks as choosing them.
 */
export function usePasteFiles(
  el: RefObject<HTMLElement | null>,
  { accept, hasRoom, take }: { accept: string; hasRoom: boolean; take: (files: File[]) => void },
) {
  const latest = useRef({ accept, hasRoom, take });
  useEffect(() => { latest.current = { accept, hasRoom, take }; });
  useEffect(() => {
    install();
    const zone: Zone = {
      el,
      accept: () => latest.current.accept,
      hasRoom: () => latest.current.hasRoom,
      take: (files) => latest.current.take(files),
    };
    zones.add(zone);
    return () => { zones.delete(zone); };
  }, [el]);
}

const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘V" on a Mac, "Ctrl+V" elsewhere (and on the server, so hydration agrees). */
export function usePasteShortcut(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (isApple() ? '⌘V' : 'Ctrl+V'),
    () => 'Ctrl+V',
  );
}

/** Test-only: forget registered pickers and the last click between tests. */
export function __resetPasteZones() {
  zones.clear();
  lastPointer = null;
}
