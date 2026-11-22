/**
 * One WebRTC connection between this browser and the other person in a call.
 *
 * The audio and video flow directly between the two browsers (or through our
 * relay when a network blocks that); this class only sets the connection up and
 * keeps it alive. Setup messages ("signals") go through our backend
 * (POST /chat/calls/:id/signal → the team-chat live stream), passed in as
 * `sendSignal`.
 *
 * Negotiation follows the "perfect negotiation" pattern: the caller is the
 * initiator and impolite, the callee is polite. The callee adds its own camera
 * and microphone only after applying the caller's first offer, so its tracks
 * ride the caller's transceivers and the first exchange is a single offer and
 * answer. If both sides ever offer at once (a renegotiation), the polite side
 * yields and nothing deadlocks.
 *
 * Network blips: "disconnected" for a few seconds triggers an ICE restart;
 * still not connected after FAIL_AFTER_MS gives up with state "failed".
 * A connection that never comes up at all (the other side's offer or answer
 * never arrived, or no network path — e.g. no relay on a strict network) gives
 * up after CONNECT_TIMEOUT_MS, instead of showing "Connecting…" for ever.
 */

export type SignalKind = 'offer' | 'answer' | 'candidates';
export type EngineState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface CallEngineOptions {
  iceServers: RTCIceServer[];
  /** The caller starts the first offer; the callee answers. */
  initiator: boolean;
  localStream: MediaStream;
  sendSignal: (kind: SignalKind, data: unknown) => Promise<void>;
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: EngineState) => void;
  /** Tests inject a fake. */
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  /** Called once when the connection is up and when it ends, for the health report. */
  onStats?: (summary: CallStatsSummary) => void;
}

export interface CallStatsSummary {
  /** 'direct' (browser to browser), 'relay' (through our TURN server) or unknown. */
  route: 'direct' | 'relay' | 'unknown';
  rttMs: number | null;
}

export const CANDIDATE_BATCH_MS = 150;
export const RESTART_AFTER_MS = 3_000;
export const FAIL_AFTER_MS = 20_000;
export const CONNECT_TIMEOUT_MS = 30_000;
/** A setup message whose request failed is tried again after these waits. */
export const SEND_RETRY_MS = [500, 1500];

/**
 * An SDP must end with CRLF; anything on the way that trims strings (our own API
 * sanitizer did) makes Chrome refuse it as "Invalid SDP line". Put it back.
 */
export function withSdpLineEnd<T extends { sdp?: string } | null | undefined>(description: T): T {
  if (!description || typeof description.sdp !== 'string' || !description.sdp || description.sdp.endsWith('\n')) return description;
  return { ...description, sdp: `${description.sdp}\r\n` };
}

export class CallEngine {
  readonly pc: RTCPeerConnection;
  private readonly opts: CallEngineOptions;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private tracksAdded = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private outbox: RTCIceCandidateInit[] = [];
  private outboxTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private remote: MediaStream | null = null;
  // Signals are applied one at a time, in arrival order (see handleSignal).
  private chain: Promise<void> = Promise.resolve();
  private state: EngineState = 'connecting';
  private reportedConnected = false;

