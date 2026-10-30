/**
 * The attachment picker used by every payment and parcel form: several files
 * across several picks, photos or PDFs, the same 20 / 10 MB / 40 MB limits the
 * server applies, and big phone photos shrunk before they are attached.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilePicker from './FilePicker';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF, shrinkForUpload } from '@/lib/attachments';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const MB = 1024 * 1024;

function Picker({ max = MAX_ATTACHMENTS }: { max?: number }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  return (
    <div>
      <FilePicker files={files} onChange={setFiles} max={max} accept={PHOTO_OR_PDF} label="Attach screenshot or PDF" icon={null} onError={setError} />
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
