/**
 * Tests — ImageUploader batch cap vs gallery ceiling.
 *
 * These were ONE number, and that number locked admins out. `maxFiles` caps how
 * many new files a single save may add (mirroring the server's MAX_NEW_IMAGES);
 * `maxTotal` caps how large the gallery may grow. A variable product's gallery is
 * marketing shots PLUS one photo per model, so eleven images is normal — and
 * under the old single cap of 8 the uploader refused every further image on
 * exactly those products.
 *
 * The default (`maxTotal` omitted) must reproduce the old behaviour exactly, or
 * this "fix" silently loosens the limit on brands and vehicles too.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageUploader, { type CloudinaryImage } from './ImageUploader';

// jsdom implements neither of these; the uploader calls both to preview a picked
// file. Without the stub every test fails on the preview, not on the cap.
beforeAll(() => {
  Object.assign(URL, {
    createObjectURL: jest.fn(() => 'blob:preview'),
    revokeObjectURL: jest.fn(),
  });
});

const existing = (n: number): CloudinaryImage[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://img.autobacsindia.com/autobacs/products/i${i}.jpg`,
    public_id: `i${i}`,
    alt: `i${i}`,
    isPrimary: i === 0,
  }));

const file = (name = 'new.jpg') =>
  new File([new Uint8Array(16)], name, { type: 'image/jpeg' });

const setup = (props: Partial<React.ComponentProps<typeof ImageUploader>>) => {
  const onFilesChange = jest.fn();
  const { container } = render(
    <ImageUploader value={[]} onFilesChange={onFilesChange} {...props} />
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  // The uploader emits an initial `[]` on mount to sync the parent. Assert on the
  // files that actually got through rather than on call counts, so that baseline
  // does not have to be threaded into every expectation.
  const accepted = () => onFilesChange.mock.calls.flatMap(([f]) => f ?? []);
  return { onFilesChange, accepted, input };
};

describe('gallery ceiling', () => {
  test('a gallery past the batch cap still accepts new images', () => {
    // 11 images: 4 marketing + 7 model photos. The old single cap refused this.
    const { accepted, input } = setup({
      value: existing(11), maxFiles: 8, maxTotal: 40,
    });

    fireEvent.change(input, { target: { files: [file()] } });

    expect(accepted()).toHaveLength(1);
    expect(screen.queryByText(/at most/i)).not.toBeInTheDocument();
  });

  test('the ceiling still bites, and the message names the real limit', () => {
    const { accepted, input } = setup({
      value: existing(40), maxFiles: 8, maxTotal: 40,
    });

    fireEvent.change(input, { target: { files: [file()] } });

    expect(accepted()).toHaveLength(0);
    // Not "at most 8 images" — that reads as a bug on a gallery of forty.
    expect(screen.getByText(/already has 40 of 40 images/i)).toBeInTheDocument();
  });

  test('the batch cap still limits ONE save, so the server never truncates', () => {
    const { accepted, input } = setup({
      value: existing(11), maxFiles: 8, maxTotal: 40,
    });

    fireEvent.change(input, {
      target: { files: Array.from({ length: 10 }, (_, i) => file(`f${i}.jpg`)) },
    });

    expect(accepted()).toHaveLength(8);
    expect(screen.getByText(/extra files were skipped/i)).toBeInTheDocument();
  });
});

describe('default behaviour is unchanged', () => {
  test('omitting maxTotal reproduces the old single-cap behaviour', () => {
    // The brands/vehicles shape: maxFiles={1} with an image already present.
    const { accepted, input } = setup({ value: existing(1), maxFiles: 1 });

    fireEvent.change(input, { target: { files: [file()] } });

    expect(accepted()).toHaveLength(0);
    expect(screen.getByText(/at most 1 image/i)).toBeInTheDocument();
  });

  test('an empty single-slot uploader still accepts exactly one', () => {
    const { accepted, input } = setup({ value: [], maxFiles: 1 });

    fireEvent.change(input, { target: { files: [file()] } });

    expect(accepted()).toHaveLength(1);
  });
});
