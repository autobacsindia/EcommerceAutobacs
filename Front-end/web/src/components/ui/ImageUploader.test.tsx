/**
 * ImageUploader — gallery sequencing + removal
 *
 * These cover the contract the admin product forms depend on: the component is
 * the only place that knows the final display order, and the order it publishes
 * is what gets sent to the server as `imageOrder` / `primaryImage`. If that
 * publishing drifts, images silently save in the wrong sequence with no error.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageUploader, { CloudinaryImage, GalleryItem } from './ImageUploader';

// next/image needs a plain <img> in jsdom (no loader/optimizer available).
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const IMAGES: CloudinaryImage[] = [
  { url: 'https://cdn/a.jpg', public_id: 'pid-a', alt: 'A', isPrimary: true },
  { url: 'https://cdn/b.jpg', public_id: 'pid-b', alt: 'B' },
  { url: 'https://cdn/c.jpg', public_id: 'pid-c', alt: 'C' },
];

/** Keys of the gallery, in rendered order, from the last publish. */
const keysOf = (calls: GalleryItem[][]) => (calls.at(-1) ?? []).map((i) => i.key);

const renderUploader = (props: Partial<React.ComponentProps<typeof ImageUploader>> = {}) => {
  const onGalleryChange = jest.fn();
  const utils = render(
    <ImageUploader
      value={IMAGES}
      onGalleryChange={onGalleryChange}
      {...props}
    />,
  );
  return { ...utils, onGalleryChange, calls: onGalleryChange.mock.calls.map((c) => c[0]) };
};

