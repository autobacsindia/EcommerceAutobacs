/**
 * CallProvider: the actions behind the call buttons.
 *
 * Regression (prod, 2026-11-15): a second tap on "Answer" while the browser was
 * still asking for the camera sent a second answer. The server refused it (409,
 * already answered) and that refusal's clean-up closed the connection the first
 * tap had just opened — the caller sat on "Connecting…" with no video.
 */
import { act, render } from '@testing-library/react';
import type { ServerCall } from '@/lib/calls/callState';

const ME = 'me0000000000000000000001';
const PEER = 'pe0000000000000000000002';

const ringing: ServerCall = {
  id: 'call1', channelId: 'dm1', callerId: PEER, calleeId: ME, callerDevice: 'tab-theirs-1', calleeDevice: null,
  media: 'video', status: 'ringing', ringUntil: new Date(Date.now() + 30_000).toISOString(),
  answeredAt: null, endedAt: null, endReason: null,
};

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('@/hooks/useSSE', () => ({ useSSE: () => ({}) }));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useCanChat: () => true, useChatMe: () => ({ data: { userId: ME } }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ getQueryData: () => [] }) }));
jest.mock('@sentry/react', () => ({ captureMessage: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/lib/calls/ringtone', () => ({ startRingtone: jest.fn(), stopRingtone: jest.fn() }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));

type MockEngine = { close: jest.Mock; handleSignal: jest.Mock; everConnected: boolean; opts: { onState: (s: string) => void } };
const mockEngines: MockEngine[] = [];
jest.mock('@/lib/calls/callEngine', () => ({
  CallEngine: class {
    close = jest.fn();
    handleSignal = jest.fn(async () => {});
    everConnected = false;
    opts: unknown;
    constructor(opts: unknown) { this.opts = opts; mockEngines.push(this as unknown as MockEngine); }
  },
}));

import { NEVER_CONNECTED_NOTICE } from '@/lib/calls/callState';
import CallProvider, { useCalls } from './CallProvider';
import type { CallApi } from './CallProvider';

let api: CallApi | null = null;
function Probe() { api = useCalls(); return null; }

/** getUserMedia that resolves only when the test says so (the permission prompt). */
let grant: () => void = () => {};
const getUserMedia = jest.fn(() => new Promise<MediaStream>((resolve) => {
  grant = () => resolve({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream);
}));

const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };

beforeAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEngines.length = 0;
  api = null;
});

describe('CallProvider', () => {
  it('a second tap on Answer during the camera prompt sends ONE answer and keeps the connection', async () => {
    mockGet.mockResolvedValue({ call: ringing, peer: { id: PEER, name: 'Test Person' }, iceServers: [] });
    mockPost.mockImplementation(async (path: string, body: { deviceId: string }) => {
      if (path === '/chat/calls/call1/answer') {
        // The first answer wins; any later one is refused, as the server does.
        if (mockPost.mock.calls.filter(([p]) => p === path).length > 1) {
          throw Object.assign(new Error('Already answered on another device'), { status: 409 });
        }
        return { call: { ...ringing, status: 'active', calleeDevice: body.deviceId }, iceServers: [] };
      }
      return {};
    });
    render(<CallProvider><Probe /></CallProvider>);
    await flush();
    expect(api?.state.phase).toBe('incoming');

    await act(async () => { void api!.answer(); void api!.answer(); });
    grant();
    await flush();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls.filter(([p]) => p === '/chat/calls/call1/answer')).toHaveLength(1);
    expect(api?.state.phase).toBe('connecting');
    expect(mockEngines).toHaveLength(1);
    expect(mockEngines[0].close).not.toHaveBeenCalled();
  });

  it('a double-click on Video call opens the camera once and starts one call', async () => {
    mockGet.mockResolvedValue({ call: null, iceServers: [] });
    mockPost.mockResolvedValue({ call: { ...ringing, callerId: ME, calleeId: PEER, callerDevice: 'x', id: 'call2' }, iceServers: [] });
    render(<CallProvider><Probe /></CallProvider>);
    await flush();

    await act(async () => { void api!.start('dm1', 'video'); void api!.start('dm1', 'video'); });
    grant();
    await flush();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls.filter(([p]) => p === '/chat/channels/dm1/calls')).toHaveLength(1);
    expect(api?.state.phase).toBe('outgoing');
  });

  it('an answered call that never connects hangs up and says why', async () => {
    mockGet.mockResolvedValue({ call: ringing, peer: { id: PEER, name: 'Test Person' }, iceServers: [] });
    mockPost.mockImplementation(async (path: string, body: { deviceId: string }) => (
      path.endsWith('/answer') ? { call: { ...ringing, status: 'active', calleeDevice: body.deviceId }, iceServers: [] } : {}
    ));
    render(<CallProvider><Probe /></CallProvider>);
    await flush();
    await act(async () => { void api!.answer(); });
    grant();
    await flush();
    expect(mockEngines).toHaveLength(1);

    await act(async () => { mockEngines[0].opts.onState('failed'); });
    await flush();
    expect(mockPost.mock.calls.some(([p]) => p === '/chat/calls/call1/hangup')).toBe(true);
    // No "ended" event in this test: the provider's own fallback ends the call.
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(api?.state).toMatchObject({ phase: 'ended', notice: NEVER_CONNECTED_NOTICE });
  });
});
