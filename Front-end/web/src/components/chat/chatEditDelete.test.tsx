/**
 * Editing and deleting your own message, on screen.
 *
 * The rule (enforced by the API — these buttons are a convenience): the author,
 * within 15 minutes of sending. An admin is sent a deleted message's words and
 * every earlier version of an edited one; everyone else is not, and this
 * component must draw whichever version it was given without guessing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const me: ChatPerson = { id: 'me', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Delivery on Tuesdy', deleted: false,
  sender: me, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: new Date().toISOString(), editableUntil: inMinutes(14), ...over,
});

const render_ = (m: ChatMessage, extra: Partial<React.ComponentProps<typeof MessageItem>> = {}) =>
  render(
    <MessageItem
      message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}}
      onEdit={jest.fn().mockResolvedValue({})} onDelete={jest.fn().mockResolvedValue({})} {...extra}
    />,
  );

describe('who sees Edit and Delete', () => {
  it('the author does, on a recent message', () => {
    render_(base());
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete message' })).toBeInTheDocument();
  });

  it.each([
    ['someone else’s message', base({ sender: anu })],
    ['a message past its window', base({ editableUntil: inMinutes(-1) })],
    ['an automatic system post', base({ kind: 'system', sender: null, editableUntil: null })],
    ['a deleted message', base({ deleted: true, text: '', editableUntil: null })],
    ['a message still sending', base({ pending: true })],
  ])('nobody does on %s', (_label, m) => {
    render_(m);
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull();
  });

  /*
    The buttons must not stay up after the window closes and then fail when
    clicked — they disappear at the moment the server would start refusing.
  */
  it('the buttons go away by themselves when the 15 minutes run out', () => {
    jest.useFakeTimers();
    try {
      render_(base({ editableUntil: new Date(Date.now() + 2000).toISOString() }));
      expect(screen.getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(2500); });
      expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('editing', () => {
  it('saves the new text', async () => {
    const onEdit = jest.fn().mockResolvedValue({});
    render_(base(), { onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' });
    expect(box).toHaveValue('Delivery on Tuesdy');
    fireEvent.change(box, { target: { value: 'Delivery on Tuesday' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), 'Delivery on Tuesday');
  });

  it('Escape cancels without saving', () => {
    const onEdit = jest.fn();
    render_(base(), { onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('does not offer to save an empty message — that is a delete', () => {
    render_(base());
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the server’s reason when a save is refused', async () => {
    const onEdit = jest.fn().mockRejectedValue(new Error('Messages can only be edited or deleted within 15 minutes of sending'));
    render_(base(), { onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('within 15 minutes');
  });

  it('marks an edited message', () => {
    render_(base({ edited: true, editedAt: new Date().toISOString() }));
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });
});

describe('deleting', () => {
  it('asks first, then deletes', async () => {
    const onDelete = jest.fn().mockResolvedValue({});
    render_(base(), { onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('Cancel keeps the message', () => {
    const onDelete = jest.fn();
    render_(base(), { onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delivery on Tuesdy')).toBeInTheDocument();
  });
});

describe('what a deleted or edited message looks like', () => {
  it('to staff: "This message was deleted", with no words', () => {
    render_(base({ sender: anu, deleted: true, text: '', editableUntil: null }));
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
  });

  it('to an admin: the original words, clearly marked deleted', () => {
    render_(base({ sender: anu, deleted: true, text: 'Customer said 40k max', deletedAt: new Date().toISOString(), editableUntil: null }));
    expect(screen.getByText(/Deleted by sender/)).toBeInTheDocument();
    expect(screen.getByText('Customer said 40k max')).toBeInTheDocument();
  });

  it('to an admin: the earlier versions of an edited message, on request', () => {
    render_(base({
      sender: anu, text: 'v3', edited: true, editedAt: new Date().toISOString(), editableUntil: null,
      editHistory: [
        { text: 'v1', editedAt: new Date().toISOString() },
        { text: 'v2', editedAt: new Date().toISOString() },
      ],
    }));
    expect(screen.queryByText('v1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /earlier versions \(2\)/ }));
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  /*
    The server withholds a deleted message's words from quotes too, sending an
    empty preview. That must read as deleted, not as "Shared a file" — which is
    what an empty preview meant before deletes existed.
  */
  it('a quote of a deleted message says so, not "Shared a file"', () => {
    render_(base({ sender: anu, editableUntil: null, quote: { id: 'q', seq: 1, by: 'Sam', preview: '', deleted: true } }));
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
    expect(screen.queryByText('Shared a file')).toBeNull();
  });
});
