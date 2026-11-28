import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TrackOrderPage from './page';
import trackingService from '@/services/trackingService';

const push = jest.fn();
let params = new URLSearchParams('number=AWB1234567890');

jest.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push }),
}));

jest.mock('@/services/trackingService', () => ({
  __esModule: true,
  default: {
    trackByNumber: jest.fn(),
    validateTrackingNumber: jest.fn(() => ({ valid: true })),
  },
}));

const trackByNumber = trackingService.trackByNumber as jest.Mock;

const response = (over: Record<string, unknown> = {}) => ({
  success: true,
  trackingNumber: 'AWB1234567890',
  carrier: { name: 'Delhivery', code: 'DELHIVERY', trackingUrl: '' },
  currentStatus: 'shipped',
  estimatedDelivery: '2026-11-30T00:00:00.000Z',
  destination: { city: 'Pune', state: 'MH', postalCode: '411001' },
  events: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  params = new URLSearchParams('number=AWB1234567890');
});

describe('/track — order moment card', () => {
  it('shows the server-chosen picture above the order details and timeline', async () => {
    trackByNumber.mockResolvedValue(response({ moment: { key: 'shipped' } }));
    render(<TrackOrderPage />);

    const card = await screen.findByTestId('order-moment');
    expect(card).toHaveAttribute('data-moment', 'shipped');
    expect(screen.getByTestId('order-moment-title')).toHaveTextContent(/on the road to you/i);
    // Top of the result: before the "Order Details" card.
    const details = screen.getByRole('heading', { name: 'Order Details' });
    expect(card.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a refunded order says refunded without any amount', async () => {
    trackByNumber.mockResolvedValue(response({ currentStatus: 'delivered', moment: { key: 'refunded' } }));
    render(<TrackOrderPage />);

    const card = await screen.findByTestId('order-moment');
    expect(card).toHaveAttribute('data-moment', 'refunded');
    expect(screen.getByTestId('order-moment-body')).toHaveTextContent('We have refunded your payment.');
    // The words, not the drawing (its decorative ₹ coins are aria-hidden).
    expect(card.querySelector('[role="status"]')!.textContent).not.toMatch(/₹|\d{3,}/);
  });

  it('late + parcel with the courier words it as with the courier', async () => {
    trackByNumber.mockResolvedValue(response({ moment: { key: 'late', late: { dueDay: '2026-11-20' } } }));
    render(<TrackOrderPage />);
    expect(await screen.findByTestId('order-moment-body')).toHaveTextContent(/with the courier/i);
  });

  it('no moment from the server → no card, tracking still shows', async () => {
    trackByNumber.mockResolvedValue(response({ moment: null }));
    render(<TrackOrderPage />);
    await screen.findByRole('heading', { name: 'Order Details' });
    expect(screen.queryByTestId('order-moment')).toBeNull();
  });

  it('an older backend without `moment` → no card', async () => {
    trackByNumber.mockResolvedValue(response());
    render(<TrackOrderPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Order Details' })).toBeInTheDocument());
    expect(screen.queryByTestId('order-moment')).toBeNull();
  });
});
