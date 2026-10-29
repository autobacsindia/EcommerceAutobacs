import type { ReactNode } from 'react';

/**
 * Message formatting, Google Chat style — written as plain characters, drawn
 * as React elements:
 *
 *   *bold*   _italic_   ~strike~   `code`   ```code block```
 *   - item  /  * item     → bulleted list
 *   1. item               → numbered list
 *
 * plus links and @mentions as before. Nothing here ever turns message text
 * into HTML: every piece becomes a React child, so `<script>` typed by a
 * colleague is shown as those characters and can never run.
 *
 * No regex lookbehind (older iPhone Safari throws on it at load, which would
 * take the whole chat down): "what comes before" is checked by hand.
 */

type Inline = 'code' | 'link' | 'mention' | 'bold' | 'italic' | 'strike';
interface Rule {
  kind: Inline;
  re: RegExp;
  /** The character before the match must not be one of these. */
  notAfter?: RegExp;
}

const MARK_RULES: Rule[] = [
  { kind: 'code', re: /`([^`\n]+)`/g },
  { kind: 'link', re: /https?:\/\/[^\s<>"']+/g },
  // mention: built per message (names differ)
  { kind: 'bold', re: /\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, notAfter: /[\w*]/ },
  { kind: 'italic', re: /_(?=\S)([^_\n]*?\S)_(?![\w_])/g, notAfter: /[\w_]/ },
  { kind: 'strike', re: /~(?=\S)([^~\n]*?\S)~(?![\w~])/g, notAfter: /[\w~]/ },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rulesFor(mentionNames: string[]): Rule[] {
  const names = mentionNames.filter(Boolean).map(escapeRe);
  if (!names.length) return MARK_RULES;
  // (?!\w): "@all" must not light up the start of "@allison".
  const mention: Rule = { kind: 'mention', re: new RegExp(`@(?:${names.join('|')})(?!\\w)`, 'g') };
  return [MARK_RULES[0], MARK_RULES[1], mention, ...MARK_RULES.slice(2)];
}

/** The earliest match of any rule at or after `from` (ties go to the earlier rule). */
function nextMatch(text: string, from: number, rules: Rule[]) {
  let best: { rule: Rule; m: RegExpExecArray } | null = null;
  for (const rule of rules) {
    rule.re.lastIndex = from;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const prev = m.index > 0 ? text[m.index - 1] : '';
      if (!rule.notAfter || !prev || !rule.notAfter.test(prev)) break;
      rule.re.lastIndex = m.index + 1;
    }
    if (m && (!best || m.index < best.m.index)) best = { rule, m };
  }
  return best;
}

interface Ctx {
  rules: Rule[];
  meName: string;
}

function inline(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let k = 0;
  while (at < text.length) {
    const hit = nextMatch(text, at, ctx.rules);
    if (!hit) break;
    const { rule, m } = hit;
    if (m.index > at) out.push(text.slice(at, m.index));
    const key = `${keyBase}-${k++}`;
    const whole = m[0];
    switch (rule.kind) {
      case 'code':
        out.push(<code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[13px] text-rose-700">{m[1]}</code>);
        break;
      case 'link': {
        // Sentence punctuation after a link is not part of it.
        const url = whole.replace(/[),.;:!?\]]+$/, '');
        out.push(
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-link underline">{url}</a>,
        );
        if (url.length < whole.length) out.push(whole.slice(url.length));
        break;
      }
      case 'mention': {
        const isMe = whole.slice(1) === ctx.meName || whole === '@all';
        out.push(
          <span key={key} className={`rounded px-1 font-semibold ${isMe ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
            {whole}
          </span>,
        );
        break;
      }
      case 'bold':
        out.push(<strong key={key} className="font-semibold">{inline(m[1], ctx, key)}</strong>);
        break;
      case 'italic':
        out.push(<em key={key}>{inline(m[1], ctx, key)}</em>);
        break;
      case 'strike':
        out.push(<s key={key}>{inline(m[1], ctx, key)}</s>);
        break;
    }
    at = m.index + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

function lines(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  const rows = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < rows.length) {
    const key = `${keyBase}-${k++}`;
    const list = BULLET.test(rows[i]) ? BULLET : NUMBERED.test(rows[i]) ? NUMBERED : null;
    if (list) {
      const items: string[] = [];
      while (i < rows.length && list.test(rows[i])) items.push(list.exec(rows[i])![1]), i += 1;
      const Tag = list === BULLET ? 'ul' : 'ol';
      out.push(
        <Tag key={key} className={`my-1 space-y-0.5 pl-5 ${list === BULLET ? 'list-disc' : 'list-decimal'}`}>
          {items.map((item, j) => <li key={j}>{inline(item, ctx, `${key}-${j}`)}</li>)}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < rows.length && !BULLET.test(rows[i]) && !NUMBERED.test(rows[i])) para.push(rows[i]), i += 1;
    out.push(<span key={key} className="block whitespace-pre-wrap">{inline(para.join('\n'), ctx, key)}</span>);
  }
  return out;
}

/** A whole message: code blocks first (nothing is formatted inside them), then lines. */
export function formatMessage(text: string, { mentionNames = [], meName = '' }: { mentionNames?: string[]; meName?: string } = {}): ReactNode[] {
  const ctx: Ctx = { rules: rulesFor(mentionNames), meName };
  const out: ReactNode[] = [];
  const fence = /```\n?([\s\S]*?)```/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = fence.exec(text))) {
    if (m.index > at) out.push(...lines(text.slice(at, m.index).replace(/\n$/, ''), ctx, `t${k}`));
    out.push(
      <pre key={`pre${k}`} className="my-1 overflow-x-auto whitespace-pre rounded-lg bg-gray-100 px-3 py-2 font-mono text-[13px] text-gray-800">
        <code>{m[1].replace(/\n$/, '')}</code>
      </pre>,
    );
    k += 1;
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(...lines(text.slice(at).replace(/^\n/, ''), ctx, `t${k}`));
  return out;
}
