'use client';

/**
 * The chat's left column, laid out as Google Chat's: a "New chat" button, a
 * search field, Shortcuts (Home, Mentions, Threads, Starred), then one section
 * per kind of chat — Direct messages, Spaces (groups of a few people
 * included), Between teams. Each
 * section folds and unfolds with its arrow, shows its unread count beside the
 * title, and keeps long lists short behind "Show all".
 *
 * Folded sections are remembered on this browser (a per-viewer convenience;
 * storage can be missing, so every read and write is guarded).
 */
import { useEffect, useState } from 'react';
import { AtSign, ChevronsUpDown, Play, House, Keyboard, MessageSquarePlus, MessagesSquare, Plus, Search, Star } from 'lucide-react';
import { notifyOf, type ChatChannel } from '@/hooks/queries/useTeamChat';
import { ChannelIcon, OnlineDot } from './chatUi';
import { channelTitle } from './QuickSwitcher';
import { NotifyIcon } from './NotifyMenu';
import { SECTIONS, peopleUnread, sectionRows, sectionsOf, type SectionKey } from './chatList';

const FOLDED_KEY = 'roavion-chat-folded';
type FoldKey = SectionKey | 'shortcuts';

function readFolded(): Set<FoldKey> {
  try {
    const raw = localStorage.getItem(FOLDED_KEY);
    return new Set(raw ? (JSON.parse(raw) as FoldKey[]) : []);
  } catch {
    return new Set();
  }
}
function saveFolded(s: Set<FoldKey>) {
  try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...s])); } catch { /* private window: not remembered */ }
}

const cap = (n: number) => (n > 99 ? '99+' : String(n));

