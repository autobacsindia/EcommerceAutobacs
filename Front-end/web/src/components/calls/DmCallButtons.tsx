'use client';

import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, Video } from 'lucide-react';
import { formatDuration } from '@/lib/calls/callState';
import type { ChatMessage } from '@/hooks/queries/useTeamChat';
import { useCalls } from './CallProvider';

/** Voice and video call buttons in a one-to-one chat's header. */
export default function DmCallButtons({ channelId, name }: { channelId: string; name: string }) {
  const calls = useCalls();
  if (!calls?.ready) return null;
  const disabled = calls.busy;
  const cls = 'rounded-full p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <>
      <button type="button" className={cls} disabled={disabled} onClick={() => void calls.start(channelId, 'audio')}
        aria-label={`Voice call ${name}`} title={disabled ? 'You are already in a call' : `Voice call ${name}`}>
        <Phone className="h-4 w-4" />
      </button>
      <button type="button" className={cls} disabled={disabled} onClick={() => void calls.start(channelId, 'video')}
        aria-label={`Video call ${name}`} title={disabled ? 'You are already in a call' : `Video call ${name}`}>
        <Video className="h-4 w-4" />
      </button>
    </>
  );
}

/** The line a call leaves in the chat: "Missed video call · Call back". */
export function CallLine({ m, meId }: { m: ChatMessage; meId: string }) {
  const calls = useCalls();
  const call = m.call;
  if (!call) return null;
  const iCalled = m.sender?.id === meId;
  const unanswered = call.outcome === 'missed' || call.outcome === 'cancelled' || call.outcome === 'declined';
  const label = call.outcome === 'completed' || call.outcome === 'failed'
    ? `${call.media === 'audio' ? 'Voice' : 'Video'} call`
    : call.outcome === 'declined'
      ? (iCalled ? `${call.media === 'audio' ? 'Voice' : 'Video'} call · declined` : `Declined ${call.media === 'audio' ? 'voice' : 'video'} call`)
      : (iCalled ? `${call.media === 'audio' ? 'Voice' : 'Video'} call · no answer` : `Missed ${call.media === 'audio' ? 'voice' : 'video'} call`);
  const Icon = unanswered && !iCalled ? PhoneMissed : call.outcome === 'failed' ? PhoneOff : iCalled ? Phone : PhoneIncoming;
  const red = unanswered && !iCalled;
  return (
    <div className={`mt-0.5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${red ? 'border-red-200 bg-red-50 text-red-800' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">{label}</span>
      {call.durationSec > 0 && <span className="text-gray-500">· {formatDuration(call.durationSec)}</span>}
      {calls?.ready && !calls.busy && (
        <button type="button" onClick={() => void calls.start(m.channelId, call.media)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${red ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-blue-700 ring-1 ring-gray-200 hover:bg-blue-50'}`}>
          Call back
        </button>
      )}
    </div>
  );
}
