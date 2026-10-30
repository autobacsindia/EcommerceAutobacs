/**
 * The attachment picker used by every payment and parcel form: several files
 * across several picks, photos or PDFs, the same 20 / 10 MB / 40 MB limits the
 * server applies, and big phone photos shrunk before they are attached.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilePicker from './FilePicker';
import { acceptsFile, isPdf, likelyType, MAX_ATTACHMENTS, PHOTO_ONLY, PHOTO_OR_PDF, shrinkForUpload } from '@/lib/attachments';
import { __resetPasteZones } from '@/hooks/usePasteFiles';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const MB = 1024 * 1024;

function Picker({ max = MAX_ATTACHMENTS, accept = PHOTO_OR_PDF, wrongType }: { max?: number; accept?: string; wrongType?: (f: File) => string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  return (
    <div>
      <FilePicker files={files} onChange={setFiles} max={max} accept={accept} label="Attach screenshot or PDF" icon={null} onError={setError} wrongType={wrongType} />
      <ul aria-label="attached">{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

const pick = (files: File[]) => fireEvent.change(screen.getByLabelText('Attach screenshot or PDF'), { target: { files } });
const attached = () => Array.from(screen.getByRole('list', { name: 'attached' }).children).map((li) => li.textContent);

describe('FilePicker', () => {
  it('says what it takes, then adds each pick to the list — "Add another (n of 20)"', () => {
    render(<Picker />);
    expect(screen.getByText('Up to 20 files — photos or PDFs, 10 MB each.')).toBeInTheDocument();
    pick([file('one.png', 'image/png')]);
    pick([file('statement.pdf', 'application/pdf'), file('two.jpg', 'image/jpeg')]);
    expect(attached()).toEqual(['one.png', 'statement.pdf', 'two.jpg']);
    expect(screen.getByText('Add another (3 of 20)')).toBeInTheDocument();
    expect(screen.getByLabelText('Attach screenshot or PDF')).toHaveAttribute('multiple');
  });

  it('takes twenty, refuses the twenty-first, and hides the button when full', () => {
    render(<Picker />);
    pick(Array.from({ length: 19 }, (_, i) => file(`s${i}.png`, 'image/png')));
    pick([file('s19.png', 'image/png'), file('s20.png', 'image/png')]);
    expect(screen.getByRole('alert')).toHaveTextContent('You can attach up to 20 files here.');
    expect(attached()).toHaveLength(19);
    pick([file('s19.png', 'image/png')]);
    expect(attached()).toHaveLength(20);
    expect(screen.queryByLabelText('Attach screenshot or PDF')).toBeNull();
  });

  it('refuses a file over 10 MB and a batch over 40 MB, keeping what was attached', () => {
    render(<Picker />);
    pick([file('huge.pdf', 'application/pdf', 10 * MB + 1)]);
    expect(screen.getByRole('alert')).toHaveTextContent('"huge.pdf" is too large (10 MB maximum).');
    pick(Array.from({ length: 4 }, (_, i) => file(`p${i}.pdf`, 'application/pdf', 9 * MB)));
    expect(attached()).toHaveLength(4);
    pick([file('p4.pdf', 'application/pdf', 9 * MB)]);
    expect(screen.getByRole('alert')).toHaveTextContent('These files add up to more than 40 MB. Send fewer at a time.');
    expect(attached()).toHaveLength(4);
  });

  it('removes one file', () => {
    render(<Picker />);
    pick([file('a.png', 'image/png'), file('b.pdf', 'application/pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(attached()).toEqual(['b.pdf']);
  });

  /*
    Chrome on Windows always offers "All files" in its file window, so the input's
    `accept` does not stop a wrong file being chosen. Production, 2026-10-30: a
    PDF chosen that way went to the server seven times and came back refused.
  */
  describe('file type — chosen files are checked too, not only pasted ones', () => {
    beforeEach(() => __resetPasteZones());

    it('refuses a chosen file this picker does not take, saying what it does take', () => {
      render(<Picker />);
      pick([file('notes.txt', 'text/plain')]);
      expect(screen.getByRole('alert')).toHaveTextContent('"notes.txt" can\'t be attached here — only a photo (JPG, PNG, WebP) or a PDF.');
      expect(attached()).toEqual([]);
    });

    it('a photo-only picker refuses a PDF, in the words the form gives it', () => {
      render(<Picker max={1} accept={PHOTO_ONLY} wrongType={(f) => `${f.name}: use "Customer already paid" for receipts.`} />);
      pick([file('receipt.pdf', 'application/pdf')]);
      expect(screen.getByRole('alert')).toHaveTextContent('receipt.pdf: use "Customer already paid" for receipts.');
      expect(attached()).toEqual([]);
    });

    it('takes a real PDF whatever Windows labels it, and a photo with an old-style label', () => {
      render(<Picker />);
      pick([file('receipt.pdf', 'application/x-pdf'), file('Statement.PDF', 'application/octet-stream'), file('no-label.pdf', ''), file('cam.jpg', 'image/pjpeg')]);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(attached()).toEqual(['receipt.pdf', 'Statement.PDF', 'no-label.pdf', 'cam.jpg']);
    });

    it('a pasted PDF goes through the same checks as a chosen one', () => {
      render(<Picker />);
      fireEvent.paste(document.body, { clipboardData: { files: [file('bank.pdf', 'application/pdf')], items: [], types: ['Files'], getData: () => '' } });
      expect(attached()).toEqual(['bank.pdf']);
    });

    it('label rules: likelyType / acceptsFile / isPdf', () => {
      expect(likelyType(file('a.pdf', 'application/x-pdf'))).toBe('application/pdf');
      expect(likelyType(file('a.PDF', 'application/octet-stream'))).toBe('application/pdf');
      expect(likelyType(file('a.jpeg', ''))).toBe('image/jpeg');
      expect(likelyType(file('a.txt', 'application/octet-stream'))).toBe('application/octet-stream');
      // A real label wins over the name: a web page called receipt.pdf is still a web page.
      expect(likelyType(file('receipt.pdf', 'text/html'))).toBe('text/html');
      expect(acceptsFile(file('receipt.pdf', 'text/html'), PHOTO_OR_PDF)).toBe(false);
      expect(acceptsFile(file('a.pdf', 'application/x-pdf'), PHOTO_ONLY)).toBe(false);
      expect(acceptsFile(file('sheet.xlsx', ''), '.xlsx')).toBe(true);
      expect(isPdf(file('x.pdf', ''))).toBe(true);
      expect(isPdf(file('x.png', 'image/png'))).toBe(false);
    });
  });

  describe('shrinking a big phone photo', () => {
    const realBitmap = (global as { createImageBitmap?: unknown }).createImageBitmap;
    let toBlob: jest.SpyInstance;
    let getContext: jest.SpyInstance;
    beforeEach(() => {
      (global as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => ({ width: 4000, height: 3000, close: jest.fn() }));
      getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: jest.fn() } as never);
      toBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
        cb(new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' }));
      });
    });
    afterEach(() => {
      (global as { createImageBitmap?: unknown }).createImageBitmap = realBitmap;
      toBlob.mockRestore();
      getContext.mockRestore();
    });

    it('a 12 MB camera photo becomes a ~0.4 MB JPEG at most 2400 px wide, so it fits', async () => {
      render(<Picker />);
      pick([file('IMG_0001.HEIC.png', 'image/png', 12 * MB)]);
      await waitFor(() => expect(attached()).toEqual(['IMG_0001.HEIC.jpg']));
      expect(screen.queryByRole('alert')).toBeNull();
      const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
      expect([canvas.width, canvas.height]).toEqual([2400, 1800]);
    });

    it('leaves PDFs and small screenshots exactly as they are', async () => {
      const pdf = file('bill.pdf', 'application/pdf', 5 * MB);
      const small = file('shot.png', 'image/png', 900_000);
      expect(await shrinkForUpload(pdf)).toBe(pdf);
      expect(await shrinkForUpload(small)).toBe(small);
      expect(toBlob).not.toHaveBeenCalled();
    });

    it('keeps the original when the browser cannot read the photo', async () => {
      (global as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => { throw new Error('decode'); });
      const photo = file('odd.jpg', 'image/jpeg', 3 * MB);
      expect(await shrinkForUpload(photo)).toBe(photo);
    });
  });
});
