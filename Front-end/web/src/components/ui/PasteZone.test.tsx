/**
 * Pasting a screenshot into the plain upload areas (PasteZone) and the admin
 * image uploaders: a paste reaches the same handler as a chosen file, only files
 * the area takes get through, text pastes are left alone, and choosing a file
 * still works exactly as before.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PasteZone from './PasteZone';
import ImageUploader from './ImageUploader';
import SingleImageUpload from './SingleImageUpload';
import { __resetPasteZones } from '@/hooks/usePasteFiles';

beforeAll(() => {
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:preview'), revokeObjectURL: jest.fn() });
});
beforeEach(() => __resetPasteZones());

const shot = (name = 'image.png', type = 'image/png', size = 16) => new File([new Uint8Array(size)], name, { type });

function paste(target: Element | Document, files: File[], text?: string) {
  const types = [...(files.length ? ['Files'] : []), ...(text != null ? ['text/plain'] : [])];
  return fireEvent.paste(target, { clipboardData: { files, items: [], types, getData: () => text ?? '' } });
}

describe('PasteZone', () => {
  function Zone({ onFiles, single, disabled }: { onFiles: (f: File[]) => void; single?: boolean; disabled?: boolean }) {
    return (
      <form>
        <input aria-label="Name" />
        <PasteZone accept="image/jpeg,image/png" onFiles={onFiles} single={single} disabled={disabled}>
          <input type="file" aria-label="Photo" accept="image/jpeg,image/png" onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
        </PasteZone>
      </form>
    );
  }

  it('shows the paste hint, and hides it while disabled', () => {
    const { rerender } = render(<Zone onFiles={jest.fn()} />);
    expect(screen.getByText(/or paste a screenshot \(Ctrl\+V\)/)).toBeInTheDocument();
    rerender(<Zone onFiles={jest.fn()} disabled />);
    expect(screen.queryByText(/or paste a screenshot/)).not.toBeInTheDocument();
  });

  it('a screenshot pasted anywhere in the form goes to the handler, renamed', () => {
    const onFiles = jest.fn();
    render(<Zone onFiles={onFiles} />);
    paste(screen.getByLabelText('Name'), [shot()]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0].name).toMatch(/^screenshot-\d{2}-\d{2}-\d{2}\.png$/);
  });

  it('several pasted images all arrive; `single` keeps only the first', () => {
    const many = jest.fn();
    const { unmount } = render(<Zone onFiles={many} />);
    paste(document.body, [shot(), shot('b.png')]);
    expect(many.mock.calls[0][0]).toHaveLength(2);
    unmount();
    const one = jest.fn();
    render(<Zone onFiles={one} single />);
    paste(document.body, [shot(), shot('b.png')]);
    expect(one.mock.calls[0][0]).toHaveLength(1);
  });

  it('text pasted into a field, a file of the wrong type, or a paste while disabled does nothing', () => {
    const onFiles = jest.fn();
    const { rerender } = render(<Zone onFiles={onFiles} />);
    expect(paste(screen.getByLabelText('Name'), [], 'Bosch')).toBe(true);
    paste(document.body, [shot('a.gif', 'image/gif')]);
    rerender(<Zone onFiles={onFiles} disabled />);
    paste(document.body, [shot()]);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('choosing a file still works as before', () => {
    const onFiles = jest.fn();
    render(<Zone onFiles={onFiles} />);
    const f = shot('photo.png');
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [f] } });
    expect(onFiles).toHaveBeenCalledWith([f]);
  });
});

describe('ImageUploader (product, brand, vehicle and blog images)', () => {
  const setup = (props: Partial<React.ComponentProps<typeof ImageUploader>> = {}) => {
    const onFilesChange = jest.fn();
    const { container } = render(<ImageUploader value={[]} onFilesChange={onFilesChange} {...props} />);
    const added = () => (onFilesChange.mock.calls.at(-1)?.[0] ?? []) as File[];
    return { container, added };
  };

  it('a pasted screenshot is added like a chosen one', () => {
    const { added } = setup();
    paste(document.body, [shot()]);
    expect(added().map((f) => f.name)).toEqual([expect.stringMatching(/^screenshot-.*\.png$/)]);
    expect(screen.getByText(/or paste a screenshot/)).toBeInTheDocument();
  });

  it('a pasted image over the size limit gets the same error as a chosen one', () => {
    const big = () => shot('big.png', 'image/png', 4 * 1024 * 1024);
    const { container, added } = setup({ maxFileSizeMB: 3 });
    paste(document.body, [big()]);
    const pastedError = screen.getByRole('alert').textContent;
    expect(pastedError).toMatch(/"big.png" is over 3 MB/);
    expect(added()).toEqual([]);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [big()] } });
    expect(screen.getByRole('alert').textContent).toBe(pastedError);
  });

  it('pastes stop at the slot limit', () => {
    const { added } = setup({ maxFiles: 2 });
    paste(document.body, [shot(), shot('b.png'), shot('c.png')]);
    expect(added().length).toBeLessThanOrEqual(2);
  });

  it('choosing files still works', () => {
    const { container, added } = setup();
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [shot('a.png'), shot('b.png')] } });
    expect(added().map((f) => f.name)).toEqual(['a.png', 'b.png']);
  });
});

describe('SingleImageUpload', () => {
  it('a pasted screenshot is uploaded; while uploading a paste is ignored', () => {
    const onUpload = jest.fn();
    const { rerender } = render(<SingleImageUpload value="" onUpload={onUpload} onRemove={() => {}} />);
    paste(document.body, [shot()]);
    expect(onUpload).toHaveBeenCalledTimes(1);
    rerender(<SingleImageUpload value="" onUpload={onUpload} onRemove={() => {}} uploading />);
    paste(document.body, [shot()]);
    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});
