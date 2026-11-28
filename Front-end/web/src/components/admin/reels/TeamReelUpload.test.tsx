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
  expect(await screen.findByRole('alert')).toHaveTextContent("This video format isn't supported");
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
  expect(checkVideoFile(new File(['x'], 'a.gif', { type: 'image/gif' }), { maxBytes: 10 })).toMatch(/record in MP4/);
  expect(checkVideoFile(new File(['x'.repeat(20)], 'a.mp4', { type: 'video/mp4' }), { maxBytes: 10 })).toMatch(/too big/);
  expect(checkVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }), { maxBytes: 10 })).toBeNull();
});

describe('videoTypeOf — the phone videos people actually have', () => {
  const f = (name: string, type: string) => new File(['x'], name, { type });

  it.each([
    ['iPhone camera MOV', 'IMG_0412.MOV', 'video/quicktime', 'video/quicktime'],
    ['iPhone MOV with no label', 'IMG_0412.MOV', '', 'video/quicktime'],
    ['MOV labelled video/mov', 'a.mov', 'video/mov', 'video/quicktime'],
    ['Android camera MP4', 'VID_20261128_101500.mp4', 'video/mp4', 'video/mp4'],
    ['MP4 labelled octet-stream', 'a.mp4', 'application/octet-stream', 'video/mp4'],
    ['MP4 with codecs in the label', 'a.mp4', 'video/mp4; codecs="avc1.42E01E"', 'video/mp4'],
    ['M4V', 'a.m4v', 'video/x-m4v', 'video/x-m4v'],
    ['Android 3GP', 'VID_0001.3gp', 'video/3gpp', 'video/3gpp'],
    ['3GP labelled audio/3gpp', 'VID_0001.3gp', 'audio/3gpp', 'video/3gpp'],
    ['3G2 with no label', 'clip.3g2', '', 'video/3gpp2'],
  ])('takes %s', (_l, name, type, want) => {
    expect(videoTypeOf(f(name, type))).toBe(want);
  });

  it.each([
    ['WebM (Android screen recorder)', 'a.webm', 'video/webm'],
    ['MKV', 'a.mkv', 'video/x-matroska'],
    ['MKV with no label', 'a.mkv', ''],
    ['AVI', 'a.avi', 'video/x-msvideo'],
    ['an HTML page renamed .mp4', 'a.mp4', 'text/html'],
    ['an .exe', 'a.exe', ''],
    ['a file with no name or label', 'clip', ''],
  ])('refuses %s (cannot play on every phone)', (_l, name, type) => {
    expect(videoTypeOf(f(name, type))).toBeNull();
  });
});

it.each(['a.webm', 'a.mkv', 'a.avi'])('picking %s shows the plain-English message, not a crash', async (name) => {
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [new File(['x'], name, { type: '' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent("This video format isn't supported — please record in MP4 or choose a different video.");
  expect(postMock).not.toHaveBeenCalled();
});

it('the file picker offers 3GP as well as MP4/MOV', () => {
  renderUpload();
  const accept = screen.getByLabelText('Video').getAttribute('accept') ?? '';
  for (const t of ['video/mp4', 'video/quicktime', 'video/3gpp', '.mov', '.3gp']) expect(accept).toContain(t);
});

it('a server refusal of the signature (e.g. 400 unsupported) is a friendly message, never an uncaught error', async () => {
  postMock.mockRejectedValue(Object.assign(new Error("This video format isn't supported — please record in MP4 or choose a different video."), { status: 400 }));
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("isn't supported");
  expect(uploadMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Publish reel' })).toBeEnabled();
});

it('an error with no message still shows a sentence', async () => {
  postMock.mockRejectedValue({});
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload the reel. Please try again.');
});

it('when the server refuses the stored video (HEVC), the next try uploads again instead of re-sending a deleted key', async () => {
  let saveCalls = 0;
  postMock.mockImplementation((url: string) => {
    if (url === '/reels/upload-signature') return Promise.resolve(SIG);
    saveCalls += 1;
    return saveCalls === 1
      ? Promise.reject(Object.assign(new Error('This video uses a format not every phone can play'), { status: 400 }))
      : Promise.resolve({ id: 'r9' });
  });
  uploadMock.mockResolvedValue({ publicId: 'reels/abc123' });
  renderUpload();
  fireEvent.change(screen.getByLabelText('Video'), { target: { files: [video()] } });
  await pickProduct();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not every phone can play');
  fireEvent.click(screen.getByRole('button', { name: 'Publish reel' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Reel published');
  expect(uploadMock).toHaveBeenCalledTimes(2);
});

describe('readVideoDuration', () => {
  const { readVideoDuration } = jest.requireActual<typeof VideoUpload>('./videoUpload');
  afterEach(() => jest.useRealTimers());

  it('never hangs: gives up (null) when the browser fires no event for a file it cannot decode', async () => {
    jest.useFakeTimers();
    const p = readVideoDuration(video(), 1000);
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('resolves null (no throw) when the object URL cannot be made', async () => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => { throw new Error('blocked'); });
    await expect(readVideoDuration(video())).resolves.toBeNull();
    URL.createObjectURL = orig;
  });
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
