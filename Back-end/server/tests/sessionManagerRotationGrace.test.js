/**
 * Refresh-token rotation grace window.
 *
 * Guards the fix for the self-inflicted logout: two uncoordinated frontend
 * refresh surfaces (Edge middleware + api-client) can present the SAME refresh
 * token concurrently. The first rotates it; the lagging one arrives with a
 * now-revoked token. Without the grace window that lagging request tripped
 * reuse detection and wiped every session ("session expires very soon").
 *
 * These tests exercise the branch logic directly (no DB / JWT needed) by
 * spying on the sessionStore singleton. resetMocks/restoreMocks (jest.config)
 * restore the real methods between tests.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';
import sessionStore from '../services/sessionStore.js';
import { rotateRefreshToken, generateRefreshToken } from '../utils/sessionManager.js';

const makeUser = () => ({
  _id: 'user-abc-123',
  email: 'racer@example.com',
  refreshTokens: [],           // token intentionally absent → simulates "already rotated away"
  save: jest.fn().mockResolvedValue(undefined),
});

describe('rotateRefreshToken — grace window', () => {
  it('replays the cached successor for a concurrent/lagging refresh instead of nuking sessions', async () => {
    const user = makeUser();
    const oldToken = generateRefreshToken();
    const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');

    const cachedSuccessor = {
      accessToken: 'access-B',
      refreshToken: 'refresh-B',
      accessTokenExpiry: '30m',
      refreshTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const graceSpy = jest
      .spyOn(sessionStore, 'getRotationGrace')
      .mockResolvedValue(cachedSuccessor);
    const revokeAllSpy = jest
      .spyOn(sessionStore, 'revokeAllSessions')
      .mockResolvedValue(undefined);

    const result = await rotateRefreshToken(user, oldToken, '1.2.3.4', 'jest');

    // Same successor handed back — the racing client stays logged in.
    expect(result).toBe(cachedSuccessor);
    // Looked up under the OLD token's hash.
    expect(graceSpy).toHaveBeenCalledWith(oldHash);
    // NO nuclear wipe: sessions untouched and the user doc was never cleared/saved.
    expect(revokeAllSpy).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  it('treats a replay OUTSIDE the grace window as genuine reuse and wipes sessions', async () => {
    const user = makeUser();
    const oldToken = generateRefreshToken();

    jest.spyOn(sessionStore, 'getRotationGrace').mockResolvedValue(null);
    const revokeAllSpy = jest
      .spyOn(sessionStore, 'revokeAllSessions')
      .mockResolvedValue(undefined);

    await expect(
      rotateRefreshToken(user, oldToken, '1.2.3.4', 'jest'),
    ).rejects.toThrow('REFRESH_TOKEN_REUSE_DETECTED');

    // Nuclear option fired: all sessions revoked and the doc cleared.
    expect(revokeAllSpy).toHaveBeenCalledWith(user._id.toString());
    expect(user.refreshTokens).toEqual([]);
    expect(user.save).toHaveBeenCalled();
  });
});
