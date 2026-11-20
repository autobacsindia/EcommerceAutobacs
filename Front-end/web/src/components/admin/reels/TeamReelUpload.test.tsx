/**
 * Team reel upload: video goes straight to Cloudflare R2 with the backend's
 * presigned PUT; only { publicId, productId, caption, creatorUserId? } reach our API.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamReelUpload from './TeamReelUpload';
import { checkVideoFile, videoTypeOf, type ReelUploadTarget } from './videoUpload';
import type * as VideoUpload from './videoUpload';

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
    uploadVideoToStorage: (...a: unknown[]) => uploadMock(...a),
  };
});

const SIG: ReelUploadTarget = {
  method: 'PUT', uploadUrl: 'https://bucket.acct.r2.cloudflarestorage.com/autobacs/reels/team/k.mp4?X-Amz-Signature=s',
  headers: { 'Content-Type': 'video/mp4' }, publicId: 'autobacs/reels/team/k.mp4', contentType: 'video/mp4',
  expiresIn: 900, maxBytes: 100 * 1024 * 1024, maxDurationSec: 60,
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
  expect(await screen.findByRole('alert')).toHaveTextContent('MP4 or MOV');
  expect(postMock).not.toHaveBeenCalled();
});

it('uploads to R2 then saves only the ids and caption', async () => {
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
  expect(postMock).toHaveBeenCalledWith('/reels/upload-signature', { team: true, contentType: 'video/mp4', size: 1 });
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

it('videoTypeOf takes MP4/MOV by label, or by extension when the browser gives no label', () => {
  const f = (name: string, type: string) => new File(['x'], name, { type });
  expect(videoTypeOf(f('a.mov', 'video/quicktime'))).toBe('video/quicktime');
  expect(videoTypeOf(f('a.MOV', ''))).toBe('video/quicktime');
  expect(videoTypeOf(f('a.mp4', 'application/octet-stream'))).toBe('video/mp4');
  expect(videoTypeOf(f('a.webm', 'video/webm'))).toBeNull();
  expect(videoTypeOf(f('a.mp4', 'text/html'))).toBeNull();
  expect(videoTypeOf(f('a.exe', ''))).toBeNull();
});

describe('uploadVideoToStorage', () => {
  // The module mock above swaps this out for the component tests; test the real one.
  const { uploadVideoToStorage } = jest.requireActual<typeof VideoUpload>('./videoUpload');
  type FakeXhr = {
    open: jest.Mock; setRequestHeader: jest.Mock; send: jest.Mock; abort: jest.Mock;
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void };
    status: number; onload?: () => void; onerror?: () => void; onabort?: () => void;
  };
  let xhr: FakeXhr;
  const RealXhr = global.XMLHttpRequest;
  beforeEach(() => {
    xhr = { open: jest.fn(), setRequestHeader: jest.fn(), send: jest.fn(), abort: jest.fn(), upload: {}, status: 0 };
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = jest.fn(() => xhr);
  });
  afterEach(() => { global.XMLHttpRequest = RealXhr; });

  it('PUTs the raw file with the signed type and resolves with the key', async () => {
    const file = video();
    const progress = jest.fn();
    const p = uploadVideoToStorage(file, SIG, progress);
    expect(xhr.open).toHaveBeenCalledWith('PUT', SIG.uploadUrl);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(xhr.send).toHaveBeenCalledWith(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(progress).toHaveBeenCalledWith(50);
    xhr.status = 200; xhr.onload?.();
    await expect(p).resolves.toEqual({ publicId: SIG.publicId });
  });

  it('explains an expired link (403) and refuses a non-https target', async () => {
    const p = uploadVideoToStorage(video(), SIG);
    xhr.status = 403; xhr.onload?.();
    await expect(p).rejects.toThrow(/expired/);
    await expect(uploadVideoToStorage(video(), { ...SIG, uploadUrl: 'http://evil.example/x' })).rejects.toThrow(/misconfigured/);
  });
});
