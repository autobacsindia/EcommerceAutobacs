'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { formatDuration } from '@/lib/calls/callState';
import type { CallPeer } from '@/lib/calls/callState';
import { useCalls } from './CallProvider';

/**
 * Everything a call shows on screen, on any panel page:
 *  - the ringing card (someone is calling you),
 *  - the call screen (full screen, or minimised to a corner bubble so the chat stays usable),
 *  - "You're in a call — Rejoin" after a reload,
 *  - a short note when a call ends.
 */

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

function PeerFace({ peer, size }: { peer: CallPeer | null; size: 'lg' | 'md' | 'sm' }) {
  const px = size === 'lg' ? 'h-24 w-24 text-3xl' : size === 'md' ? 'h-14 w-14 text-xl' : 'h-10 w-10 text-sm';
  if (peer?.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a small staff photo; next/image needs a known host
    return <img src={peer.avatarUrl} alt="" className={`${px} rounded-full object-cover`} />;
  }
  return <span className={`${px} grid place-items-center rounded-full bg-blue-700 font-semibold text-white`} aria-hidden="true">{initials(peer?.name || '')}</span>;
}

function StreamVideo({ stream, muted, mirror, className }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${className ?? ''} ${mirror ? '-scale-x-100' : ''}`} />;
}

/** True once the stream carries live video (the other side may be voice-only, or have the camera off). */
function useHasVideo(stream: MediaStream | null) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!stream) { setHas(false); return; }
    const check = () => setHas(stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
    check();
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => { t.addEventListener('mute', check); t.addEventListener('unmute', check); t.addEventListener('ended', check); });
    stream.addEventListener('addtrack', check);
    stream.addEventListener('removetrack', check);
    const poll = setInterval(check, 2000);
    return () => {
      clearInterval(poll);
      tracks.forEach((t) => { t.removeEventListener('mute', check); t.removeEventListener('unmute', check); t.removeEventListener('ended', check); });
      stream.removeEventListener('addtrack', check);
      stream.removeEventListener('removetrack', check);
    };
  }, [stream]);
  return has;
}

function useElapsed(since: string | null | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return since ? (now - new Date(since).getTime()) / 1000 : 0;
}

function RoundButton({ label, onClick, active, danger, children }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-12 w-12 place-items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        danger ? 'bg-red-600 text-white hover:bg-red-700' : active ? 'bg-white text-gray-900' : 'bg-white/15 text-white hover:bg-white/25'
      }`}
    >
      {children}
    </button>
  );
}

