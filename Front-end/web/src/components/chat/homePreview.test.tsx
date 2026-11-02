/**
 * The Home list's second line is the conversation's newest message
 * ("You: …", "Ravi: …", or just the words in a one-to-one DM), formatting
 * markers removed, and "Message deleted" — never the words — for a deleted one.
 */
import { homeLine } from './TeamChat';
import { plainLine } from './chatFormat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

jest.mock('./Conversation', () => ({ __esModule: true, default: () => null }));

const ch = (over: Partial<ChatChannel>): ChatChannel => ({
  id: 'c1', kind: 'space', key: null, name: 'sales', description: 'Sales team', audience: 'team', team: 'sales',
  system: true, partner: null, memberCount: null, lastMessageSeq: 3, lastMessageAt: null, lastReadSeq: 3, unread: 0,
  ...over,
} as ChatChannel);
const preview = (over: Partial<NonNullable<ChatChannel['lastPreview']>> = {}) =>
  ({ by: 'Ravi', mine: false, text: 'Order shipped', deleted: false, ...over });

describe('homeLine', () => {
  it('a space shows who said it', () => {
    expect(homeLine(ch({ lastPreview: preview() }))).toBe('Ravi: Order shipped');
  });

  it('my own message reads "You: …"', () => {
    expect(homeLine(ch({ lastPreview: preview({ mine: true, by: 'Sana' }) }))).toBe('You: Order shipped');
  });

  it('a one-to-one DM shows just the words; a group DM names the sender', () => {
    expect(homeLine(ch({ kind: 'dm', lastPreview: preview() }))).toBe('Order shipped');
    expect(homeLine(ch({ kind: 'dm', group: true, lastPreview: preview() }))).toBe('Ravi: Order shipped');
  });

  it('a deleted message says so, and never shows words', () => {
    expect(homeLine(ch({ lastPreview: preview({ deleted: true, text: 'leftover' }) }))).toBe('Ravi: Message deleted');
  });

  it('formatting markers are removed', () => {
    expect(homeLine(ch({ lastPreview: preview({ text: '*urgent* ship _today_ ~maybe~ `X1`' }) }))).toBe('Ravi: urgent ship today maybe X1');
  });

  it('no preview (no messages yet, or an older server) gives an empty line, so the old description shows', () => {
    expect(homeLine(ch({ lastPreview: null }))).toBe('');
    expect(homeLine(ch({}))).toBe('');
  });
});

describe('plainLine', () => {
  it('keeps links and plain words, joins lines', () => {
    expect(plainLine('see https://x.com/a_b_c\n\n```code```')).toBe('see https://x.com/a_b_c code');
  });
  it('leaves text that is only a script tag as characters', () => {
    expect(plainLine('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});
