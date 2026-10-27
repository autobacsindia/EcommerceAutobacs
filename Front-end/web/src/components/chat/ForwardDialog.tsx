'use client';

import { useMemo, useRef, useState } from 'react';
import { useChatChannels, useForwardMessage } from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage } from '@/hooks/queries/useTeamChat';
import { ChannelIcon, Dialog, newClientId } from './chatUi';

const labelOf = (c: ChatChannel) => (c.kind === 'dm' || c.audience === 'teams' ? c.name : `#${c.name}`);

/**
 * Forward a copy of a message into another conversation you are in. Only your
 * own conversations are offered, and the server checks again. One clientId per
 * dialog, so a double tap or a retry is one forward.
 */
export default function ForwardDialog({
  message,
  onClose,
  onDone,
}: {
  message: ChatMessage;
  onClose: () => void;
  /** Forwarded: where to, so the caller can offer to open it. */
  onDone: (channel: ChatChannel) => void;
}) {
  const { data: channels = [] } = useChatChannels();
  const forward = useForwardMessage();
  const [q, setQ] = useState('');
  const clientId = useRef(newClientId()).current;
  const shown = useMemo(
    () => channels.filter((c) => labelOf(c).toLowerCase().includes(q.trim().toLowerCase())),
    [channels, q],
  );
  const preview = message.text || (message.attachments.length ? '📎 Shared a file' : '');

  const send = async (c: ChatChannel) => {
    if (forward.isPending) return;
    await forward.mutateAsync({ id: message.id, channelId: c.id, clientId });
    onDone(c);
  };

  return (
    <Dialog title="Forward message" onClose={onClose}>
      <p className="mb-3 line-clamp-3 rounded-lg border-l-4 border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">{preview}</p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a space, group or person"
        aria-label="Find a conversation"
        autoFocus
        className="mb-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600"
      />
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200" aria-label="Conversations">
        {shown.length === 0 && <li className="p-3 text-sm text-gray-500">No conversation found</li>}
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={forward.isPending}
              onClick={() => void send(c).catch(() => {})}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
            >
              <ChannelIcon channel={c} />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{labelOf(c)}</span>
            </button>
          </li>
        ))}
      </ul>
      {forward.isPending && <p className="mt-2 text-sm text-gray-500">Forwarding…</p>}
      {forward.isError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {forward.error instanceof Error && forward.error.message ? forward.error.message : 'Couldn’t forward it. Please try again.'}
        </p>
      )}
    </Dialog>
  );
}