  constructor(opts: CallEngineOptions) {
    this.opts = opts;
    this.polite = !opts.initiator;
    const make = opts.createPeer ?? ((c: RTCConfiguration) => new RTCPeerConnection(c));
    this.pc = make({ iceServers: opts.iceServers, bundlePolicy: 'max-bundle' });

    this.pc.onnegotiationneeded = () => { void this.negotiate(); };
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.queueCandidate(candidate.toJSON());
    };
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? this.remote ?? new MediaStream();
      if (!ev.streams[0]) stream.addTrack(ev.track);
      if (stream !== this.remote) {
        this.remote = stream;
        opts.onRemoteStream(stream);
      }
    };
    this.pc.onconnectionstatechange = () => this.onConnectionState();

    // The caller sends first; the callee waits for the offer (see class note).
    if (opts.initiator) this.addLocalTracks();

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.reportedConnected) this.setState('failed');
    }, CONNECT_TIMEOUT_MS);
  }

  private isClosed(): boolean {
    return this.state === 'closed';
  }

  /** Did this connection ever come up? (Lets the UI tell "lost" from "never connected".) */
  get everConnected(): boolean {
    return this.reportedConnected;
  }

  private addLocalTracks() {
    if (this.tracksAdded) return;
    this.tracksAdded = true;
    for (const track of this.opts.localStream.getTracks()) this.pc.addTrack(track, this.opts.localStream);
  }

  private setState(next: EngineState) {
    if (this.state === next || this.state === 'closed') return;
    this.state = next;
    this.opts.onState(next);
  }

  private async negotiate() {
    // The callee never opens negotiation before it has the caller's offer.
    if (!this.opts.initiator && !this.pc.remoteDescription) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) await this.send('offer', this.pc.localDescription.toJSON());
    } catch (err) {
      console.warn('[call] offer failed', err);
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Send a setup message, trying again if the request fails. A lost offer or
   * answer would leave both sides on "Connecting…" until the give-up timer, so
   * a brief network blip or a backend restart must not lose one.
   */
  private async send(kind: SignalKind, data: unknown): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.opts.sendSignal(kind, data);
        return;
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        // 4xx (other than "slow down") is final: the call ended or moved tabs.
        const final = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
        if (final || attempt >= SEND_RETRY_MS.length || this.isClosed()) throw err;
        await new Promise((r) => setTimeout(r, SEND_RETRY_MS[attempt]));
        if (this.isClosed()) throw err; // hung up while waiting
      }
    }
  }

  /**
   * A signal from the other browser. Applied strictly one after another: the
   * page hands them over without waiting, and an offer still being applied must
   * not race the candidates (or a second offer) that arrive right behind it.
   */
  handleSignal(kind: SignalKind, data: unknown): Promise<void> {
    const run = this.chain.then(() => this.applySignal(kind, data));
    this.chain = run.catch(() => {}); // one bad signal must not block the ones after it
    return run;
  }

  private async applySignal(kind: SignalKind, data: unknown): Promise<void> {
    if (this.state === 'closed') return;
    if (kind === 'candidates') {
      const list = Array.isArray(data) ? (data as RTCIceCandidateInit[]) : [];
      for (const c of list) {
        // Before the other side's description arrives, a candidate has nothing to attach to.
        if (!this.pc.remoteDescription) { this.pendingCandidates.push(c); continue; }
        try {
          await this.pc.addIceCandidate(c);
        } catch (err) {
          if (!this.ignoreOffer) console.warn('[call] bad candidate', err);
        }
      }
      return;
    }

    const description = withSdpLineEnd(data as RTCSessionDescriptionInit);
    if (!description || (description.type !== 'offer' && description.type !== 'answer')) return;
    const collision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(description);
    // Candidates that came early belong to this description: apply them now,
    // before anything below can fail and strand them.
    const waiting = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of waiting) {
      try { await this.pc.addIceCandidate(c); } catch { /* stale candidate */ }
    }
    if (description.type === 'offer') {
      this.addLocalTracks();
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) await this.send('answer', this.pc.localDescription.toJSON());
    }
  }

  private queueCandidate(c: RTCIceCandidateInit) {
    this.outbox.push(c);
    if (this.outboxTimer) return;
    // Candidates come in bursts; one request per burst, not one per candidate.
    this.outboxTimer = setTimeout(() => {
      this.outboxTimer = null;
      const batch = this.outbox;
      this.outbox = [];
      if (batch.length && this.state !== 'closed') {
        void this.send('candidates', batch).catch((err) => console.warn('[call] candidates not sent', err));
      }
    }, CANDIDATE_BATCH_MS);
  }

  private onConnectionState() {
    const s = this.pc.connectionState;
    if (s === 'connected') {
      this.clearRecoveryTimers();
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.setState('connected');
      if (!this.reportedConnected) {
        this.reportedConnected = true;
        void this.summary().then((sum) => this.opts.onStats?.(sum)).catch(() => {});
      }
    } else if (s === 'disconnected' || s === 'failed') {
      this.setState('reconnecting');
      if (s === 'failed') this.restartIce();
      else if (!this.restartTimer) this.restartTimer = setTimeout(() => { this.restartTimer = null; this.restartIce(); }, RESTART_AFTER_MS);
      if (!this.failTimer) this.failTimer = setTimeout(() => { this.failTimer = null; if (this.pc.connectionState !== 'connected') this.setState('failed'); }, FAIL_AFTER_MS);
    }
  }

  /**
   * Start the connection setup over (an ICE restart). Also used when the live
   * stream that carries signals dropped while connecting: whatever was sent in
   * the gap is lost, so both sides exchange fresh details.
   */
  restartIce() {
    if (this.state === 'closed' || this.state === 'connected') return;
    try {
      // Fires negotiationneeded with an ICE-restart offer. Either side may call it;
      // perfect negotiation settles a clash.
      this.pc.restartIce();
    } catch { /* closed meanwhile */ }
  }

  private clearRecoveryTimers() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.failTimer) clearTimeout(this.failTimer);
    this.restartTimer = null;
    this.failTimer = null;
  }

  /** Swap the outgoing video (camera ↔ screen) without renegotiating. */
  async replaceVideo(track: MediaStreamTrack | null): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video' || (!s.track && track?.kind === 'video'));
    if (sender) await sender.replaceTrack(track);
  }

  /** Was the connection direct or relayed, and how slow. Best effort. */
  async summary(): Promise<CallStatsSummary> {
    try {
      const report = await this.pc.getStats();
      let pair: { localCandidateId?: string; currentRoundTripTime?: number } | null = null;
      const byId = new Map<string, { candidateType?: string }>();
      report.forEach((s: { id: string; type: string; state?: string; nominated?: boolean; candidateType?: string }) => {
        byId.set(s.id, s);
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s as typeof pair;
      });
      const found = pair as { localCandidateId?: string; currentRoundTripTime?: number } | null;
      if (!found) return { route: 'unknown', rttMs: null };
      const local = found.localCandidateId ? byId.get(found.localCandidateId) : undefined;
      return {
        route: local?.candidateType === 'relay' ? 'relay' : local?.candidateType ? 'direct' : 'unknown',
        rttMs: typeof found.currentRoundTripTime === 'number' ? Math.round(found.currentRoundTripTime * 1000) : null,
      };
    } catch {
      return { route: 'unknown', rttMs: null };
    }
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.clearRecoveryTimers();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    this.outboxTimer = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    try { this.pc.close(); } catch { /* already closed */ }
  }
}
