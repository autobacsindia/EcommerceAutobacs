/**
 * What the call UI is showing, as a pure reducer so every transition is
 * testable without a browser. The server is the authority on the call itself
 * (services/chatCallService.js): this only follows its events.
 */

export type CallMedia = 'audio' | 'video';
export type CallEndReason = 'completed' | 'declined' | 'missed' | 'cancelled' | 'failed';

export interface ServerCall {
  id: string;
  channelId: string;
  callerId: string;
  calleeId: string;
  callerDevice: string | null;
  calleeDevice: string | null;
  media: CallMedia;
  status: 'ringing' | 'active' | 'ended';
  ringUntil: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
}

export interface CallPeer { id: string; name: string; avatarUrl?: string }

export type CallPhase =
  | 'idle'
  | 'outgoing'     // I rang; waiting for an answer
  | 'incoming'     // ringing here
  | 'connecting'   // answered; browsers connecting
  | 'connected'
  | 'reconnecting'
  | 'rejoin'       // a call of mine is live but not in this tab (after a reload)
  | 'ended';

export interface CallUiState {
  phase: CallPhase;
  call: ServerCall | null;
  peer: CallPeer | null;
  /** Shown on the 'ended' screen, or why a start failed. */
  notice: string | null;
  minimised: boolean;
}

export const IDLE: CallUiState = { phase: 'idle', call: null, peer: null, notice: null, minimised: false };

export type CallAction =
  | { type: 'outgoing'; call: ServerCall; peer: CallPeer }
  | { type: 'incoming'; call: ServerCall; peer: CallPeer }
  | { type: 'answered'; call: ServerCall; meId: string; deviceId: string }
  | { type: 'engine'; state: 'connecting' | 'connected' | 'reconnecting' }
  | { type: 'rejoin'; call: ServerCall; peer: CallPeer }
  | { type: 'joined'; call: ServerCall }
  | { type: 'ended'; call: ServerCall; meId: string }
  | { type: 'error'; notice: string }
  | { type: 'minimise'; on: boolean }
  | { type: 'reset' };

/** Words for the end of a call, from where I sit. */
export function endNotice(call: Pick<ServerCall, 'endReason' | 'callerId'>, meId: string, peerName: string): string {
  const iCalled = call.callerId === meId;
  switch (call.endReason) {
    case 'declined': return iCalled ? `${peerName} declined the call` : 'Call declined';
    case 'missed': return iCalled ? `${peerName} didn't answer` : `Missed call from ${peerName}`;
    case 'cancelled': return iCalled ? 'Call cancelled' : `Missed call from ${peerName}`;
    case 'failed': return 'Call ended — the connection was lost';
    default: return 'Call ended';
  }
}

export function callReducer(state: CallUiState, action: CallAction): CallUiState {
  switch (action.type) {
    case 'outgoing':
      return { ...IDLE, phase: 'outgoing', call: action.call, peer: action.peer };
    case 'incoming':
      // Already busy in this tab: the server would say busy anyway; never replace a live call.
      if (state.phase !== 'idle' && state.phase !== 'ended') return state;
      return { ...IDLE, phase: 'incoming', call: action.call, peer: action.peer };
    case 'answered': {
      if (!state.call || state.call.id !== action.call.id) return state;
      const iAmCallee = action.call.calleeId === action.meId;
      // I'm the callee and another of my tabs/devices answered: stop ringing here.
      if (iAmCallee && action.call.calleeDevice !== action.deviceId) return IDLE;
      return { ...state, phase: 'connecting', call: action.call };
    }
    case 'joined':
      return state.call && state.call.id === action.call.id ? { ...state, phase: 'connecting', call: action.call } : state;
    case 'engine':
      if (!['connecting', 'connected', 'reconnecting'].includes(state.phase)) return state;
      return { ...state, phase: action.state };
    case 'rejoin':
      if (state.phase !== 'idle' && state.phase !== 'ended') return state;
      return { ...IDLE, phase: 'rejoin', call: action.call, peer: action.peer };
    case 'ended':
      if (!state.call || state.call.id !== action.call.id) return state;
      return { ...state, phase: 'ended', call: action.call, minimised: false, notice: endNotice(action.call, action.meId, state.peer?.name || 'They') };
    case 'error':
      return { ...IDLE, phase: 'ended', notice: action.notice };
    case 'minimise':
      return { ...state, minimised: action.on };
    case 'reset':
      return IDLE;
    default:
      return state;
  }
}

/** "4:07" / "1:02:09" */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** A stable id for this browser tab (survives a reload of the same tab). */
export function tabDeviceId(): string {
  const make = () => {
    const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `tab-${r.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 64);
  };
  try {
    const existing = sessionStorage.getItem('chat-call-device');
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = make();
    sessionStorage.setItem('chat-call-device', id);
    return id;
  } catch {
    return make();
  }
}
