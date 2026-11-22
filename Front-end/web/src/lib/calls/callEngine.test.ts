/**
 * CallEngine against a scripted fake RTCPeerConnection: who offers first,
 * candidates batched and held until a description arrives, the polite side
 * yielding on a clash, and recovery from a dropped connection.
 */
import { CallEngine, SEND_RETRY_MS, CANDIDATE_BATCH_MS, CONNECT_TIMEOUT_MS, FAIL_AFTER_MS, RESTART_AFTER_MS, withSdpLineEnd } from './callEngine';
import type { EngineState, SignalKind } from './callEngine';

class FakePeer {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { type: string; sdp: string; toJSON(): unknown } | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  added: MediaStreamTrack[] = [];
  candidates: RTCIceCandidateInit[] = [];
  restarts = 0;
  closed = false;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  private queued = false;
  // Browsers fire negotiationneeded once for a burst of addTrack calls.
  addTrack(t: MediaStreamTrack) {
    this.added.push(t);
    // Tracks added while answering ride the offer's transceivers: nothing to renegotiate.
    if (this.queued || this.signalingState === 'have-remote-offer') return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.onnegotiationneeded?.(); });
  }
  async setLocalDescription() {
    const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
    this.localDescription = { type, sdp: `sdp-${type}`, toJSON() { return { type, sdp: `sdp-${type}` }; } };
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c: RTCIceCandidateInit) { this.candidates.push(c); }
  restartIce() { this.restarts += 1; }
  getSenders() { return []; }
  async getStats() { return new Map(); }
  close() { this.closed = true; }
  setConn(s: RTCPeerConnectionState) { this.connectionState = s; this.onconnectionstatechange?.(); }
}

const track = (kind: string) => ({ kind, stop: jest.fn() }) as unknown as MediaStreamTrack;
const stream = () => ({ getTracks: () => [track('audio'), track('video')] }) as unknown as MediaStream;

