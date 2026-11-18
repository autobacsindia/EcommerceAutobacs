/**
 * Team reel upload: video goes straight to Cloudinary with the backend's
 * signature; only { publicId, productId, caption, creatorUserId? } reach our API.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamReelUpload from './TeamReelUpload';
import { checkVideoFile, signedFields, uploadTarget } from './videoUpload';

const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));

const uploadMock = jest.fn();
const durationMock = jest.fn();
jest.mock('./videoUpload', () => {
  const actual = jest.requireActual('./videoUpload');
  return {
    ...actual,
    readVideoDuration: (...a: unknown[]) => durationMock(...a),
    uploadVideoToCloudinary: (...a: unknown[]) => uploadMock(...a),
  };
});

const SIG = {
  cloudName: 'demo', apiKey: 'k', timestamp: 1, signature: 's', folder: 'reels', resourceType: 'video',
  maxBytes: 100 * 1024 * 1024, maxDurationSec: 60,
};

function renderUpload() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TeamReelUpload /></QueryClientProvider>);
}

const video = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' });

async function pickProduct() {
  getMock.mockResolvedValue({ products: [{ _id: 'p1', name: '70mai Dash Cam A500S', price: 8999, images: [{ url: 'https://res.cloudinary.com/x.jpg' }] }] });
  fireEvent.change(screen.getByPlaceholderText('Search by product name'), { target: { value: 'dash' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: /70mai Dash Cam A500S/ }));
}

beforeAll(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = jest.fn(() => 'blob:preview');
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  uploadMock.mockReset();
  durationMock.mockReset().mockResolvedValue(20);
});

it('needs a video and a product before anything is uploaded', async () => {
  renderUpload();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pick a video first.');

  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tag the product shown in the video.');
  expect(postMock).not.toHaveBeenCalled();
});

it('rejects a non-video file without asking for a signature', async () => {
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('MP4, MOV or WebM');
  expect(postMock).not.toHaveBeenCalled();
});

it('uploads to Cloudinary then saves only the ids and caption', async () => {
  postMock.mockImplementation((url: string) => Promise.resolve(url === '/reels/upload-signature' ? SIG : { id: 'r9', status: 'approved' }));
  uploadMock.mockResolvedValue({ publicId: 'reels/abc123' });
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();
  fireEvent.change(screen.getByPlaceholderText(/dash cam — clear night/), { target: { value: '  Clear at night  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Reel published');
  expect(uploadMock).toHaveBeenCalledTimes(1);
  expect(uploadMock.mock.calls[0][1]).toEqual(SIG);
  expect(postMock).toHaveBeenCalledWith('/reels/upload-signature', { team: true });
  expect(postMock).toHaveBeenCalledWith('/admin/reels', { publicId: 'reels/abc123', productId: 'p1', caption: 'Clear at night' });
});

it('blocks a clip longer than the limit before uploading', async () => {
  postMock.mockResolvedValue(SIG);
  durationMock.mockResolvedValue(95);
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('up to 60 seconds');
  expect(uploadMock).not.toHaveBeenCalled();
});

it('retrying after a failed save does not upload the video twice', async () => {
  let saveCalls = 0;
  postMock.mockImplementation((url: string) => {
    if (url === '/reels/upload-signature') return Promise.resolve(SIG);
    saveCalls += 1;
    return saveCalls === 1 ? Promise.reject(new Error('Server busy')) : Promise.resolve({ id: 'r9' });
  });
  uploadMock.mockResolvedValue({ publicId: 'reels/abc123' });
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();

  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server busy');
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Reel published');
  await waitFor(() => expect(saveCalls).toBe(2));
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

it('checkVideoFile enforces type and size', () => {
  expect(checkVideoFile(new File(['x'], 'a.gif', { type: 'image/gif' }), { maxBytes: 10 })).toMatch(/MP4/);
  expect(checkVideoFile(new File(['x'.repeat(20)], 'a.mp4', { type: 'video/mp4' }), { maxBytes: 10 })).toMatch(/too big/);
  expect(checkVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }), { maxBytes: 10 })).toBeNull();
});

it('sends every signed param verbatim and only posts to Cloudinary', () => {
  const params = { allowed_formats: 'mp4,mov,webm', eager: 'sp_auto', eager_async: 'true', folder: 'reels/team', timestamp: '1' };
  expect(signedFields({ folder: 'x', timestamp: 9, params })).toEqual(Object.entries(params));
  // Bare contract shape (no params) falls back to folder + timestamp.
  expect(signedFields({ folder: 'reels', timestamp: 9 })).toEqual([['folder', 'reels'], ['timestamp', '9']]);

  expect(uploadTarget({ cloudName: 'demo', uploadUrl: 'https://api.cloudinary.com/v1_1/demo/video/upload' })).toBe('https://api.cloudinary.com/v1_1/demo/video/upload');
  expect(uploadTarget({ cloudName: 'demo', uploadUrl: 'https://evil.example.com/upload' })).toBe('https://api.cloudinary.com/v1_1/demo/video/upload');
});
