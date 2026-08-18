import { getActivePromoBanner } from './promoBanner';

jest.mock('./server-api', () => ({
  __esModule: true,
  serverFetch: jest.fn(),
}));
import { serverFetch } from './server-api';

const mockFetch = serverFetch as jest.Mock;

const CDN = 'https://res.cloudinary.com/demo/image/upload/v1/autobacs/promo-banners';

const BANNER = {
  id: 'b1',
  imageUrl: `${CDN}/onam-desktop.jpg`,
  imageWidth: 3840,
  imageHeight: 256,
  tabletImageUrl: `${CDN}/onam-tablet.jpg`,
  tabletImageWidth: 2048,
  tabletImageHeight: 256,
  mobileImageUrl: `${CDN}/onam-mobile.jpg`,
  mobileImageWidth: 1280,
  mobileImageHeight: 320,
  alt: 'Onam offer is live',
  linkPath: '/offers',
};

describe('getActivePromoBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the live banner', async () => {
    mockFetch.mockResolvedValue({ success: true, banner: BANNER });
    await expect(getActivePromoBanner()).resolves.toEqual(BANNER);
  });

  it('returns null when nothing is scheduled', async () => {
    mockFetch.mockResolvedValue({ success: true, banner: null });
    await expect(getActivePromoBanner()).resolves.toBeNull();
  });

  it('degrades to null when the backend is unreachable', async () => {
    // This is mounted in the ROOT LAYOUT. A throw here is not recoverable by the
    // page below it, so a backend blip would take down every route on the site —
    // for a decorative strip. It must fail closed, not loud.
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getActivePromoBanner()).resolves.toBeNull();
  });

  it('degrades to null on a malformed response body', async () => {
    mockFetch.mockResolvedValue(undefined);
    await expect(getActivePromoBanner()).resolves.toBeNull();
  });

  it('tags the fetch so an admin toggle can purge it on demand', async () => {
    mockFetch.mockResolvedValue({ success: true, banner: BANNER });
    await getActivePromoBanner();

    // Without this tag the strip would serve stale until its revalidate window
    // expired — a finished campaign still advertising itself for minutes.
    expect(mockFetch).toHaveBeenCalledWith(
      '/promo-banners/active',
      expect.objectContaining({ next: expect.objectContaining({ tags: ['promo:banner'] }) }),
    );
  });
});