export default function ChatSidebar({
  channels,
  selectedId,
  homeOn,
  online,
  canCreateSpace,
  onSelect,
  onHome,
  onNewChat,
  onNewSpace,
  onSearch,
  onMentions,
  onThreads,
  onStarred,
  onShortcuts,
  footer,
}: {
  channels: ChatChannel[];
  selectedId: string | null;
  /** Home is what the middle shows (no chat open on a small screen, or always on a wide one). */
  homeOn: boolean;
  online: Set<string>;
  canCreateSpace: boolean;
  onSelect: (id: string) => void;
  onHome: () => void;
  onNewChat: () => void;
  onNewSpace: () => void;
  onSearch: () => void;
  onMentions: () => void;
  onThreads: () => void;
  onStarred: () => void;
  onShortcuts: () => void;
  footer: React.ReactNode;
}) {
  const [folded, setFolded] = useState<Set<FoldKey>>(new Set());
  const [showAll, setShowAll] = useState<Set<SectionKey>>(new Set());
  useEffect(() => { setFolded(readFolded()); }, []);
  const toggleFold = (k: FoldKey) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    saveFolded(next);
    return next;
  });
  const sections = sectionsOf(channels);
  const homeUnread = channels.reduce((n, c) => n + peopleUnread(c), 0);

  /** A one-line row: small icon, name, and a blue dot / number when a person is waiting. */
  const item = (c: ChatChannel) => {
    const waiting = peopleUnread(c);
    const level = notifyOf(c);
    const active = c.id === selectedId;
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={active ? 'true' : undefined}
          className="gc-nav-item flex h-8 w-full items-center gap-3 rounded-full pl-4 pr-3 text-left text-sm"
        >
          <span className="relative inline-flex shrink-0">
            <ChannelIcon channel={c} size="xs" />
            {c.kind === 'dm' && !c.group && c.partner && online.has(c.partner.id) && <OnlineDot className="!h-2.5 !w-2.5" />}
          </span>
          <span className={`min-w-0 flex-1 truncate ${waiting ? 'font-bold text-gray-900' : 'text-gray-800'}`}>
            {c.kind === 'space' ? channelTitle(c).replace(/^#/, '') : channelTitle(c)}
          </span>
          {level !== 'all' && <NotifyIcon level={level} className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
          {waiting > 0 && (
            <span className="shrink-0 text-xs font-bold text-blue-700" aria-label={`${waiting} unread`}>{cap(waiting)}</span>
          )}
        </button>
      </li>
    );
  };

  /** A section header with its fold arrow, and a body that slides open and shut. */
  const section = (key: FoldKey, label: string, body: React.ReactNode, opts: { count?: number; action?: React.ReactNode; hint?: string } = {}) => {
    const open = !folded.has(key);
    const id = `gc-sec-${key}`;
    return (
      <div className="mt-1" key={key}>
        <div className="flex h-8 items-center pr-1">
          <button
            type="button"
            onClick={() => toggleFold(key)}
            aria-expanded={open}
            aria-controls={id}
            title={opts.hint}
            className="gc-nav-head flex h-8 min-w-0 flex-1 items-center gap-1 rounded-full pl-1.5 pr-3 text-left text-sm font-medium text-gray-900"
          >
            {/* A small solid triangle, as Google's: ▸ folded, ▾ open. */}
            <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
              <Play className={`gc-caret h-2 w-2 fill-current text-gray-700 ${open ? 'rotate-90' : ''}`} />
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {!!opts.count && (
              <span className="shrink-0 text-xs font-bold text-gray-900" aria-label={`${opts.count} unread in ${label}`}>{cap(opts.count)}</span>
            )}
          </button>
          {opts.action}
        </div>
        <div id={id} className="gc-fold" data-open={open} aria-hidden={!open} inert={!open || undefined}>
          <div className="min-h-0 overflow-hidden">{body}</div>
        </div>
      </div>
    );
  };

  const shortcut = (label: string, icon: React.ReactNode, onClick: () => void, opts: { current?: boolean; count?: number } = {}) => (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={opts.current ? 'page' : undefined}
        className="gc-nav-item flex h-8 w-full items-center gap-3 rounded-full pl-4 pr-3 text-left text-sm text-gray-800"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center text-gray-600">{icon}</span>
        <span className={`min-w-0 flex-1 truncate ${opts.count ? 'font-bold text-gray-900' : ''}`}>{label}</span>
        {!!opts.count && <span className="shrink-0 text-xs font-bold text-blue-700">{cap(opts.count)}</span>}
      </button>
    </li>
  );

  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-1 pt-3 lg:pt-2">
        <button
          type="button"
          onClick={onNewChat}
          className="gc-fab inline-flex h-14 items-center gap-3 rounded-2xl pl-4 pr-5 text-sm font-medium text-gray-900"
          aria-label="New chat"
          title="Start a chat with a person or a group"
        >
          <MessageSquarePlus className="h-5 w-5 text-gray-800" aria-hidden="true" />
          <span>New chat</span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onShortcuts}
          className="gc-icon-btn hidden h-10 w-10 place-items-center rounded-full text-gray-600 sm:grid"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div className="px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={onSearch}
          className="gc-field flex h-11 w-full items-center gap-3 rounded-full px-4 text-left text-sm text-gray-600 transition-colors hover:text-gray-900"
          aria-label="Search all messages"
          title="Search every message you can see"
        >
          <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Search messages</span>
        </button>
      </div>

      <div className="gc-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Chat sections">
        {section('shortcuts', 'Shortcuts', (
          <ul className="space-y-px">
            {shortcut('Home', <House className="h-[18px] w-[18px]" />, onHome, { current: homeOn && !selectedId, count: homeUnread })}
            {shortcut('Mentions', <AtSign className="h-[18px] w-[18px]" />, onMentions)}
            {shortcut('Threads', <MessagesSquare className="h-[18px] w-[18px]" />, onThreads)}
            {shortcut('Starred', <Star className="h-[18px] w-[18px]" />, onStarred)}
          </ul>
        ), { hint: 'Home, mentions, threads and starred messages' })}

        {SECTIONS.map(({ key, label, hint }) => {
          const list = sections[key];
          const all = showAll.has(key);
          const { rows, hidden } = sectionRows(list, { all, selectedId });
          const count = list.reduce((n, c) => n + peopleUnread(c), 0);
          const action = key === 'dms' ? (
            <button type="button" onClick={onNewChat} className="gc-icon-btn grid h-7 w-7 place-items-center rounded-full text-gray-600" aria-label="Start a direct message" title="Start a direct message">
              <Plus className="h-4 w-4" />
            </button>
          ) : key === 'spaces' && canCreateSpace ? (
            <button type="button" onClick={onNewSpace} className="gc-icon-btn grid h-7 w-7 place-items-center rounded-full text-gray-600" aria-label="New space" title="Create a space for a group or topic">
              <Plus className="h-4 w-4" />
            </button>
          ) : undefined;
          return section(key, label, (
            <>
              <ul className="space-y-px" aria-label={label}>
                {rows.map(item)}
                {!list.length && (
                  <li className="py-1 pl-11 pr-3 text-[13px] text-gray-500">
                    {key === 'dms' ? 'Use “New chat” to message someone.' : key === 'spaces' ? 'Use “New chat” and pick a few people, or create a space.' : 'Nothing here yet.'}
                  </li>
                )}
              </ul>
              {(hidden > 0 || all) && (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                  className="gc-nav-item flex h-8 w-full items-center gap-3 rounded-full pl-4 pr-3 text-left text-sm text-gray-700"
                >
                  <ChevronsUpDown className="h-[18px] w-6 shrink-0 text-gray-600" aria-hidden="true" />
                  {all ? 'Show fewer' : `Show all (${list.length})`}
                </button>
              )}
            </>
          ), { count, action, hint });
        })}
      </div>

      {footer}
    </>
  );
}
