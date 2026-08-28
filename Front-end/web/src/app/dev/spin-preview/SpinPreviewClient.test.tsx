/**
 * The preview harness. Two properties matter here and neither is cosmetic:
 *
 *  1. It shows the campaign's REAL prizes when opened from the admin, otherwise the
 *     preview would be reassuring about artwork nobody has actually uploaded.
 *  2. It shows only ACTIVE prizes, because an inactive prize can never appear on a real
 *     wheel — previewing one would be a lie about what customers will see.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SpinPreviewClient from './SpinPreviewClient';
import apiClient from '@/lib/api';
import { useSearchParams } from 'next/navigation';

jest.mock('@/lib/api', () => ({ get: jest.fn() }));
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

const mockGet = apiClient.get as jest.Mock;
const mockParams = useSearchParams as unknown as jest.Mock;

const prize = (over: Partial<Record<string, unknown>> = {}) => ({
  _id: 'p1', campaign: 'c1', kind: 'goodie', name: 'Autobacs Cap', sku: null,
  shortLabel: 'Cap', imageUrl: 'https://cdn.test/cap.png', active: true,
  stockTotal: 10, stockRemaining: 10, stockAwarded: 0, weightMode: 'stock',
  manualWeight: 0, weightFactor: 1, minOrderValuePaise: 0, maxWinsPerDay: null,
  isFloorPrize: false, couponPrefix: '', couponType: 'fixed', couponValue: 0,
  couponMaxDiscount: null, couponMinCartValue: 0, couponValidDays: 30,
  karmaPoints: 0, sortOrder: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.mockReturnValue(new URLSearchParams());
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }),
  });
});

describe('SpinPreviewClient', () => {
  it('renders a sample wheel when no campaign is selected, without calling the API', async () => {
    render(<SpinPreviewClient />);
    // Assert sample MODE, not a specific label: the wheel takes a random subset of the
    // sample pool, so naming one prize would be a coin-flip test.
    expect(await screen.findByText('sample prizes')).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('renders the campaign’s real prizes when opened from the admin', async () => {
    mockParams.mockReturnValue(new URLSearchParams('campaign=c1'));
    mockGet.mockImplementation((url: string) =>
      url.includes('/prizes')
        ? Promise.resolve({ prizes: [prize(), prize({ _id: 'p2', shortLabel: 'Mug' })] })
        : Promise.resolve({ campaigns: [{ _id: 'c1', name: 'Diwali Spin', segmentCount: 6 }] }));

    render(<SpinPreviewClient />);
    // findAll, not find: a pool smaller than the wheel is cycled to fill the slices, so
    // a prize legitimately appears on more than one wedge.
    expect((await screen.findAllByText('Cap')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mug').length).toBeGreaterThan(0);
    // The sample data must be gone — otherwise a real campaign would be shown padded
    // out with prizes that do not exist.
    expect(screen.queryByText('Autobacs Tee')).not.toBeInTheDocument();
  });

  it('never previews an inactive prize', async () => {
    mockParams.mockReturnValue(new URLSearchParams('campaign=c1'));
    mockGet.mockImplementation((url: string) =>
      url.includes('/prizes')
        ? Promise.resolve({ prizes: [prize(), prize({ _id: 'p2', shortLabel: 'Retired', active: false })] })
        : Promise.resolve({ campaigns: [{ _id: 'c1', name: 'Diwali Spin', segmentCount: 4 }] }));

    render(<SpinPreviewClient />);
    expect((await screen.findAllByText('Cap')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Retired')).not.toBeInTheDocument();
  });

  it('falls back to the sample wheel when the admin fetch is refused', async () => {
    // A non-admin who guesses the URL gets a 401 here. They must see the harmless
    // sample wheel and an explanation, never a blank screen or prize data.
    mockParams.mockReturnValue(new URLSearchParams('campaign=c1'));
    mockGet.mockRejectedValue(new Error('401'));

    render(<SpinPreviewClient />);
    expect(await screen.findByText(/Sign in as an admin/i)).toBeInTheDocument();
    expect(screen.getByText('sample prizes')).toBeInTheDocument();
  });

  it('states plainly that this is not a real spin', async () => {
    render(<SpinPreviewClient />);
    expect(await screen.findByText(/not a real spin/i)).toBeInTheDocument();
  });
});