export default function CallOverlay() {
  const calls = useCalls();
  const state = calls?.state;
  const phase = state?.phase ?? 'idle';
  const connected = phase === 'connected' || phase === 'reconnecting';
  const elapsed = useElapsed(state?.call?.answeredAt, connected);
  const remoteHasVideo = useHasVideo(calls?.remoteStream ?? null);
  const localHasVideo = !!calls?.localStream?.getVideoTracks().length && !calls?.cameraOff;
  if (!calls || !state || phase === 'idle') return null;
  const { peer, call } = state;
  const name = peer?.name || 'Your colleague';
  const kind = call?.media === 'audio' ? 'Voice call' : 'Video call';

  if (phase === 'incoming') {
    return (
      <div role="alertdialog" aria-label={`${name} is calling`} className="fixed right-4 top-4 z-[70] w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-gray-900 p-4 text-white shadow-2xl">
        <div className="flex items-center gap-3">
          <PeerFace peer={peer} size="md" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{name}</p>
            <p className="text-sm text-gray-300">{kind} · calling you…</p>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={() => void calls.decline()} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-red-600 py-2.5 text-sm font-semibold hover:bg-red-700">
            <PhoneOff className="h-4 w-4" aria-hidden="true" /> Decline
          </button>
          <button type="button" onClick={() => void calls.answer()} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 py-2.5 text-sm font-semibold hover:bg-emerald-700" autoFocus>
            {call?.media === 'audio' ? <Phone className="h-4 w-4" aria-hidden="true" /> : <Video className="h-4 w-4" aria-hidden="true" />} Answer
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'rejoin') {
    return (
      <div role="status" className="fixed inset-x-4 top-4 z-[70] mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-2xl bg-emerald-700 px-4 py-3 text-white shadow-xl">
        <Phone className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium">You&apos;re in a call with {name}</p>
        <button type="button" onClick={() => void calls.hangUp()} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">End call</button>
        <button type="button" onClick={() => void calls.rejoin()} className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Rejoin</button>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div role="status" className="fixed inset-x-4 bottom-6 z-[70] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-white shadow-xl">
        <PhoneOff className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">{state.notice || 'Call ended'}</p>
        <button type="button" onClick={calls.dismiss} className="text-sm font-semibold text-gray-300 hover:text-white">OK</button>
      </div>
    );
  }

  const status = phase === 'outgoing' ? 'Ringing…'
    : phase === 'connecting' ? 'Connecting…'
      : phase === 'reconnecting' ? 'Reconnecting…'
        : formatDuration(elapsed);

  const controls = (
    <div className="flex items-center justify-center gap-3">
      <RoundButton label={calls.muted ? 'Unmute' : 'Mute'} onClick={calls.toggleMute} active={calls.muted}>
        {calls.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </RoundButton>
      {call?.media === 'video' && !!calls.localStream?.getVideoTracks().length && (
        <RoundButton label={calls.cameraOff ? 'Turn camera on' : 'Turn camera off'} onClick={calls.toggleCamera} active={calls.cameraOff}>
          {calls.cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </RoundButton>
      )}
      {call?.media === 'video' && calls.canShare && connected && (
        <span className="hidden sm:inline-flex">
          <RoundButton label={calls.sharing ? 'Stop sharing your screen' : 'Share your screen'} onClick={() => void calls.toggleShare()} active={calls.sharing}>
            <MonitorUp className="h-5 w-5" />
          </RoundButton>
        </span>
      )}
      <RoundButton label="End call" onClick={() => void calls.hangUp()} danger>
        <PhoneOff className="h-5 w-5" />
      </RoundButton>
    </div>
  );

  // Remote audio always plays through a hidden element, so a voice call (or a
  // camera-off moment) is still heard.
  const remoteAudio = <StreamVideo stream={calls.remoteStream} className="hidden" />;

  if (state.minimised) {
    return (
      <div role="region" aria-label={`Call with ${name}`} className="fixed bottom-4 right-4 z-[70] w-60 overflow-hidden rounded-2xl bg-gray-900 text-white shadow-2xl">
        <div className="relative aspect-video bg-gray-800">
          {remoteHasVideo
            ? <StreamVideo stream={calls.remoteStream} muted className="h-full w-full object-cover" />
            : <div className="grid h-full place-items-center"><PeerFace peer={peer} size="sm" /></div>}
          {remoteAudio}
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-xs text-gray-300">{status}</p>
          </div>
          <button type="button" onClick={() => calls.minimise(false)} aria-label="Open the call full screen" title="Full screen" className="rounded-full p-2 hover:bg-white/15">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => void calls.hangUp()} aria-label="End call" title="End call" className="rounded-full bg-red-600 p-2 hover:bg-red-700">
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`${kind} with ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-gray-950 text-white">
      <header className="flex items-center gap-3 px-4 pb-2" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="text-sm text-gray-300" aria-live="polite">{status}</p>
        </div>
        <button type="button" onClick={() => calls.minimise(true)} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
          <Minimize2 className="h-4 w-4" aria-hidden="true" /> Back to chat
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        {remoteHasVideo ? (
          <StreamVideo stream={calls.remoteStream} muted className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3">
              <PeerFace peer={peer} size="lg" />
              <p className="text-lg font-semibold">{name}</p>
              {connected && call?.media === 'video' && <p className="text-sm text-gray-400">Camera is off</p>}
            </div>
          </div>
        )}
        {remoteAudio}
        {localHasVideo && (
          <div className="absolute bottom-4 right-4 w-28 overflow-hidden rounded-xl border border-white/20 bg-gray-800 shadow-lg sm:w-44">
            <StreamVideo stream={calls.localStream} muted mirror={!calls.sharing} className="aspect-[3/4] w-full object-cover sm:aspect-video" />
          </div>
        )}
      </div>
      <footer className="px-4 pt-3" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>{controls}</footer>
    </div>
  );
}
