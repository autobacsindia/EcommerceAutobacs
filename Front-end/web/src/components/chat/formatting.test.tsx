/**
 * Message formatting and link cards, on screen.
 *
 * Formatting is drawn from plain characters (*bold*, _italic_, ~strike~,
 * `code`, ``` blocks, - and 1. lists) as React elements — never as HTML, so
 * nothing a colleague types can run. These tests also pin down the cases
 * that must NOT format: snake_case words, URLs with underscores, 2*3*4.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { formatMessage } from './chatFormat';
import Composer, { bulletLines, insertAt, wrapSelection } from './Composer';
import MessageItem from './MessageItem';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useRecentOrders: () => ({ data: [], isLoading: false }) }));

const show = (text: string, opts?: Parameters<typeof formatMessage>[1]) => render(<div data-testid="m">{formatMessage(text, opts)}</div>);
const box = () => screen.getByTestId('m');

describe('inline formatting', () => {
  it('bold, italic, strike and code', () => {
    show('*Paid* in _full_, ~not~ `PR-0022`');
    expect(box().querySelector('strong')).toHaveTextContent('Paid');
    expect(box().querySelector('em')).toHaveTextContent('full');
    expect(box().querySelector('s')).toHaveTextContent('not');
    expect(box().querySelector('code')).toHaveTextContent('PR-0022');
  });

  it('nests: bold around italic', () => {
    show('*very _important_ note*');
    expect(box().querySelector('strong em')).toHaveTextContent('important');
  });

  it.each([
    ['snake_case words', 'see order_items_v2 table'],
    ['maths', 'cost is 2*3*4'],
    ['a lone star', 'rated 5* service'],
    ['spaces inside markers', 'this * is not * bold'],
  ])('leaves %s alone', (_l, text) => {
    show(text);
    expect(box().querySelector('strong, em, s')).toBeNull();
    expect(box()).toHaveTextContent(text);
  });

  it('a URL with underscores stays one link', () => {
    show('open https://example.com/a_b_c/page_1 now');
    const a = box().querySelector('a')!;
    expect(a).toHaveAttribute('href', 'https://example.com/a_b_c/page_1');
    expect(box().querySelector('em')).toBeNull();
  });

  it('nothing inside `code` is formatted', () => {
    show('`*not bold* _nor this_`');
    expect(box().querySelector('code')).toHaveTextContent('*not bold* _nor this_');
    expect(box().querySelector('strong, em')).toBeNull();
  });

  it('typed HTML is shown as text, never run', () => {
    show('*<img src=x onerror=alert(1)>* <script>alert(1)</script>');
    expect(box().querySelector('img, script')).toBeNull();
    expect(box()).toHaveTextContent('<script>alert(1)</script>');
  });

  it('keeps mentions and their highlight', () => {
    show('*@Anu* and @all please', { mentionNames: ['Anu', 'all'], meName: 'Sam' });
    expect(screen.getByText('@Anu')).toHaveClass('bg-emerald-100');
    expect(screen.getByText('@all')).toHaveClass('bg-amber-200');
  });
});

describe('blocks', () => {
  it('bulleted and numbered lists', () => {
    show('Checklist:\n- invoice\n- photos\n1. pack\n2. ship');
    expect(box().querySelectorAll('ul li')).toHaveLength(2);
    expect(box().querySelectorAll('ol li')).toHaveLength(2);
    expect(box().querySelector('ul')).toHaveTextContent('invoicephotos');
  });

  it('a code block keeps its lines and formats nothing', () => {
    show('Run:\n```\nnpm run audit -- --apply\n*x*\n```\ndone');
    const pre = box().querySelector('pre')!;
    expect(pre.textContent).toBe('npm run audit -- --apply\n*x*');
    expect(box().querySelector('strong')).toBeNull();
    expect(box()).toHaveTextContent('done');
  });

  it('plain lines keep their line breaks', () => {
    show('line one\nline two');
    expect(box().querySelector('.whitespace-pre-wrap')!.textContent).toBe('line one\nline two');
  });
});

describe('composer helpers', () => {
  it('wraps the selection, or drops an empty pair at the caret', () => {
    expect(wrapSelection('pay now', 4, 7, '*')).toEqual({ text: 'pay *now*', start: 5, end: 8 });
    expect(wrapSelection('ab', 1, 1, '_')).toEqual({ text: 'a__b', start: 2, end: 2 });
  });

  it('bullets the selected lines, once', () => {
    expect(bulletLines('a\nb\nc', 0, 3).text).toBe('- a\n- b\nc');
    expect(bulletLines('- a', 0, 0).text).toBe('- a');
  });

  it('inserts an emoji at the caret', () => {
    expect(insertAt('ok thanks', 2, 2, ' 👍')).toEqual({ text: 'ok 👍 thanks', start: 5, end: 5 });
  });

  it('Ctrl+B in the box wraps the selection in *', () => {
    render(<Composer channelName="#x" people={[]} teams={[]} onSend={jest.fn()} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'urgent' } });
    ta.setSelectionRange(0, 6);
    fireEvent.keyDown(ta, { key: 'b', ctrlKey: true });
    expect(ta.value).toBe('*urgent*');
  });

  it('the emoji button adds an emoji to the message', () => {
    render(<Composer channelName="#x" people={[]} teams={[]} onSend={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    fireEvent.click(screen.getAllByRole('button', { name: '🙏' })[0]);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('🙏');
  });
});

describe('link card', () => {
  const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
  const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'see https://autobacsindia.com/p/winch', deleted: false,
    sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: '2026-10-27T05:00:00Z', ...over,
  });
  const item = (m: ChatMessage) => render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} />);

  it('shows site, title and description — and no image', () => {
    item(msg({ preview: { url: 'https://autobacsindia.com/p/winch', title: 'Winch 12000 lb', description: 'Heavy duty', site: 'Roavion' } }));
    const card = screen.getByText('Winch 12000 lb').closest('a')!;
    expect(card).toHaveAttribute('href', 'https://autobacsindia.com/p/winch');
    expect(card).toHaveTextContent('Roavion');
    expect(card).toHaveTextContent('Heavy duty');
    expect(card.querySelector('img')).toBeNull();
  });

  it('no card until the server has one', () => {
    item(msg());
    expect(screen.queryByText('Winch 12000 lb')).not.toBeInTheDocument();
  });
});
