'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, Phone } from 'lucide-react';
import { useSetMeet } from '@/hooks/queries/useTeamChat';
import { MEET_URL } from './meet';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { Dialog } from './chatUi';

/** Where Google makes a fresh meeting for whoever opens it (their own Workspace account). */
export const NEW_MEET = 'https://meet.google.com/new';

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

/**
 * "📞 Call" — calls happen in Google Meet; chat carries the link.
 *   - The conversation has a saved Meet link: one tap opens it and posts
 *     "📞 Started a call" with the link, so everyone gets the usual pop-up.
 *   - It has none: start a new Meet in a new tab, paste its link back here to
 *     share it — and, where allowed, keep it as the conversation's call link.
 */
export default function CallButton({
  channel,
  onShare,
}: {
  channel: ChatChannel;
  /** Post the call message in this conversation. */
  onShare: (text: string) => void;
}) {
  const [setting, setSetting] = useState(false);
  const call = () => {
    if (channel.meetUrl) {
      open(channel.meetUrl);
      onShare(`📞 Started a call — join here: ${channel.meetUrl}`);
    } else {
      setSetting(true);
    }
  };

  return (
    <>
      <span className="inline-flex items-center">
        <button type="button" onClick={call} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
          aria-label="Start a call (Google Meet)" title={channel.meetUrl ? 'Start a call in Google Meet' : 'Start a Google Meet call'}>
          <Phone className="h-4 w-4" />
        </button>
        {channel.meetUrl && channel.canSetMeet && (
          <button type="button" onClick={() => setSetting(true)} className="-ml-1 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Call link settings" title="Change the call link">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      {setting && <CallDialog channel={channel} onShare={onShare} onClose={() => setSetting(false)} />}
    </>
  );
}

export function CallDialog({ channel, onShare, onClose }: { channel: ChatChannel; onShare: (text: string) => void; onClose: () => void }) {
  const save = useSetMeet();
  const [url, setUrl] = useState(channel.meetUrl ?? '');
  const [keep, setKeep] = useState(!!channel.canSetMeet && !channel.meetUrl);
  const clean = url.trim();
  const valid = MEET_URL.test(clean);

  const share = async () => {
    if (!valid) return;
    if (keep && channel.canSetMeet && clean !== channel.meetUrl) await save.mutateAsync({ channelId: channel.id, url: clean });
    onShare(`📞 Started a call — join here: ${clean}`);
    onClose();
  };

  return (
    <Dialog title="Google Meet call" onClose={onClose}>
      <ol className="space-y-3 text-sm text-gray-700">
        <li>
          <span className="font-semibold">1.</span> Start a new meeting — it opens in a new tab.
          <button type="button" onClick={() => open(NEW_MEET)}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:border-emerald-600">
            <ExternalLink className="h-4 w-4" /> New Google Meet
          </button>
        </li>
        <li>
          <span className="font-semibold">2.</span> Copy its link from Meet and paste it here:
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij"
            aria-label="Meet link" inputMode="url"
            className="mt-1.5 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600" />
          {clean && !valid && <span role="alert" className="mt-1 block text-xs text-red-600">That isn’t a Google Meet link (it looks like meet.google.com/abc-defg-hij).</span>}
        </li>
      </ol>
      {channel.canSetMeet && (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Keep this as the call link here — next time, 📞 is one tap
        </label>
      )}
      {save.isError && <p role="alert" className="mt-2 text-sm text-red-600">Couldn’t save the call link.</p>}
      <div className="mt-4 flex items-center justify-between">
        {channel.meetUrl && channel.canSetMeet ? (
          <button type="button" onClick={() => void save.mutateAsync({ channelId: channel.id, url: null }).then(onClose).catch(() => {})}
            className="text-sm font-medium text-red-700 hover:underline">
            Remove saved link
          </button>
        ) : <span />}
        <button type="button" onClick={() => void share().catch(() => {})} disabled={!valid || save.isPending}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          Share in chat
        </button>
      </div>
    </Dialog>
  );
}
