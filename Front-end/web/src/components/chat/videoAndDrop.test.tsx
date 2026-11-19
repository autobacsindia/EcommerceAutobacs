/**
 * Team chat — videos and drag & drop.
 *
 *   - the composer takes MP4 / MOV / WebM up to 40 MB, other files up to 10 MB,
 *     and says in words why anything else was left out
 *   - files dropped anywhere on the conversation go through the same path as
 *     the attach button (Composer.addFiles), several at once
 *   - the "Drop files to send" overlay does not flicker as the pointer crosses
 *     messages, and ignores a drag of plain text
 *   - a shared video plays in the message, with a download link
 */
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Composer, { pickFiles, type ComposerHandle } from './Composer';
import MessageItem from './MessageItem';
import { DropOverlay, useFileDrop } from './useFileDrop';
import { chatDownloadUrl } from './chatUi';
import type { ChatMessage, ChatPerson, SendVars } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useRecentOrders: () => ({ data: [], isLoading: false }) }));

const MB = 1024 * 1024;
// jsdom has no object URLs; the composer makes one for a photo's preview.
beforeAll(() => {
  Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} });
});
/** A File of a given size without allocating it. */
const fileOf = (name: string, type: string, size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('which files the composer takes', () => {
  it('takes MP4, MOV and WebM videos up to 40 MB', () => {
    const videos = [fileOf('a.mp4', 'video/mp4', 10 * MB), fileOf('IMG_1.MOV', 'video/quicktime', 12 * MB), fileOf('s.webm', 'video/webm', 2 * MB)];
    expect(pickFiles(videos, [])).toEqual({ accepted: videos, error: '' });
    expect(pickFiles([fileOf('max.mp4', 'video/mp4', 40 * MB)], []).accepted).toHaveLength(1);
  });

  it('takes a .mov with no type from the name', () => {
    expect(pickFiles([fileOf('clip.mov', '')], []).accepted).toHaveLength(1);
  });

  it('refuses a video over 40 MB and says the limit', () => {
    const { accepted, error } = pickFiles([fileOf('long.mp4', 'video/mp4', 55 * MB)], []);
    expect(accepted).toHaveLength(0);
    expect(error).toBe('"long.mp4" is 55 MB — videos can be up to 40 MB. Send a shorter clip.');
  });

  it('keeps the 10 MB cap for other files', () => {
    const { accepted, error } = pickFiles([fileOf('scan.pdf', 'application/pdf', 11 * MB)], []);
    expect(accepted).toHaveLength(0);
    expect(error).toBe('"scan.pdf" is over 10 MB and was not added.');
  });

  it('leaves out a type the server would refuse, but keeps the rest of the batch', () => {
    const ok = fileOf('photo.png', 'image/png');
    const { accepted, error } = pickFiles([fileOf('setup.exe', 'application/x-msdownload'), ok], []);
    expect(accepted).toEqual([ok]);
    expect(error).toMatch(/"setup.exe" can’t be shared here\. Send a photo, video \(MP4, MOV, WebM\)/);
  });

  it('stops at the 40 MB message total', () => {
    const { accepted, error } = pickFiles([fileOf('a.mp4', 'video/mp4', 30 * MB), fileOf('b.mp4', 'video/mp4', 30 * MB)], []);
    expect(accepted.map((f) => f.name)).toEqual(['a.mp4']);
    expect(error).toMatch(/add up to 40 MB/);
  });
});

/** The conversation's wiring, as in Conversation.tsx: a drop zone feeding the composer's handle. */
function Pane({ onSend }: { onSend: (v: SendVars) => void }) {
  const composer = useRef<ComposerHandle>(null);
  const drop = useFileDrop((files) => composer.current?.addFiles(files));
  return (
    <section data-testid="pane" {...drop.handlers}>
      <DropOverlay show={drop.active} />
      <ul><li data-testid="message">Earlier message</li></ul>
      <Composer handle={composer} channelName="#x" people={[]} teams={[]} onSend={onSend} />
    </section>
  );
}
const files = (...list: File[]) => ({ dataTransfer: { types: ['Files'], files: list, dropEffect: 'none' } });

describe('drag and drop onto the conversation', () => {
  it('dropping several files adds them all, and Send sends them', () => {
    const onSend = jest.fn();
    render(<Pane onSend={onSend} />);
    const pane = screen.getByTestId('pane');
    const clip = fileOf('clip.mp4', 'video/mp4', 3 * MB);
    const bill = fileOf('bill.pdf', 'application/pdf');

    fireEvent.dragEnter(pane, files(clip, bill));
    expect(screen.getByTestId('drop-overlay')).toHaveTextContent('Drop files to send');
    fireEvent.drop(pane, files(clip, bill));
    expect(screen.queryByTestId('drop-overlay')).toBeNull();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('bill.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0].files).toEqual([clip, bill]);
  });

  it('a drop on a message (not the box) still counts', () => {
    render(<Pane onSend={jest.fn()} />);
    fireEvent.drop(screen.getByTestId('message'), files(fileOf('p.png', 'image/png')));
    expect(screen.getByText('p.png')).toBeInTheDocument();
  });

  it('a dropped file that is too big shows why', () => {
    render(<Pane onSend={jest.fn()} />);
    fireEvent.drop(screen.getByTestId('pane'), files(fileOf('huge.mov', 'video/quicktime', 90 * MB)));
    expect(screen.getByRole('alert')).toHaveTextContent('videos can be up to 40 MB');
  });

  it('the overlay stays up while the pointer crosses child elements, and goes when it leaves', () => {
    render(<Pane onSend={jest.fn()} />);
    const pane = screen.getByTestId('pane');
    const child = screen.getByTestId('message');
    const f = files(fileOf('p.png', 'image/png'));
    fireEvent.dragEnter(pane, f);
    fireEvent.dragEnter(child, f); // into a child…
    fireEvent.dragLeave(pane, f); // …which the browser reports as leaving the parent
    expect(screen.getByTestId('drop-overlay')).toBeInTheDocument();
    fireEvent.dragLeave(child, f);
    expect(screen.queryByTestId('drop-overlay')).toBeNull();
  });

  it('clears the overlay when the drag is cancelled outside', () => {
    render(<Pane onSend={jest.fn()} />);
    fireEvent.dragEnter(screen.getByTestId('pane'), files(fileOf('p.png', 'image/png')));
    act(() => { window.dispatchEvent(new Event('dragend')); });
    expect(screen.queryByTestId('drop-overlay')).toBeNull();
  });

  it('ignores dragging plain text', () => {
    render(<Pane onSend={jest.fn()} />);
    fireEvent.dragEnter(screen.getByTestId('pane'), { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('drop-overlay')).toBeNull();
  });

  it('pasting a screenshot adds it, named so two pastes differ', () => {
    render(<Pane onSend={jest.fn()} />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new File(['x'], 'image.png', { type: 'image/png' })] } });
    expect(screen.getByText(/^screenshot-\d\d-\d\d-\d\d\.png$/)).toBeInTheDocument();
  });

  it('the attach button takes videos', () => {
    const { container } = render(<Pane onSend={jest.fn()} />);
    expect(container.querySelector('input[type=file]')?.getAttribute('accept')).toMatch(/video\/mp4.*video\/quicktime.*video\/webm/);
  });
});

