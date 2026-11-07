'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Put `text` on the clipboard. The async Clipboard API needs a secure context
 * (https or localhost) and can be refused by the browser; the hidden-textarea
 * `execCommand('copy')` route covers older browsers and plain-http pages.
 * Resolves true when either worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permissions, unfocused document) — fall through to the old way.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Off-screen and fixed, so selecting it neither scrolls the page nor flashes.
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
}

const COPIED_MS = 1500;

/** "Order number" → "order number"; acronyms stay as they are ("SKU", "ID", "Payment ID" → "payment ID"). */
const asNoun = (label: string) => (/^[A-Z0-9]+$/.test(label.split(' ')[0]) ? label : label.charAt(0).toLowerCase() + label.slice(1));

/**
 * A small copy icon for an ID shown on screen (order number, SKU, …). One click
 * (or Enter / Space) copies `value` and shows a short "Copied" toast; the icon
 * turns into a tick for a moment. `label` names what is copied, for the
 * screen-reader label and the toast ("Order number", "SKU").
 *
 * Clicks and keys do not reach the parent, so it can sit in a clickable row or
 * card without opening it. It renders a <button>: never put it inside another
 * button or a link.
 */
export default function CopyId({ value, label = 'ID', className = '' }: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const noun = asNoun(label);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(value);
    if (!ok) {
      toast.error(`Couldn't copy — select the ${noun} and copy it by hand.`, { id: 'copy-id' });
      return;
    }
    // One toast at a time (same id), however fast the clicks.
    toast.success(`Copied ${noun} ${value}`, { id: 'copy-id', duration: COPIED_MS });
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  // Enter / Space already click a button; keep them from also reaching a row's own handler.
  const stopKeys = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };

  if (!value) return null;
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      onKeyDown={stopKeys}
      aria-label={`Copy ${noun} ${value}`}
      title={copied ? 'Copied' : `Copy ${noun}`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md align-middle text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-6 sm:w-6 ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${copied ? 'text-green-600' : ''}`} aria-hidden />
    </button>
  );
}
