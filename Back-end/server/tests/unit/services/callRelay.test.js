import { jest } from '@jest/globals';
import { cloudflareTurnServers, cloudflareTurnConfigured, resetCloudflareTurnCache } from '../../../services/callRelay.js';

/*
 * The hosted call relay: off without keys, credentials minted server-side and
 * shared for half their life, port-53 URLs dropped, and a Cloudflare outage
 * degrades to STUN-only instead of failing the call. No real network here.
 */
const ok = (body) => ({ ok: true, status: 201, json: async () => body });
const CF = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'u1',
      credential: 'c1',
    },
  ],
};

describe('cloudflareTurnServers', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resetCloudflareTurnCache();
    process.env.CALL_CF_TURN_KEY_ID = 'key-id';
    process.env.CALL_CF_TURN_API_TOKEN = 'secret-token';
    process.env.CALL_TURN_TTL_SECONDS = '3600';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('is off, with no API call, until both keys are set', async () => {
    delete process.env.CALL_CF_TURN_API_TOKEN;
    const fetchImpl = jest.fn();
    expect(cloudflareTurnConfigured()).toBe(false);
    expect(await cloudflareTurnServers({ fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('mints with the bearer token server-side and hands out only relay URLs (no port 53)', async () => {
    const fetchImpl = jest.fn(async () => ok(CF));
    const servers = await cloudflareTurnServers({ fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init.body)).toEqual({ ttl: 3600 });
    expect(servers).toEqual([{
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'u1',
      credential: 'c1',
    }]);
    expect(JSON.stringify(servers)).not.toContain('secret-token');
  });

  it('reuses credentials for half their life, then mints again', async () => {
    const fetchImpl = jest.fn(async () => ok(CF));
    const t0 = Date.now();
    await cloudflareTurnServers({ fetchImpl, now: t0 });
    await cloudflareTurnServers({ fetchImpl, now: t0 + 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await cloudflareTurnServers({ fetchImpl, now: t0 + 3600 * 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('two calls starting at once share one mint', async () => {
    const fetchImpl = jest.fn(async () => ok(CF));
    await Promise.all([cloudflareTurnServers({ fetchImpl }), cloudflareTurnServers({ fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a Cloudflare error or junk reply means STUN only for this call, and a retry next time', async () => {
    const down = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect(await cloudflareTurnServers({ fetchImpl: down })).toEqual([]);
    const junk = jest.fn(async () => ok({ iceServers: [{ urls: 'turn:x:53' }] }));
    expect(await cloudflareTurnServers({ fetchImpl: junk })).toEqual([]);
    const thrown = jest.fn(async () => { throw new Error('timeout'); });
    expect(await cloudflareTurnServers({ fetchImpl: thrown })).toEqual([]);
    const good = jest.fn(async () => ok(CF));
    expect(await cloudflareTurnServers({ fetchImpl: good })).toHaveLength(1);
  });
});
