/**
 * Shared photos are drawn small and whole: one photo in a capped, fixed-height
 * frame (narrowed to a tall picture once loaded), several in a tidy grid of
 * equal tiles — never full-width, never cropped, a tap opens the full size.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem, { PHOTO_H, PHOTO_MAX_W, photoFrameWidth } from './MessageItem';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const priya: ChatPerson = { id: 'u2', name: 'Priya', role: 'staff', team: 'procurement', teamLabel: 'Procurement', isHead: true };
const ravi: ChatPerson = { id: 'u3', name: 'Ravi', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'Payment proof', deleted: false,
  sender: priya, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-11-02T05:00:00Z', ...over,
} as ChatMessage);
const photo = (n: number) => ({ url: `https://files.test/p${n}.png`, kind: 'image' as const, name: `shot ${n}.png`, mime: 'image/png', size: 2048 });
const show = (m: ChatMessage, previous?: ChatMessage, extra: { showDay?: boolean } = {}) => render(
  <MessageItem message={m} previous={previous} meId="me" meName="Sana" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} {...extra} />,
);

describe('photo size', () => {
  it('fits a photo into the frame height without going wider than the cap', () => {
    expect(photoFrameWidth(1920, 1080)).toBe(PHOTO_MAX_W); // wide screenshot: capped
    expect(photoFrameWidth(1080, 2340)).toBe(Math.round((PHOTO_H * 1080) / 2340)); // tall phone shot: narrow
    expect(photoFrameWidth(10, 2000)).toBe(96); // never a sliver
    expect(photoFrameWidth(0, 0)).toBe(PHOTO_MAX_W); // unknown yet
  });

  it('one photo sits in a capped, fixed-height frame, whole (not cropped), and opens full size', () => {
    show(msg({ attachments: [photo(1)] }));
    const frame = screen.getByTestId('chat-photo');
    expect(frame).toHaveAttribute('href', 'https://files.test/p1.png');
    expect(frame).toHaveAttribute('target', '_blank');
    expect(frame.style.width).toBe(`${PHOTO_MAX_W}px`);
    expect(frame.style.height).toBe('var(--gc-photo-h)');
    const img = screen.getByRole('img', { name: 'shot 1.png' });
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
  });

  it('narrows the frame to a tall picture once it has loaded', () => {
    show(msg({ attachments: [photo(2)] }));
    const img = screen.getByRole('img', { name: 'shot 2.png' });
    Object.defineProperty(img, 'naturalWidth', { value: 1080 });
    Object.defineProperty(img, 'naturalHeight', { value: 2340 });
    fireEvent.load(img);
    expect(screen.getByTestId('chat-photo').style.width).toBe(`${photoFrameWidth(1080, 2340)}px`);
  });

  it('several photos go in a tidy grid of equal tiles, none cropped', () => {
    show(msg({ attachments: [photo(3), photo(4), photo(5)] }));
    const grid = screen.getByTestId('chat-photo-grid');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('max-w-[360px]');
    for (const tile of screen.getAllByTestId('chat-photo')) expect(tile.className).toContain('aspect-[4/3]');
    for (const img of screen.getAllByRole('img')) expect(img.className).toContain('object-contain');
  });

  it('two photos sit side by side', () => {
    show(msg({ attachments: [photo(6), photo(7)] }));
    expect(screen.getByTestId('chat-photo-grid').className).toContain('grid-cols-2');
  });
});
