'use client';

/**
 * Shows a value from a <RichTextBox>: formatted HTML (cleaned again here) or
 * old plain text (as text, line breaks kept — never parsed as HTML).
 *
 *   <RichText value={task.description} />
 *   <RichText value={c.text} highlight={names} plain={(s) => <Linkified text={s} />} />
 */

import { useMemo, type ReactNode } from 'react';
import { isRichText, sanitizeRichHtml } from '@/lib/richText';
import './richText.css';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wrap "@Name" in text (never inside tags or links) with a highlight span. */
export function highlightMentions(html: string, names: string[]): string {
  if (!names.length) return html;
  const re = new RegExp(`@(?:${[...names].sort((a, b) => b.length - a.length).map((n) => escapeRe(escapeHtml(n))).join('|')})`, 'g');
  let inLink = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) {
      if (/^<a\b/i.test(part)) inLink += 1;
      else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink - 1);
      return part;
    }
    return inLink ? part : part.replace(re, (m) => `<span class="rt-mention">${m}</span>`);
  }).join('');
}

export interface RichTextProps {
  value: string | null | undefined;
  className?: string;
  /** "@Name"s to highlight in formatted text. */
  highlight?: string[];
  /** How to show old plain text; defaults to the text with its line breaks. */
  plain?: (text: string) => ReactNode;
  /** Shown when there are no words. */
  empty?: ReactNode;
}

export default function RichText({ value, className = '', highlight, plain, empty = null }: RichTextProps) {
  const v = value ?? '';
  const rich = isRichText(v);
  const html = useMemo(() => (rich ? highlightMentions(sanitizeRichHtml(v), highlight ?? []) : ''), [rich, v, highlight]);
  if (!v.trim()) return <>{empty}</>;
  if (!rich) return <div className={`whitespace-pre-wrap break-words ${className}`}>{plain ? plain(v) : v}</div>;
  // Cleaned by sanitizeRichHtml (allow-list) above, and on the server when saved.
  return <div className={`rt break-words ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
