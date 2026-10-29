/**
 * Pasting a screenshot (Ctrl/Cmd+V) into a file picker: it lands in the right
 * picker, goes through the same type / size / count checks as choosing a file,
 * and never swallows ordinary text pasted into a field.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FilePicker from '@/components/payments/FilePicker';
import { filesFromClipboard, matchesAccept, namePastedFile } from '@/lib/clipboardFiles';
import { __resetPasteZones } from './usePasteFiles';

const IMAGES = 'image/jpeg,image/png,image/webp';
const shot = (name = 'image.png', type = 'image/png', size = 10) => new File([new Uint8Array(size)], name, { type });

/** A paste event carrying files (and optionally text) on `target`. */
function paste(target: Element | Document, files: File[], text?: string) {
  const types = [...(files.length ? ['Files'] : []), ...(text != null ? ['text/plain'] : [])];
  return fireEvent.paste(target, { clipboardData: { files, items: [], types, getData: () => text ?? '' } });
}

function Picker({ label, max = 3, accept = IMAGES, onError = () => {}, maxBytes }: {
  label: string; max?: number; accept?: string; onError?: (m: string) => void; maxBytes?: number;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  return (
    <div>
      <FilePicker files={files} onChange={setFiles} max={max} accept={accept} label={label} icon={null} maxBytes={maxBytes}
        onError={(m) => { setError(m); onError(m); }} />
      <ul aria-label={`${label} files`}>{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

const attached = (label: string) => screen.getByRole('list', { name: `${label} files` }).textContent;

beforeEach(() => __resetPasteZones());

describe('clipboard helpers', () => {
  it('reads files, falling back to items, and nothing from an empty or text-only clipboard', () => {
    const f = shot();
    expect(filesFromClipboard({ files: [f] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toEqual([f]);
    const items = [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => f }];
    expect(filesFromClipboard({ files: [] as unknown as FileList, items: items as unknown as DataTransferItemList })).toEqual([f]);
    expect(filesFromClipboard(null)).toEqual([]);
  });

  it('matches an accept list by type, wildcard and extension', () => {
    expect(matchesAccept(shot('a.png'), IMAGES)).toBe(true);
    expect(matchesAccept(shot('a.tiff', 'image/tiff'), IMAGES)).toBe(false);
    expect(matchesAccept(shot('a.tiff', 'image/tiff'), 'image/*')).toBe(true);
    expect(matchesAccept(shot('sheet.xlsx', ''), '.xlsx,application/pdf')).toBe(true);
    expect(matchesAccept(shot('a.pdf', 'application/pdf'), '')).toBe(true);
  });

  it('names a pasted "image.png" after when it was pasted, and keeps a real name', () => {
    const at = new Date(2026, 9, 28, 9, 5, 7);
    expect(namePastedFile(shot('image.png'), at).name).toBe('screenshot-09-05-07.png');
    expect(namePastedFile(shot('image.png'), at).type).toBe('image/png');
    expect(namePastedFile(shot('invoice.png'), at).name).toBe('invoice.png');
  });
});

describe('pasting into a picker', () => {
  it('shows the hint, and attaches a screenshot pasted with nothing focused', () => {
    render(<Picker label="Attach screenshot" />);
    expect(screen.getByText(/or paste a screenshot \(Ctrl\+V\)/)).toBeInTheDocument();
    paste(document.body, [shot()]);
    expect(attached('Attach screenshot')).toMatch(/^screenshot-\d\d-\d\d-\d\d\.png$/);
  });

  it('applies the same limits as choosing: type, size and count, with the same errors', () => {
    render(<Picker label="Bills" max={2} />);
    paste(document.body, [shot('notes.txt', 'text/plain')]);
    expect(screen.getByRole('alert')).toHaveTextContent('"notes.txt" can\'t be attached here.');
    paste(document.body, [shot('big.png', 'image/png', 8 * 1024 * 1024 + 1)]);
    expect(screen.getByRole('alert')).toHaveTextContent('"big.png" is too large (8 MB maximum).');
    paste(document.body, [shot('a.png'), shot('b.png'), shot('c.png')]);
    expect(screen.getByRole('alert')).toHaveTextContent('up to 2 files');
    paste(document.body, [shot('a.png'), shot('b.png')]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(attached('Bills')).toBe('a.pngb.png');
  });

  it('a one-file picker: a second paste replaces the first', () => {
    render(<Picker label="Photo" max={1} />);
    paste(document.body, [shot('first.png')]);
    paste(document.body, [shot('second.png')]);
    expect(attached('Photo')).toBe('second.png');
  });

  it('honours a larger size limit when the picker sets one', () => {
    render(<Picker label="Photo" max={1} maxBytes={Infinity} />);
    paste(document.body, [shot('big.png', 'image/png', 9 * 1024 * 1024)]);
    expect(attached('Photo')).toBe('big.png');
  });

  it('never takes text pasted into a text field', () => {
    render(<form><input aria-label="Courier" /><Picker label="Photo" /></form>);
    const event = paste(screen.getByLabelText('Courier'), [], 'Delhivery');
    expect(event).toBe(true); // not prevented: the browser pastes the text
    expect(attached('Photo')).toBe('');
  });

  it('leaves a paste a field already handled (the chat composer) alone', () => {
    render(<><textarea aria-label="Message" onPaste={(e) => e.preventDefault()} /><Picker label="Photo" /></>);
    paste(screen.getByLabelText('Message'), [shot()]);
    expect(attached('Photo')).toBe('');
  });
});

describe('which picker a paste is for', () => {
  const twoInOneForm = () => render(
    <form>
      <input aria-label="Amount" />
      <Picker label="Bills" accept={`${IMAGES},application/pdf`} />
      <Picker label="QR" max={1} />
    </form>,
  );

  it('the picker the focus is in', () => {
    twoInOneForm();
    paste(screen.getByLabelText('QR'), [shot('qr.png')]);
    expect(attached('QR')).toBe('qr.png');
    expect(attached('Bills')).toBe('');
  });

  it('the picker clicked last, even once the focus has left it', () => {
    twoInOneForm();
    fireEvent.pointerDown(screen.getByText('QR'));
    paste(document.body, [shot('qr.png')]);
    expect(attached('QR')).toBe('qr.png');
  });

  it('otherwise the first picker in the form the focus is in that takes the file', () => {
    twoInOneForm();
    paste(screen.getByLabelText('Amount'), [shot('bill.pdf', 'application/pdf')]);
    expect(attached('Bills')).toBe('bill.pdf');
  });

  it('two pickers in different forms and no hint which: nothing is attached', () => {
    render(<><form><Picker label="A" /></form><form><Picker label="B" /></form></>);
    const event = paste(document.body, [shot()]);
    expect(event).toBe(true);
    expect(attached('A')).toBe('');
    expect(attached('B')).toBe('');
    fireEvent.pointerDown(screen.getByRole('list', { name: 'B files' }));
    paste(document.body, [shot('b.png')]);
    expect(attached('B')).toBe('b.png');
  });

  it('a picker that has gone stops receiving pastes', () => {
    const { unmount } = render(<Picker label="Gone" />);
    unmount();
    expect(paste(document.body, [shot()])).toBe(true);
  });
});
