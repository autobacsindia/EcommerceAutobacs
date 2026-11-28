'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import apiClient from '@/lib/api';
import { useChatStream } from '@/hooks/useChatStream';
import { useCanChat, useChatMe } from '@/hooks/queries/useTeamChat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { chatKeys } from '@/hooks/queries/keys';
import type { CallEngine, SignalKind } from '@/lib/calls/callEngine';
import { IDLE, NEVER_CONNECTED_NOTICE, callReducer, tabDeviceId } from '@/lib/calls/callState';
import type { CallMedia, CallPeer, CallUiState, ServerCall } from '@/lib/calls/callState';
import { startRingtone, stopRingtone } from '@/lib/calls/ringtone';
import dynamic from 'next/dynamic';

/*
 * The call screen and the WebRTC engine load only when a call happens: the
 * provider itself (listening for a ring) sits on every panel page, the rest of
 * the call code need not. Both are prefetched once the page is idle, so a ring
 * still shows at once.
 */
const loadOverlay = () => import('./CallOverlay');
const loadEngine = () => import('@/lib/calls/callEngine');
const CallOverlay = dynamic(loadOverlay, { ssr: false });

/**
 * Person-to-person calls for the staff panel (one-to-one chats only).
 *
 * Lives in the panel layout, so a call rings on any panel page and survives
 * moving between pages. The server (services/chatCallService.js) owns the call;
 * this follows its events on the team-chat live stream, runs the WebRTC
 * connection (lib/calls/callEngine.ts) and keeps the camera and microphone.
 */

interface StartResponse { call: ServerCall; iceServers: RTCIceServer[]; joined?: boolean }
interface LiveResponse { call: ServerCall | null; peer?: { id: string; name: string } | null; iceServers: RTCIceServer[] }

export interface CallApi {
  state: CallUiState;
  /** False until we know who I am, or outside team chat. */
  ready: boolean;
  busy: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  sharing: boolean;
  canShare: boolean;
  start: (channelId: string, media: CallMedia) => Promise<void>;
  answer: () => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => Promise<void>;
  rejoin: () => Promise<void>;
  dismiss: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleShare: () => Promise<void>;
  minimise: (on: boolean) => void;
}

const CallContext = createContext<CallApi | null>(null);

/** The call controls, or null outside a panel (then nothing offers a call). */
export function useCalls(): CallApi | null {
  return useContext(CallContext);
}

const post = <T,>(path: string, body: unknown = {}, keepalive = false) =>
  apiClient.post<T>(`/chat${path}`, body, { retries: 0, background: true, ...(keepalive ? { keepalive: true } : {}) });

const IN_CALL = new Set(['outgoing', 'connecting', 'connected', 'reconnecting']);

