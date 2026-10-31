'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { countedUnread, liveStatus } from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatPerson } from '@/hooks/queries/useTeamChat';
import { Kbd } from '@/components/panel/shortcuts';
import { Avatar, ChannelIcon } from './chatUi';

/** How a conversation is written in lists: #space, a team's name, a person. */
export const channelTitle = (c: ChatChannel) => (c.kind === 'dm' || c.audience === 'teams' ? c.name : `#${c.name}`);

type Option =
  | { kind: 'channel'; channel: ChatChannel }
  | { kind: 'person'; person: ChatPerson };

const MAX_PEOPLE = 6;

/**
 * "Jump to…" (Ctrl/⌘+K), as in Google Chat and Slack: type a few letters of a
 * space, team or person and press Enter. With nothing typed it lists what is
 * waiting — unread first, then the most recently active.
 *
 * People with no conversation yet are offered too; picking one opens a direct
 * message, through the same server call as "New chat".
 */
export default function QuickSwitcher({
  channels,
  people,
  meId,
  onPickChannel,
  onPickPerson,
  onClose,
}: {
  channels: ChatChannel[];
  people: ChatPerson[];
  meId: string;
  onPickChannel: (id: string) => void;
  onPickPerson: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLowerCase();
    const loud = (c: ChatChannel) => { const u = countedUnread(c); return u.chat + u.updates; };
    const when = (c: ChatChannel) => new Date(c.lastMessageAt || 0).getTime();
    const matching = channels
      .filter((c) => !term || c.name.toLowerCase().includes(term) || (c.description || '').toLowerCase().includes(term))
      // A name that STARTS with what was typed beats one that merely contains it.
      .sort((a, b) => {
        if (term) {
          const sa = a.name.toLowerCase().startsWith(term) ? 0 : 1;
          const sb = b.name.toLowerCase().startsWith(term) ? 0 : 1;
          if (sa !== sb) return sa - sb;
        }
        return (loud(b) > 0 ? 1 : 0) - (loud(a) > 0 ? 1 : 0) || when(b) - when(a);
      })
      .slice(0, 12)
      .map((channel) => ({ kind: 'channel' as const, channel }));
    if (!term) return matching;
    // People you have no one-to-one conversation with yet.
    const withDm = new Set(channels.filter((c) => c.kind === 'dm' && !c.group && c.partner).map((c) => c.partner!.id));
    const extra = people
      .filter((p) => p.id !== meId && !withDm.has(p.id) && p.name.toLowerCase().includes(term))
      .slice(0, MAX_PEOPLE)
      .map((person) => ({ kind: 'person' as const, person }));
    return [...matching, ...extra];
  }, [q, channels, people, meId]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const pick = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'channel') onPickChannel(o.channel.id);
    else onPickPerson(o.person.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const firstPerson = options.findIndex((o) => o.kind === 'person');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Jump to a conversation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="pn-pop relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-gray-100 px-4">
          <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a space, team or person"
            aria-label="Jump to a space, team or person"
            role="combobox"
            aria-expanded="true"
            aria-controls="chat-switcher-list"
            aria-activedescendant={options[active] ? `chat-switcher-${active}` : undefined}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={list} id="chat-switcher-list" role="listbox" aria-label="Conversations" className="max-h-[50vh] overflow-y-auto p-2">
          {!q.trim() && <li className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500" role="presentation">Recent</li>}
          {options.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No space, team or person called “{q.trim()}”.</li>}
          {options.map((o, i) => {
            const selected = i === active;
            const unread = o.kind === 'channel' ? (() => { const u = countedUnread(o.channel); return u.chat + u.updates; })() : 0;
            return (
              <li key={o.kind === 'channel' ? o.channel.id : `p-${o.person.id}`} role="presentation">
                {i === firstPerson && (
                  <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Start a chat with</p>
                )}
                <button
                  type="button"
                  id={`chat-switcher-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${selected ? 'bg-blue-50 text-blue-900' : 'text-gray-800'}`}
                >
                  {o.kind === 'channel' ? <ChannelIcon channel={o.channel} /> : <Avatar person={o.person} size="sm" />}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${unread ? 'font-bold' : 'font-medium'}`}>
                      {o.kind === 'channel' ? channelTitle(o.channel) : o.person.name}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {o.kind === 'channel'
                        ? o.channel.description || (o.channel.kind === 'dm' ? 'Direct message' : '')
                        : [o.person.teamLabel, liveStatus(o.person.status)?.text].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="min-w-[22px] rounded-full bg-blue-600 px-1.5 text-center text-xs font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>
                  )}
                  {selected && <span className="hidden text-xs text-gray-500 sm:inline">Enter ↵</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="flex items-center gap-3 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> to open</span>
        </p>
      </div>
    </div>
  );
}
