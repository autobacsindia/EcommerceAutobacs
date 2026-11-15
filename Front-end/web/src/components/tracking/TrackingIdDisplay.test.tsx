import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import TrackingIdDisplay from './TrackingIdDisplay';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

describe('TrackingIdDisplay', () => {
  it('shows the partner and tracking number, copies the number and says "Copied"', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TrackingIdDisplay partner="VRL" trackingNumber="VRL123" url="https://www.vrlgroup.in/Tracking/TrackShipment" />);

    expect(screen.getByText('VRL')).toBeInTheDocument();
    expect(screen.getByText('VRL123')).toBeInTheDocument();
    const copy = screen.getByRole('button', { name: 'Copy tracking number VRL123' });
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith('VRL123');
    expect(toast.success).toHaveBeenCalledWith('Copied tracking number VRL123', expect.anything());
    expect(copy).toHaveAttribute('title', 'Copied');
  });

  it('opens the partner page in a new tab, with noopener noreferrer', () => {
    render(<TrackingIdDisplay partner="DTDC" trackingNumber="D1" url="https://www.dtdc.com/track-your-shipment/" />);
    const link = screen.getByRole('link', { name: /Open DTDC's tracking page/ });
    expect(link).toHaveAttribute('href', 'https://www.dtdc.com/track-your-shipment/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', '//evil.example.com', 'not a url'])('never links %s', (url) => {
    render(<TrackingIdDisplay partner="X" trackingNumber="1" url={url} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // The number and copy still work without a link.
    expect(screen.getByRole('button', { name: 'Copy tracking number 1' })).toBeInTheDocument();
  });

  it('reads fine with no partner, no number, or neither (older parcels)', () => {
    const { rerender } = render(<TrackingIdDisplay trackingNumber="ONLY1" />);
    expect(screen.getByText('ONLY1')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<TrackingIdDisplay partner="Ram Transport" />);
    expect(screen.getByText('Ram Transport')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<TrackingIdDisplay />);
    expect(screen.getByText('No tracking details')).toBeInTheDocument();
  });
});