describe('a shared video in a message', () => {
  const priya: ChatPerson = { id: 'u2', name: 'Priya', role: 'staff', team: 'procurement', teamLabel: 'Procurement', isHead: true };
  const msg = (attachments: ChatMessage['attachments']): ChatMessage => ({
    id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: '', deleted: false,
    sender: priya, clientId: null, attachments, mentions: [], mentionTeams: [], refs: [], createdAt: '2026-11-18T05:00:00Z',
  } as ChatMessage);
  const show = (m: ChatMessage) => render(
    <MessageItem message={m} meId="me" meName="Sana" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} />,
  );
  const url = '/api/v1/chat/channels/c1/files/1763450000000-abcd1234-clip.mp4';

  it('plays inline with controls, and has a download link', () => {
    const { container } = show(msg([{ url, kind: 'video', name: 'clip.mp4', mime: 'video/mp4', size: 3 * MB }]));
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('src', url);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute('href', `${url}?download=1`);
    expect(screen.queryByTestId('file-card')).toBeNull(); // not shown twice as a document
  });

  it('says to download it when the browser cannot play it', () => {
    const { container } = show(msg([{ url, kind: 'video', name: 'IMG.MOV', mime: 'video/quicktime', size: MB }]));
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByText(/can’t play in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument();
  });

  it('a Cloudinary video link is used as it is', () => {
    expect(chatDownloadUrl('https://res.cloudinary.com/x/video/upload/a.mp4')).toBe('https://res.cloudinary.com/x/video/upload/a.mp4');
    expect(chatDownloadUrl('/api/v1/chat/channels/c/files/a.mp4')).toBe('/api/v1/chat/channels/c/files/a.mp4?download=1');
  });
});
