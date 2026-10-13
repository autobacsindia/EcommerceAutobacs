/**
 * Chat message search — the panel.
 *
 * The access rules live on the server and are tested there; what matters here
 * is that the panel does not go to the server when it should not (a single
 * letter, which the server refuses anyway), that it sends the channel through
 * when the search is scoped to one conversation, and that a result is readable:
 * which channel, who said it, what they said.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MessageSearch from './MessageSearch';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

const get = jest.fn();
/** Types into the search box the way a controlled input receives it. */
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const channel = (over: Partial<ChatChannel> = {}): ChatChannel =>
  ({
    id: 'c1', kind: 'space', key: 'company', name: 'company', description: '',
    audience: 'all', team: null, system: true, partner: null, memberCount: null,
    lastMessageSeq: 3, lastMessageAt: '2026-10-12T10:00:00Z', lastReadSeq: 3, unread: 0,
    ...over,
  }) as ChatChannel;

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'm1', channelId: 'c1', seq: 2, kind: 'user', text: 'the winch order shipped',
  deleted: false,
  sender: { id: 'u1', name: 'Sana', role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: true },
  clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-12T09:30:00Z',
  channel: 'c1', channelName: 'company', channelKind: 'space',
  ...over,
});

function mount(props: Partial<React.ComponentProps<typeof MessageSearch>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPick = jest.fn();
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={qc}>
      <MessageSearch channels={[channel()]} onPick={onPick} onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onPick, onClose };
}

describe('MessageSearch', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ messages: [hit()], nextBefore: null });
  });

  it('does not ask the server for a single letter', async () => {
    mount();
    type('Search all messages', 'w');
    // Past the debounce, with room to spare. Inside act(), because the timer
    // is what sets state — React would warn about an update it did not see.
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText(/at least two letters/i)).toBeInTheDocument();
  });

  it('searches on two letters and shows the channel, sender and text', async () => {
    mount();
    type('Search all messages', 'winch');

    await waitFor(() => expect(get).toHaveBeenCalled());
    const url = String(get.mock.calls[0][0]);
    expect(url).toContain('/chat/search?');
    expect(url).toContain('q=winch');
    expect(url).not.toContain('channelId');

    expect(await screen.findByText('the winch order shipped')).toBeInTheDocument();
    expect(screen.getByText('Sana')).toBeInTheDocument();
    expect(screen.getByText('company')).toBeInTheDocument();
  });

  it('narrows to one channel when opened from a conversation', async () => {
    mount({ scopeTo: channel({ id: 'c9', name: 'sales' }) });
    type('Search in sales', 'winch');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(String(get.mock.calls[0][0])).toContain('channelId=c9');
  });

  it('opening a result hands back the channel it was found in', async () => {
    const { onPick } = mount();
    type('Search all messages', 'winch');
    fireEvent.click(await screen.findByText('the winch order shipped'));
    expect(onPick).toHaveBeenCalledWith('c1');
  });

  it('says so plainly when nothing matched', async () => {
    get.mockResolvedValue({ messages: [], nextBefore: null });
    mount();
    type('Search all messages', 'winch');
    expect(await screen.findByText(/nothing matched/i)).toBeInTheDocument();
  });

  it('shows the server’s reason when the search cannot run', async () => {
    // What a staff member sees in the window after a deploy, before the search
    // index has been built.
    get.mockRejectedValue(new Error('Search is still being set up. Please try again shortly.'));
    mount();
    type('Search all messages', 'winch');
    expect(await screen.findByText(/still being set up/i)).toBeInTheDocument();
  });
});