describe('ImageUploader — sequencing', () => {
  it('publishes existing images in their stored order', () => {
    const { onGalleryChange } = renderUploader();
    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-a', 'pid-b', 'pid-c']);
  });

  it('moves an image later with the → button and republishes the new order', () => {
    const { onGalleryChange } = renderUploader();

    fireEvent.click(screen.getByLabelText('Move image 1 later'));

    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-b', 'pid-a', 'pid-c']);
  });

  it('moves an image earlier with the ← button', () => {
    const { onGalleryChange } = renderUploader();

    fireEvent.click(screen.getByLabelText('Move image 3 earlier'));

    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-a', 'pid-c', 'pid-b']);
  });

  it('disables ← on the first tile and → on the last', () => {
    renderUploader();
    expect(screen.getByLabelText('Move image 1 earlier')).toBeDisabled();
    expect(screen.getByLabelText('Move image 3 later')).toBeDisabled();
  });

  it('reorders by dragging one tile onto another', () => {
    const { onGalleryChange } = renderUploader();

    const first = screen.getByTestId('gallery-item-0');
    const third = screen.getByTestId('gallery-item-2');

    fireEvent.dragStart(first);
    fireEvent.dragOver(third);
    fireEvent.drop(third);

    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-b', 'pid-c', 'pid-a']);
  });

  it('renumbers the position badges after a move', () => {
    renderUploader();
    fireEvent.click(screen.getByLabelText('Move image 1 later'));

    // The tile now sitting first must be B, and it must read "1".
    const firstTile = screen.getByTestId('gallery-item-0');
    expect(within(firstTile).getByAltText('B')).toBeInTheDocument();
    expect(within(firstTile).getByText('1')).toBeInTheDocument();
  });

  it('hides reorder controls when reorderable is false', () => {
    renderUploader({ reorderable: false });
    expect(screen.queryByLabelText('Move image 1 later')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Set image 1 as primary')).not.toBeInTheDocument();
  });
});

describe('ImageUploader — primary selection', () => {
  it('marks the controlled primaryKey, not merely the first tile', () => {
    renderUploader({ primaryKey: 'pid-b' });

    const secondTile = screen.getByTestId('gallery-item-1');
    expect(within(secondTile).getByText('Primary')).toBeInTheDocument();
    expect(screen.getByLabelText('Set image 2 as primary')).toBeDisabled();
  });

  it('reports the chosen key when the star is clicked', () => {
    const onPrimaryChange = jest.fn();
    renderUploader({ primaryKey: 'pid-a', onPrimaryChange });

    fireEvent.click(screen.getByLabelText('Set image 3 as primary'));

    expect(onPrimaryChange).toHaveBeenCalledWith('pid-c');
  });

  it('falls back to the first tile when primaryKey names a missing image', () => {
    // e.g. the starred image was just removed — something must still be primary,
    // or the product renders with no thumbnail anywhere downstream.
    renderUploader({ primaryKey: 'pid-gone' });

    const firstTile = screen.getByTestId('gallery-item-0');
    expect(within(firstTile).getByText('Primary')).toBeInTheDocument();
  });

  it('keeps the primary marker on its image after reordering', () => {
    renderUploader({ primaryKey: 'pid-c' });
    fireEvent.click(screen.getByLabelText('Move image 3 earlier'));

    // C moved to slot 2 and keeps the star — order and primary are independent.
    const secondTile = screen.getByTestId('gallery-item-1');
    expect(within(secondTile).getByAltText('C')).toBeInTheDocument();
    expect(within(secondTile).getByText('Primary')).toBeInTheDocument();
  });
});

describe('ImageUploader — removal', () => {
  it('reports the public_id and index of a removed existing image', () => {
    const onRemoveExisting = jest.fn();
    renderUploader({ onRemoveExisting });

    fireEvent.click(screen.getByLabelText('Remove image 2'));

    expect(onRemoveExisting).toHaveBeenCalledWith('pid-b', 1);
  });

  it('reports the ORIGINAL index of a removed image after reordering', () => {
    // The parent splices `existingImages` by index, so a stale index would
    // delete the wrong image — the exact class of bug that leaves a live URL
    // pointing at a deleted Cloudinary asset.
    const onRemoveExisting = jest.fn();
    renderUploader({ onRemoveExisting });

    fireEvent.click(screen.getByLabelText('Move image 1 later')); // → b, a, c
    fireEvent.click(screen.getByLabelText('Remove image 1'));     // removes b

    expect(onRemoveExisting).toHaveBeenCalledWith('pid-b', 1);
  });

  it('reports a migrated image by URL when it has no public_id', () => {
    // Reporting an empty public_id would stage a removal the server can never
    // match, so the tile would silently reappear on the next load.
    const onRemoveExisting = jest.fn();
    const legacy: CloudinaryImage[] = [
      { url: 'https://autobacsindia.com/wp-content/legacy.jpg', public_id: '', alt: 'L' },
      ...IMAGES,
    ];
    render(<ImageUploader value={legacy} onRemoveExisting={onRemoveExisting} />);

    fireEvent.click(screen.getByLabelText('Remove image 1'));

    expect(onRemoveExisting).toHaveBeenCalledWith(
      'https://autobacsindia.com/wp-content/legacy.jpg',
      0,
    );
  });

  it('drops a removed image from the published gallery', () => {
    const onGalleryChange = jest.fn();
    const { rerender } = render(
      <ImageUploader value={IMAGES} onGalleryChange={onGalleryChange} />,
    );

    // Parent removes B from `value`, as the edit page does on remove.
    rerender(
      <ImageUploader
        value={IMAGES.filter((i) => i.public_id !== 'pid-b')}
        onGalleryChange={onGalleryChange}
      />,
    );

    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-a', 'pid-c']);
  });

  it('preserves the order of surviving images when one is removed', () => {
    const onGalleryChange = jest.fn();
    const { rerender } = render(
      <ImageUploader value={IMAGES} onGalleryChange={onGalleryChange} />,
    );

    fireEvent.click(screen.getByLabelText('Move image 3 earlier')); // → a, c, b
    rerender(
      <ImageUploader
        value={IMAGES.filter((i) => i.public_id !== 'pid-a')}
        onGalleryChange={onGalleryChange}
      />,
    );

    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-c', 'pid-b']);
  });

  it('does not republish when the parent re-renders with an equivalent value', () => {
    // The edit page passes an inline array; republishing on identity would
    // drive parent state updates in a loop.
    const onGalleryChange = jest.fn();
    const { rerender } = render(
      <ImageUploader value={[...IMAGES]} onGalleryChange={onGalleryChange} />,
    );
    const before = onGalleryChange.mock.calls.length;

    rerender(<ImageUploader value={[...IMAGES]} onGalleryChange={onGalleryChange} />);

    expect(onGalleryChange.mock.calls.length).toBe(before);
  });
});

describe('ImageUploader — new files', () => {
  const file = (name: string) =>
    new File(['x'], name, { type: 'image/jpeg' });

  beforeAll(() => {
    // jsdom has no object-URL support.
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
  });

  it('appends picked files to the gallery and reports them in order', () => {
    const onFilesChange = jest.fn();
    const onGalleryChange = jest.fn();
    const { container } = render(
      <ImageUploader
        value={IMAGES}
        onFilesChange={onFilesChange}
        onGalleryChange={onGalleryChange}
        maxTotalSizeMB={Infinity}
      />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('one.jpg'), file('two.jpg')] } });

    const published = onGalleryChange.mock.calls.at(-1)![0] as GalleryItem[];
    expect(published).toHaveLength(5);
    expect(published.slice(3).map((i) => i.kind)).toEqual(['new', 'new']);
    expect(onFilesChange.mock.calls.at(-1)![0].map((f: File) => f.name))
      .toEqual(['one.jpg', 'two.jpg']);
  });

  it('reports new files in gallery order after a reorder', () => {
    // The parent uploads these files in the reported order and maps refs back
    // positionally — a mismatch here silently mis-assigns every public_id.
    const onFilesChange = jest.fn();
    const { container } = render(
      <ImageUploader value={[]} onFilesChange={onFilesChange} maxTotalSizeMB={Infinity} />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('one.jpg'), file('two.jpg')] } });
    fireEvent.click(screen.getByLabelText('Move image 2 earlier'));

    expect(onFilesChange.mock.calls.at(-1)![0].map((f: File) => f.name))
      .toEqual(['two.jpg', 'one.jpg']);
  });

  it('lets a new image be sequenced ahead of existing ones', () => {
    const onGalleryChange = jest.fn();
    const { container } = render(
      <ImageUploader value={IMAGES} onGalleryChange={onGalleryChange} maxTotalSizeMB={Infinity} />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('one.jpg')] } });
    fireEvent.click(screen.getByLabelText('Move image 4 earlier'));
    fireEvent.click(screen.getByLabelText('Move image 3 earlier'));
    fireEvent.click(screen.getByLabelText('Move image 2 earlier'));

    const published = onGalleryChange.mock.calls.at(-1)![0] as GalleryItem[];
    expect(published[0].kind).toBe('new');
    expect(published.slice(1).map((i) => i.key)).toEqual(['pid-a', 'pid-b', 'pid-c']);
  });

  it('removes a pending file without touching existing images', () => {
    const onRemoveExisting = jest.fn();
    const onGalleryChange = jest.fn();
    const { container } = render(
      <ImageUploader
        value={IMAGES}
        onRemoveExisting={onRemoveExisting}
        onGalleryChange={onGalleryChange}
        maxTotalSizeMB={Infinity}
      />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('one.jpg')] } });
    fireEvent.click(screen.getByLabelText('Remove image 4'));

    expect(onRemoveExisting).not.toHaveBeenCalled();
    expect(keysOf(onGalleryChange.mock.calls.map((c) => c[0]))).toEqual(['pid-a', 'pid-b', 'pid-c']);
  });
});
