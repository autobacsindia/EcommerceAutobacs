/**
 * Sending "I am typing": at most once every few seconds however fast the keys
 * go, with the thread when typing in one, and never an error on screen.
 */
import { renderHook } from '@testing-library/react';

const post = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));

import { useTypingSignal } from '@/hooks/queries/useTeamChat';

beforeEach(() => { post.mockReset(); post.mockResolvedValue({}); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-02T10:00:00Z')); });
afterEach(() => { jest.useRealTimers(); });

describe('useTypingSignal', () => {
  it('sends once, then waits 3 seconds before sending again', () => {
    const { result } = renderHook(() => useTypingSignal('c1', null));
    result.current(); result.current(); result.current();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/chat/channels/c1/typing', {});
    jest.setSystemTime(new Date('2026-11-02T10:00:03Z'));
    result.current();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('includes the thread when typing a reply', () => {
    const { result } = renderHook(() => useTypingSignal('c1', 'r1'));
    result.current();
    expect(post).toHaveBeenCalledWith('/chat/channels/c1/typing', { threadRoot: 'r1' });
  });

  it('a failed signal is ignored', async () => {
    post.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTypingSignal('c1', null));
    expect(() => result.current()).not.toThrow();
    await Promise.resolve();
  });
});
