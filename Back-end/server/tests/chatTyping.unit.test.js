/**
 * chatTyping's throttle: with Redis, one SET NX EX key per person per
 * conversation/thread decides; without it (or when Redis errors), this
 * instance's memory does.
 */
import { jest } from '@jest/globals';

const set = jest.fn();
let healthy = true;
jest.unstable_mockModule('../services/redisClient.js', () => ({
  getRedisClient: () => ({ set }),
  isRedisHealthy: () => healthy,
}));
const { claimTyping, TYPING_THROTTLE_SECONDS } = await import('../services/chatTyping.js');

beforeEach(() => { set.mockReset(); healthy = true; });

describe('claimTyping', () => {
  it('claims with SET NX and the throttle as TTL, keyed by conversation, thread and person', async () => {
    set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    expect(await claimTyping('c1', 'u1', 'r1')).toBe(true);
    expect(await claimTyping('c1', 'u1', 'r1')).toBe(false);
    expect(set).toHaveBeenCalledWith('chat:typing:c1:r1:u1', '1', 'EX', TYPING_THROTTLE_SECONDS, 'NX');
  });

  it('no thread uses its own key', async () => {
    set.mockResolvedValue('OK');
    await claimTyping('c1', 'u1');
    expect(set).toHaveBeenCalledWith('chat:typing:c1:-:u1', '1', 'EX', TYPING_THROTTLE_SECONDS, 'NX');
  });

  it('falls back to local memory when Redis is down or errors', async () => {
    healthy = false;
    expect(await claimTyping('c2', 'u2')).toBe(true);
    expect(await claimTyping('c2', 'u2')).toBe(false);
    healthy = true;
    set.mockRejectedValue(new Error('boom'));
    expect(await claimTyping('c3', 'u3')).toBe(true);
    expect(await claimTyping('c3', 'u3')).toBe(false);
    expect(set).toHaveBeenCalled();
  });
});
