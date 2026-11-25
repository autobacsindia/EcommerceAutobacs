/**
 * Long chat messages, on screen.
 *
 * A staff member lost the end of a long message: the box had maxLength=4000,
 * so the browser silently dropped everything pasted past it. Now the box takes
 * all of it, shows a counter near the limit, and — over the limit — says so in
 * red and will not send. Nothing is ever cut off without a word.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import { textLimitStatus } from '@/lib/textLimit';
import { CHAT_MESSAGE_MAX } from './chatLimits';

jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useRecentOrders: () => ({ data: [], isLoading: false }),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import Composer from './Composer';
import MessageItem from './MessageItem';

const me: ChatPerson = { id: 'me', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const text = (n: number) => 'Beige seat covers for the Creta, delivery Tuesday. '.repeat(Math.ceil(n / 51)).slice(0, n - 1) + '.'; // no edge spaces: the box counts trimmed text

describe('the shared limit rule', () => {
  it('says nothing while there is room, counts near the limit, and explains when over', () => {
    expect(textLimitStatus(100, 1000)).toEqual({ over: false, near: false, message: '' });
    expect(textLimitStatus(850, 1000).message).toBe('850 / 1,000 characters');
    const over = textLimitStatus(1012, 1000);
    expect(over.over).toBe(true);
    expect(over.message).toMatch(/Too long by 12 characters \(the limit is 1,000\)/);
  });
});

describe('the message box', () => {
  const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
  const send = () => screen.getByRole('button', { name: 'Send message' });

  it('has no maxLength — the browser can never cut a paste short', () => {
    render(<Composer channelName="#x" people={[]} teams={[]} onSend={jest.fn()} />);
    expect(box()).not.toHaveAttribute('maxLength');
  });

  it('sends a long message (past the old 4,000) whole', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#x" people={[]} teams={[]} onSend={onSend} />);
    const long = text(9000);
    fireEvent.change(box(), { target: { value: long } });
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: long.trim() }));
  });

  it('over the limit: keeps every word, says why in red, and will not send', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#x" people={[]} teams={[]} onSend={onSend} />);
    const tooLong = text(CHAT_MESSAGE_MAX + 25);
    fireEvent.change(box(), { target: { value: tooLong } });
    expect(box().value).toBe(tooLong);
    expect(screen.getByRole('alert')).toHaveTextContent(/Too long by 25 characters \(the limit is 20,000\)/);
    expect(send()).toBeDisabled();
    fireEvent.submit(box().closest('form')!);
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe(tooLong); // still all there to trim
  });
});

describe('the edit box', () => {
  it('has no maxLength and refuses to save over the limit, with a clear message', () => {
    const onEdit = jest.fn().mockResolvedValue({});
    const m: ChatMessage = {
      id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'short', deleted: false, sender: me, clientId: null,
      attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: new Date().toISOString(),
      editableUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const editor = screen.getByRole('textbox', { name: 'Edit message' });
    expect(editor).not.toHaveAttribute('maxLength');
    fireEvent.change(editor, { target: { value: text(CHAT_MESSAGE_MAX + 1) } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Too long by 1 character \(/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