function setup(initiator: boolean, opts: { peer?: FakePeer; sendSignal?: (kind: SignalKind, data: unknown) => Promise<void> } = {}) {
  const peer = opts.peer ?? new FakePeer();
  const sent: { kind: SignalKind; data: unknown }[] = [];
  const states: EngineState[] = [];
  const engine = new CallEngine({
    iceServers: [{ urls: 'stun:stun.example.com' }],
    initiator,
    localStream: stream(),
    sendSignal: opts.sendSignal ?? (async (kind, data) => { sent.push({ kind, data }); }),
    onRemoteStream: jest.fn(),
    onState: (s) => states.push(s),
    createPeer: () => peer as unknown as RTCPeerConnection,
  });
  return { peer, sent, states, engine };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('CallEngine', () => {
  it('the caller adds its tracks and sends the first offer', async () => {
    const { peer, sent } = setup(true);
    expect(peer.added).toHaveLength(2);
    await tick();
    expect(sent).toEqual([{ kind: 'offer', data: { type: 'offer', sdp: 'sdp-offer' } }]);
  });

  it('the callee waits for the offer, then adds its tracks and answers', async () => {
    const { peer, sent, engine } = setup(false);
    expect(peer.added).toHaveLength(0);
    await engine.handleSignal('offer', { type: 'offer', sdp: 'their-offer' });
    expect(peer.added).toHaveLength(2);
    expect(sent[0]).toEqual({ kind: 'answer', data: { type: 'answer', sdp: 'sdp-answer' } });
    await tick();
    // No second, competing offer from the callee after the first exchange.
    expect(sent.filter((s) => s.kind === 'offer')).toHaveLength(0);
  });

  it('holds candidates that arrive before the description, then applies them', async () => {
    const { peer, engine } = setup(false);
    await engine.handleSignal('candidates', [{ candidate: 'c1' }, { candidate: 'c2' }]);
    expect(peer.candidates).toHaveLength(0);
    await engine.handleSignal('offer', { type: 'offer', sdp: 'x' });
    expect(peer.candidates.map((c) => c.candidate)).toEqual(['c1', 'c2']);
  });

  it('batches its own candidates into one signal', async () => {
    jest.useFakeTimers();
    try {
      const { peer, sent } = setup(true);
      for (const c of ['a', 'b', 'c']) peer.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: c }) } });
      peer.onicecandidate?.({ candidate: null }); // end of candidates: nothing to send
      jest.advanceTimersByTime(CANDIDATE_BATCH_MS + 5);
      const batches = sent.filter((s) => s.kind === 'candidates');
      expect(batches).toHaveLength(1);
      expect(batches[0].data).toEqual([{ candidate: 'a' }, { candidate: 'b' }, { candidate: 'c' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('on a clash the impolite caller ignores the incoming offer; the polite callee yields', async () => {
    const caller = setup(true);
    await tick(); // caller has a local offer out
    await caller.engine.handleSignal('offer', { type: 'offer', sdp: 'clash' });
    expect(caller.peer.remoteDescription).toBeNull();

    const callee = setup(false);
    await callee.engine.handleSignal('offer', { type: 'offer', sdp: 'first' });
    callee.peer.signalingState = 'have-local-offer'; // as if it had started a renegotiation
    await callee.engine.handleSignal('offer', { type: 'offer', sdp: 'second' });
    expect(callee.peer.remoteDescription).toEqual({ type: 'offer', sdp: 'second\r\n' });
  });

  it('restarts ICE after a short drop, and gives up if it never recovers', async () => {
    jest.useFakeTimers();
    try {
      const { peer, states } = setup(true);
      peer.setConn('connected');
      expect(states).toContain('connected');
      peer.setConn('disconnected');
      expect(states.at(-1)).toBe('reconnecting');
      jest.advanceTimersByTime(RESTART_AFTER_MS + 10);
      expect(peer.restarts).toBe(1);
      jest.advanceTimersByTime(FAIL_AFTER_MS);
      expect(states.at(-1)).toBe('failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a quick recovery cancels the give-up timer', async () => {
    jest.useFakeTimers();
    try {
      const { peer, states } = setup(true);
      peer.setConn('connected');
      peer.setConn('disconnected');
      peer.setConn('connected');
      jest.advanceTimersByTime(FAIL_AFTER_MS + RESTART_AFTER_MS);
      expect(states.at(-1)).toBe('connected');
      expect(peer.restarts).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('close() stops everything and ignores late signals', async () => {
    const { peer, engine, sent } = setup(false);
    engine.close();
    expect(peer.closed).toBe(true);
    await engine.handleSignal('offer', { type: 'offer', sdp: 'late' });
    expect(peer.remoteDescription).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('gives up when the connection never comes up, instead of "Connecting…" for ever', async () => {
    jest.useFakeTimers();
    try {
      // The other side never answers the offer (or no network path exists).
      const { states, engine } = setup(true);
      jest.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
      expect(states).not.toContain('failed');
      jest.advanceTimersByTime(2);
      expect(states.at(-1)).toBe('failed');
      expect(engine.everConnected).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('no give-up once connected, and close() cancels the timer', async () => {
    jest.useFakeTimers();
    try {
      const a = setup(true);
      a.peer.setConn('connected');
      jest.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
      expect(a.states).not.toContain('failed');
      expect(a.engine.everConnected).toBe(true);
      const b = setup(false);
      b.engine.close();
      jest.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
      expect(b.states).not.toContain('failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('restores the CRLF a trimmed SDP lost before applying it (Chrome refuses it otherwise)', async () => {
    const { peer, engine } = setup(false);
    await engine.handleSignal('offer', { type: 'offer', sdp: 'v=0\r\na=ssrc:1 msid:s t' });
    expect(peer.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0\r\na=ssrc:1 msid:s t\r\n' });
    expect(withSdpLineEnd({ type: 'answer', sdp: 'v=0\r\n' })).toEqual({ type: 'answer', sdp: 'v=0\r\n' });
    expect(withSdpLineEnd(null)).toBeNull();
  });
});

describe('CallEngine signalling order', () => {
  /** Like a browser: the description only counts once setRemoteDescription resolves. */
  class SlowPeer extends FakePeer {
    release: (() => void) | null = null;
    log: string[] = [];
    async setRemoteDescription(d: RTCSessionDescriptionInit) {
      await new Promise<void>((r) => { this.release = r; });
      await super.setRemoteDescription(d);
      this.log.push(`remote:${d.type}`);
    }
    async addIceCandidate(c: RTCIceCandidateInit) {
      if (!this.remoteDescription) throw new Error('InvalidStateError: no remote description');
      this.log.push(`cand:${c.candidate}`);
      await super.addIceCandidate(c);
    }
  }

  it('candidates that land while the offer is still being applied are queued behind it, not lost', async () => {
    const peer = new SlowPeer();
    const { engine, sent } = setup(false, { peer });
    // The page hands signals over without waiting (CallProvider: void handleSignal).
    const a = engine.handleSignal('offer', { type: 'offer', sdp: 'x' });
    const b = engine.handleSignal('candidates', [{ candidate: 'c1' }]);
    const c = engine.handleSignal('candidates', [{ candidate: 'c2' }]);
    await tick();
    peer.release?.();
    await Promise.all([a, b, c]);
    expect(peer.log).toEqual(['remote:offer', 'cand:c1', 'cand:c2']);
    expect(sent.map((s) => s.kind)).toEqual(['answer']);
  });

  it('a failed signal does not block the ones after it', async () => {
    const { engine, peer } = setup(false);
    peer.setRemoteDescription = async () => { throw new Error('bad sdp'); };
    await expect(engine.handleSignal('offer', { type: 'offer', sdp: 'bad' })).rejects.toThrow('bad sdp');
    peer.setRemoteDescription = FakePeer.prototype.setRemoteDescription.bind(peer);
    await engine.handleSignal('offer', { type: 'offer', sdp: 'good' });
    expect(peer.remoteDescription).toEqual({ type: 'offer', sdp: 'good\r\n' });
  });

  it('retries an answer whose request failed on the network, so the caller is not left on "Connecting…"', async () => {
    jest.useFakeTimers();
    try {
      const calls: SignalKind[] = [];
      let fail = 2;
      const { engine } = setup(false, {
        sendSignal: async (kind) => {
          calls.push(kind);
          if (fail-- > 0) throw Object.assign(new TypeError('Failed to fetch'), { status: undefined });
        },
      });
      const done = engine.handleSignal('offer', { type: 'offer', sdp: 'x' });
      for (const ms of SEND_RETRY_MS) await jest.advanceTimersByTimeAsync(ms);
      await done;
      expect(calls).toEqual(['answer', 'answer', 'answer']);
      engine.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry when the server says the call is over (409)', async () => {
    const calls: SignalKind[] = [];
    const { engine } = setup(false, {
      sendSignal: async (kind) => { calls.push(kind); throw Object.assign(new Error('That call has ended'), { status: 409 }); },
    });
    await expect(engine.handleSignal('offer', { type: 'offer', sdp: 'x' })).rejects.toThrow('ended');
    expect(calls).toEqual(['answer']);
  });

  it('restartIce re-runs setup while connecting, and leaves a live call alone', () => {
    const { engine, peer } = setup(true);
    engine.restartIce();
    expect(peer.restarts).toBe(1);
    peer.setConn('connected');
    engine.restartIce();
    expect(peer.restarts).toBe(1);
    engine.close();
  });
});
