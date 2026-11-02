/**
 * The typing store: who is typing where, for how long, and the line it reads as.
 */
import { act, renderHook } from '@testing-library/react';
import { clearTyping, noteTyping, resetTyping, typingLine, typingNames, useTypingLine, TYPING_SHOW_MS } from './chatTyping';

beforeEach(() => { jest.useFakeTimers(); resetTyping(); });
afterEach(() => { jest.useRealTimers(); });

describe('typing store', () => {
  it('shows a name for a few seconds, then drops it', () => {
    const now = Date.now();
    noteTyping({ channelId: 'c1', userId: 'u1', name: 'Ravi' }, now);
    expect(typingNames('c1', null, now + 1000)).toEqual(['Ravi']);
    expect(typingNames('c1', null, now + TYPING_SHOW_MS + 1)).toEqual([]);
  });

  it('keeps conversations and threads apart', () => {
    noteTyping({ channelId: 'c1', threadRoot: 'r1', userId: 'u1', name: 'Ravi' });
    expect(typingNames('c1', null)).toEqual([]);
    expect(typingNames('c2', 'r1')).toEqual([]);
    expect(typingNames('c1', 'r1')).toEqual(['Ravi']);
  });

  it('a repeat from the same person is one name, kept up longer', () => {
    const now = Date.now();
    noteTyping({ channelId: 'c1', userId: 'u1', name: 'Ravi' }, now);
    noteTyping({ channelId: 'c1', userId: 'u1', name: 'Ravi' }, now + 4000);
    expect(typingNames('c1', null, now + TYPING_SHOW_MS + 1000)).toEqual(['Ravi']);
  });

  it('their message clears them everywhere in that conversation', () => {
    noteTyping({ channelId: 'c1', userId: 'u1', name: 'Ravi' });
    noteTyping({ channelId: 'c1', threadRoot: 'r1', userId: 'u1', name: 'Ravi' });
    noteTyping({ channelId: 'c1', userId: 'u2', name: 'Anu' });
    clearTyping('c1', 'u1');
    expect(typingNames('c1', null)).toEqual(['Anu']);
    expect(typingNames('c1', 'r1')).toEqual([]);
  });

  it('reads as plain English', () => {
    expect(typingLine([])).toBe('');
    expect(typingLine(['Ravi'])).toBe('Ravi is typing…');
    expect(typingLine(['Ravi', 'Anu'])).toBe('Ravi and Anu are typing…');
    expect(typingLine(['Ravi', 'Anu', 'Sam'])).toBe('Several people are typing…');
  });

  it('the hook updates on an event and clears itself when the time runs out', () => {
    const { result } = renderHook(() => useTypingLine('c1', null));
    expect(result.current).toBe('');
    act(() => { noteTyping({ channelId: 'c1', userId: 'u1', name: 'Ravi' }); });
    expect(result.current).toBe('Ravi is typing…');
    act(() => { jest.advanceTimersByTime(TYPING_SHOW_MS + 100); });
    expect(result.current).toBe('');
  });
});
