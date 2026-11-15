import { IDLE, callReducer, endNotice, formatDuration } from './callState';
import type { CallUiState, ServerCall } from './callState';

const ME = 'me0000000000000000000001';
const PEER = 'pe0000000000000000000002';
const call = (over: Partial<ServerCall> = {}): ServerCall => ({
  id: 'call1', channelId: 'dm1', callerId: ME, calleeId: PEER, callerDevice: 'tab-mine-1', calleeDevice: null,
  media: 'video', status: 'ringing', ringUntil: new Date().toISOString(), answeredAt: null, endedAt: null, endReason: null,
  ...over,
});
const peer = { id: PEER, name: 'Mira' };

describe('callReducer', () => {
  it('outgoing → answered → connected → ended', () => {
    let s: CallUiState = callReducer(IDLE, { type: 'outgoing', call: call(), peer });
    expect(s.phase).toBe('outgoing');
    s = callReducer(s, { type: 'answered', call: call({ status: 'active', calleeDevice: 'tab-theirs' }), meId: ME, deviceId: 'tab-mine-1' });
    expect(s.phase).toBe('connecting');
    s = callReducer(s, { type: 'engine', state: 'connected' });
    expect(s.phase).toBe('connected');
    s = callReducer(s, { type: 'ended', call: call({ status: 'ended', endReason: 'completed' }), meId: ME });
    expect(s).toMatchObject({ phase: 'ended', notice: 'Call ended' });
  });

  it('a second incoming call never replaces a call in progress', () => {
    const inCall = callReducer(IDLE, { type: 'outgoing', call: call(), peer });
    const after = callReducer(inCall, { type: 'incoming', call: call({ id: 'call2', callerId: PEER, calleeId: ME }), peer });
    expect(after).toBe(inCall);
  });

  it('stops ringing here when I answered on another tab or device', () => {
    const ringing = callReducer(IDLE, { type: 'incoming', call: call({ callerId: PEER, calleeId: ME }), peer });
    const after = callReducer(ringing, {
      type: 'answered', call: call({ callerId: PEER, calleeId: ME, status: 'active', calleeDevice: 'tab-other' }), meId: ME, deviceId: 'tab-this',
    });
    expect(after.phase).toBe('idle');
  });

  it('ignores events for a different call', () => {
    const s = callReducer(IDLE, { type: 'outgoing', call: call(), peer });
    expect(callReducer(s, { type: 'ended', call: call({ id: 'other', status: 'ended', endReason: 'missed' }), meId: ME })).toBe(s);
  });

  it('engine states only apply while a call is up', () => {
    expect(callReducer(IDLE, { type: 'engine', state: 'connected' })).toBe(IDLE);
  });

  it('a start error shows its message', () => {
    expect(callReducer(IDLE, { type: 'error', notice: 'Mira is on another call' })).toMatchObject({ phase: 'ended', notice: 'Mira is on another call' });
  });
});

describe('endNotice', () => {
  it('reads from where I sit', () => {
    expect(endNotice({ endReason: 'declined', callerId: ME }, ME, 'Mira')).toBe('Mira declined the call');
    expect(endNotice({ endReason: 'missed', callerId: ME }, ME, 'Mira')).toBe("Mira didn't answer");
    expect(endNotice({ endReason: 'missed', callerId: PEER }, ME, 'Mira')).toBe('Missed call from Mira');
    expect(endNotice({ endReason: 'cancelled', callerId: PEER }, ME, 'Mira')).toBe('Missed call from Mira');
    expect(endNotice({ endReason: 'failed', callerId: ME }, ME, 'Mira')).toMatch(/connection was lost/);
  });
});

describe('formatDuration', () => {
  it.each([[0, '0:00'], [7, '0:07'], [247, '4:07'], [3729, '1:02:09'], [-5, '0:00']])('%s s → %s', (s, out) => {
    expect(formatDuration(s)).toBe(out);
  });
});
