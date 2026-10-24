/** Retry resends a failed message exactly as it was sent — photos included. */
import { createResendStore } from './resend';
import type { ChatMessage } from '@/hooks/queries/useTeamChat';

const failed = (clientId: string, text = ''): ChatMessage => ({ clientId, text, mentions: [], quote: null } as unknown as ChatMessage);

it('a failed photo message is retried WITH its photo (it used to arrive empty)', () => {
  const store = createResendStore();
  const photo = new File(['x'], 'screenshot.png', { type: 'image/png' });
  store.remember({ text: '', clientId: 'c1', files: [photo], orderIds: ['o1'], threadRoot: 'r1' });
  expect(store.varsFor(failed('c1'))).toMatchObject({ clientId: 'c1', files: [photo], orderIds: ['o1'], threadRoot: 'r1' });
});

it('once sent, it is forgotten; an unknown message falls back to its text', () => {
  const store = createResendStore();
  store.remember({ text: 'hi', clientId: 'c2', files: [new File(['x'], 'a.png')] });
  store.forget('c2');
  expect(store.varsFor(failed('c2', 'hi'))).toEqual({ text: 'hi', clientId: 'c2', mentions: [], quoteId: undefined });
});