/** Camera and microphone. Falls back to voice only when there is no camera. */
async function getMedia(media: CallMedia): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot make calls. Try Chrome or Edge.');
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio,
      video: media === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (media === 'video' && (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError')) {
      return navigator.mediaDevices.getUserMedia({ audio, video: false });
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Allow the microphone (and camera) for this site in your browser, then try again.');
    }
    if (name === 'NotFoundError') throw new Error('No microphone found on this device.');
    throw new Error('Could not start your microphone or camera.');
  }
}

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());
const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function CallProvider({ children }: { children: ReactNode }) {
  const canChat = useCanChat();
  const meId = useChatMe().data?.userId ?? '';
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(callReducer, IDLE);
  const [localStream, setLocal] = useState<MediaStream | null>(null);
  const [remoteStream, setRemote] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);

  const deviceRef = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const engineRef = useRef<CallEngine | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const pendingRef = useRef<{ callId: string; kind: SignalKind; data: unknown }[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every connect and every teardown: a connect whose engine code was
  // still loading when the call ended (or reconnected) must not start an engine.
  const connectGen = useRef(0);
  // Set while a start / answer / rejoin is in flight. The phase only changes after
  // the camera prompt and the request, so without this a second tap (an impatient
  // double-click on Answer during the permission prompt) runs the action again:
  // a second answer is refused (409) and its clean-up tore down the first one's
  // connection, leaving the caller on "Connecting…" for good.
  const acting = useRef(false);
  // Why the call ended, when this tab knows better than the server's end reason.
  const endNoticeRef = useRef<string | null>(null);

  useEffect(() => { deviceRef.current = tabDeviceId(); }, []);

  const peerFor = useCallback((channelId: string, peerId: string, name?: string): CallPeer => {
    const ch = qc.getQueryData<ChatChannel[]>(chatKeys.channels())?.find((c) => c.id === channelId);
    const partner = ch?.partner;
    return { id: peerId, name: name || partner?.name || 'Your colleague', avatarUrl: partner?.avatarUrl };
  }, [qc]);

  const releaseMedia = useCallback(() => {
    connectGen.current += 1;
    engineRef.current?.close();
    engineRef.current = null;
    screenRef.current?.stop();
    screenRef.current = null;
    stopStream(localRef.current);
    localRef.current = null;
    pendingRef.current = [];
    stopRingtone();
    setLocal(null);
    setRemote(null);
    setMuted(false);
    setCameraOff(false);
    setSharing(false);
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => dispatch({ type: 'reset' }), 3500);
  }, []);

  const finish = useCallback((call: ServerCall) => {
    releaseMedia();
    dispatch({ type: 'ended', call, meId, notice: endNoticeRef.current ?? undefined });
    endNoticeRef.current = null;
    scheduleReset();
  }, [meId, releaseMedia, scheduleReset]);

  const hangUpRef = useRef<() => Promise<void>>(async () => {});

  const connect = useCallback(async (call: ServerCall) => {
    if (!localRef.current) return;
    engineRef.current?.close();
    engineRef.current = null; // signals queue in pendingRef until the new engine exists
    setRemote(null);
    const callId = call.id;
    const gen = ++connectGen.current;
    const { CallEngine: Engine } = await loadEngine();
    // The call ended, or a newer connect started, while the code loaded.
    if (gen !== connectGen.current || !localRef.current) return;
    const engine = new Engine({
      iceServers: iceRef.current,
      initiator: call.callerId === meId,
      localStream: localRef.current,
      sendSignal: async (kind, data) => {
        await post(`/calls/${callId}/signal`, { deviceId: deviceRef.current, kind, data });
      },
      onRemoteStream: (s) => setRemote(s),
      onState: (s) => {
        if (s === 'failed') {
          const never = !engine.everConnected;
          if (never) endNoticeRef.current = NEVER_CONNECTED_NOTICE;
          Sentry.captureMessage(never ? 'Team chat call never connected' : 'Team chat call lost its connection', {
            level: 'warning', tags: { feature: 'chat-call', relay: iceRef.current.some((s2) => String(s2.urls).includes('turn:')) ? 'yes' : 'no' },
          });
          void hangUpRef.current();
        } else if (s !== 'closed') {
          dispatch({ type: 'engine', state: s });
        }
      },
      onStats: (sum) => Sentry.addBreadcrumb({ category: 'chat-call', message: `connected ${sum.route}`, data: sum }),
    });
    engineRef.current = engine;
    // Signals that arrived before this connection existed.
    const waiting = pendingRef.current.filter((p) => p.callId === callId);
    pendingRef.current = [];
    for (const p of waiting) void engine.handleSignal(p.kind, p.data).catch((err) => console.warn('[call] signal', err));
  }, [meId]);

  const takeMedia = useCallback(async (media: CallMedia) => {
    const stream = await getMedia(media);
    localRef.current = stream;
    setLocal(stream);
    return stream;
  }, []);

  // ── actions ────────────────────────────────────────────────────────────────

  const start = useCallback(async (channelId: string, media: CallMedia) => {
    if (!meId || acting.current || IN_CALL.has(stateRef.current.phase) || stateRef.current.phase === 'incoming') return;
    acting.current = true;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await takeMedia(media);
      const res = await post<StartResponse>(`/channels/${channelId}/calls`, { media, deviceId: deviceRef.current });
      iceRef.current = res.iceServers || [];
      const peerId = res.call.callerId === meId ? res.call.calleeId : res.call.callerId;
      const peer = peerFor(channelId, peerId);
      dispatch({ type: 'outgoing', call: res.call, peer });
      if (res.call.status === 'active') {
        // They were calling me at the same moment: we're connected now.
        dispatch({ type: 'joined', call: res.call });
        connect(res.call);
      } else {
        startRingtone('outgoing');
      }
    } catch (err) {
      releaseMedia();
      dispatch({ type: 'error', notice: messageOf(err, 'Could not start the call') });
      scheduleReset();
    } finally {
      acting.current = false;
    }
  }, [meId, takeMedia, peerFor, connect, releaseMedia, scheduleReset]);

  const answer = useCallback(async () => {
    const { call } = stateRef.current;
    if (!call || acting.current || stateRef.current.phase !== 'incoming') return;
    acting.current = true;
    stopRingtone();
    try {
      await takeMedia(call.media);
      const res = await post<StartResponse>(`/calls/${call.id}/answer`, { deviceId: deviceRef.current });
      iceRef.current = res.iceServers || [];
      dispatch({ type: 'answered', call: res.call, meId, deviceId: deviceRef.current });
      connect(res.call);
    } catch (err) {
      releaseMedia();
      dispatch({ type: 'error', notice: messageOf(err, 'Could not answer the call') });
      scheduleReset();
    } finally {
      acting.current = false;
    }
  }, [meId, takeMedia, connect, releaseMedia, scheduleReset]);

  const decline = useCallback(async () => {
    const { call } = stateRef.current;
    stopRingtone();
    dispatch({ type: 'reset' });
    if (call) await post(`/calls/${call.id}/decline`).catch(() => {});
  }, []);

  const hangUp = useCallback(async () => {
    const { call } = stateRef.current;
    releaseMedia();
    if (!call) { dispatch({ type: 'reset' }); return; }
    try {
      await post(`/calls/${call.id}/hangup`);
    } catch { /* the sweep ends it if this never arrives */ }
    // The server's "ended" event normally lands first; this covers a lost stream.
    setTimeout(() => {
      if (stateRef.current.call?.id === call.id && stateRef.current.phase !== 'ended') {
        dispatch({ type: 'ended', call: { ...call, status: 'ended', endReason: call.answeredAt ? 'completed' : 'cancelled' }, meId, notice: endNoticeRef.current ?? undefined });
        endNoticeRef.current = null;
        scheduleReset();
      }
    }, 1500);
  }, [meId, releaseMedia, scheduleReset]);
  hangUpRef.current = hangUp;

  const rejoin = useCallback(async () => {
    const { call } = stateRef.current;
    if (!call || acting.current || stateRef.current.phase !== 'rejoin') return;
    acting.current = true;
    try {
      await takeMedia(call.media);
      const res = await post<StartResponse>(`/channels/${call.channelId}/calls`, { media: call.media, deviceId: deviceRef.current });
      iceRef.current = res.iceServers || [];
      if (res.call.status === 'active') {
        dispatch({ type: 'joined', call: res.call });
        connect(res.call);
      } else {
        dispatch({ type: 'outgoing', call: res.call, peer: stateRef.current.peer ?? peerFor(call.channelId, call.calleeId) });
      }
    } catch (err) {
      releaseMedia();
      dispatch({ type: 'error', notice: messageOf(err, 'Could not rejoin the call') });
      scheduleReset();
    } finally {
      acting.current = false;
    }
  }, [takeMedia, connect, peerFor, releaseMedia, scheduleReset]);

  const dismiss = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    dispatch({ type: 'reset' });
  }, []);

  const toggleMute = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    const next = !tracks.some((t) => !t.enabled);
    tracks.forEach((t) => { t.enabled = !next; });
    setMuted(next);
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const next = !tracks.some((t) => !t.enabled);
    tracks.forEach((t) => { t.enabled = !next; });
    setCameraOff(next);
  }, []);

  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const toggleShare = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const camera = localRef.current?.getVideoTracks()[0] ?? null;
    if (screenRef.current) {
      screenRef.current.stop();
      screenRef.current = null;
      await engine.replaceVideo(camera);
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenRef.current = track;
      // Browser's own "Stop sharing" button.
      track.onended = () => {
        if (screenRef.current === track) {
          screenRef.current = null;
          void engine.replaceVideo(localRef.current?.getVideoTracks()[0] ?? null);
          setSharing(false);
        }
      };
      await engine.replaceVideo(track);
      setSharing(true);
    } catch { /* picker cancelled */ }
  }, []);

  const minimise = useCallback((on: boolean) => dispatch({ type: 'minimise', on }), []);

  // ── live events ────────────────────────────────────────────────────────────

  const onEvent = useCallback((raw: unknown) => {
    const e = raw as { type?: string; call?: ServerCall; caller?: { name?: string }; callId?: string; toDevice?: string; kind?: SignalKind; data?: unknown; side?: 'caller' | 'callee' };
    if (!e?.type?.startsWith('call.') || !meId) return;
    const cur = stateRef.current;
    const device = deviceRef.current;

    if (e.type === 'call.signal') {
      if (e.toDevice !== device || !e.callId || !e.kind) return;
      if (engineRef.current && cur.call?.id === e.callId) {
        void engineRef.current.handleSignal(e.kind, e.data).catch((err) => console.warn('[call] signal', err));
      } else {
        pendingRef.current.push({ callId: e.callId, kind: e.kind, data: e.data });
      }
      return;
    }
    const call = e.call;
    if (!call) return;

    if (e.type === 'call.ring') {
      if (call.calleeId === meId && (cur.phase === 'idle' || cur.phase === 'ended')) {
        if (resetTimer.current) clearTimeout(resetTimer.current);
        dispatch({ type: 'incoming', call, peer: peerFor(call.channelId, call.callerId, e.caller?.name) });
        startRingtone('incoming');
      }
      return;
    }
    if (cur.call?.id !== call.id) return;

    if (e.type === 'call.answered') {
      stopRingtone();
      if (call.callerId === meId && call.callerDevice === device) {
        dispatch({ type: 'answered', call, meId, deviceId: device });
        connect(call);
      } else if (call.calleeId === meId && call.calleeDevice !== device) {
        dispatch({ type: 'answered', call, meId, deviceId: device }); // answered elsewhere → idle
      }
    } else if (e.type === 'call.rejoined') {
      const mySide = call.callerId === meId ? 'caller' : 'callee';
      // The other person reloaded: start the connection again with their new tab.
      if (e.side !== mySide && engineRef.current) connect(call);
      // I took the call over in another tab: this tab lets go.
      if (e.side === mySide && call[`${mySide}Device`] !== device) { releaseMedia(); dispatch({ type: 'reset' }); }
    } else if (e.type === 'call.ended') {
      finish(call);
    }
  }, [meId, peerFor, connect, finish, releaseMedia]);

  // A call already ringing or going on when this page loaded — or one that rang
  // while the live stream was down (laptop asleep, Wi-Fi change, server deploy).
  const pickUpLiveCall = useCallback((isCancelled: () => boolean = () => false) => {
    apiClient.get<LiveResponse>('/chat/calls/live').then((res) => {
      if (isCancelled() || !res.call || stateRef.current.phase !== 'idle') return;
      const c = res.call;
      const peerId = c.callerId === meId ? c.calleeId : c.callerId;
      const peer = peerFor(c.channelId, peerId, res.peer?.name);
      iceRef.current = res.iceServers || [];
      if (c.status === 'ringing' && c.calleeId === meId) {
        dispatch({ type: 'incoming', call: c, peer });
        startRingtone('incoming');
      } else {
        dispatch({ type: 'rejoin', call: c, peer });
      }
    }).catch(() => {});
  }, [meId, peerFor]);

  // The stream came back after a gap: signals sent meanwhile are gone. Idle →
  // look for a ring we missed; mid-setup → exchange connection details afresh.
  const streamUpBefore = useRef(false);
  const onStreamConnect = useCallback(() => {
    if (!streamUpBefore.current) { streamUpBefore.current = true; return; } // first connect: the effect below covers it
    const phase = stateRef.current.phase;
    if (phase === 'idle') pickUpLiveCall();
    else if (phase === 'connecting' || phase === 'reconnecting') engineRef.current?.restartIce();
  }, [pickUpLiveCall]);

  useChatStream({ enabled: canChat && !!meId, onMessage: onEvent, onConnect: onStreamConnect });

  useEffect(() => {
    if (!canChat || !meId) return;
    let off = false;
    pickUpLiveCall(() => off);
    return () => { off = true; };
  }, [canChat, meId, pickUpLiveCall]);

  // Heartbeat while in a call; also notices an end this tab never heard about.
  const inCall = IN_CALL.has(state.phase);
  const callId = state.call?.id;
  useEffect(() => {
    if (!inCall || !callId) return;
    const beat = setInterval(() => {
      post<{ call: ServerCall }>(`/calls/${callId}/heartbeat`, { deviceId: deviceRef.current })
        .then((res) => { if (res.call?.status === 'ended') finish(res.call); })
        .catch((err: { code?: string; rawData?: { code?: string } }) => {
          if ((err?.rawData?.code ?? err?.code) === 'OTHER_DEVICE') { releaseMedia(); dispatch({ type: 'reset' }); }
        });
    }, 10_000);
    return () => clearInterval(beat);
  }, [inCall, callId, finish, releaseMedia]);

  // Closing the tab hangs up, so the other person isn't left talking to nobody.
  useEffect(() => {
    if (!inCall || !callId) return;
    const bye = () => { void post(`/calls/${callId}/hangup`, {}, true).catch(() => {}); };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [inCall, callId]);

  // Fetch the call code in the background once this person can be called, so
  // the first ring (or click on Call) does not wait for a download.
  const canBeCalled = canChat && !!meId;
  useEffect(() => {
    if (!canBeCalled) return;
    const prefetch = () => { void loadOverlay().catch(() => {}); void loadEngine().catch(() => {}); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(prefetch);
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(prefetch, 2000);
    return () => clearTimeout(t);
  }, [canBeCalled]);

  useEffect(() => () => {
    connectGen.current += 1;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    engineRef.current?.close();
    stopStream(localRef.current);
    stopRingtone();
  }, []);

  const api = useMemo<CallApi>(() => ({
    state,
    ready: canBeCalled,
    busy: state.phase !== 'idle' && state.phase !== 'ended',
    localStream,
    remoteStream,
    muted,
    cameraOff,
    sharing,
    canShare,
    start,
    answer,
    decline,
    hangUp,
    rejoin,
    dismiss,
    toggleMute,
    toggleCamera,
    toggleShare,
    minimise,
  }), [state, canBeCalled, localStream, remoteStream, muted, cameraOff, sharing, canShare, start, answer, decline, hangUp, rejoin, dismiss, toggleMute, toggleCamera, toggleShare, minimise]);

  return (
    <CallContext.Provider value={api}>
      {children}
      {state.phase !== 'idle' && <CallOverlay />}
    </CallContext.Provider>
  );
}
