/**
 * When the wheel puts itself in front of the customer.
 *
 * This sits on the ORDER CONFIRMATION page, so every case here is really the same
 * question: does the game get in the way of the receipt? A dialog that opens on a
 * payment that has not confirmed, or that reappears on every visit to an order that was
 * already spun, is worse than no dialog.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import SpinSection, { PRIZE_DISCLAIMER } from './SpinSection';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({ get: jest.fn(), post: jest.fn() }));
const mockGet = apiClient.get as jest.Mock;

const segments = [
  { id: 'a', shortLabel: 'Cap', name: 'Cap', imageUrl: null },
  { id: 'b', shortLabel: 'Mug', name: 'Mug', imageUrl: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }),
  });
});
afterEach(() => { document.body.style.overflow = ''; });

describe('SpinSection presentation', () => {
  it('opens the dialog by itself when a spin is on offer', async () => {
    mockGet.mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does NOT open while the payment is still confirming', async () => {
    // A dialog saying "confirming your payment" over a confirmation page reads as
    // something having gone wrong with the payment.
    mockGet.mockResolvedValue({ success: true, eligible: false, pending: true });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByText(/Confirming your payment/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does NOT open for an order that was already spun', async () => {
    // Every later visit to this order would otherwise throw a dialog at someone who
    // already has their prize.
    mockGet.mockResolvedValue({
      success: true, eligible: false, alreadySpun: true,
      result: { prize: { name: 'Cap', sku: null, kind: 'goodie', imageUrl: null }, segmentIndex: 0, segmentLabels: ['Cap', 'Mug'], status: 'granted' },
    });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByText(/You won/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be reopened from the card after being dismissed', async () => {
    // The card is the only way back in — a prize you can permanently lose sight of by
    // pressing Escape would be worse than no prize.
    mockGet.mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Spin now/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not reopen itself after the customer dismissed it', async () => {
    mockGet.mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Give any pending effect a chance to re-fire. A dialog that comes back on its own
    // is a dark pattern, not a feature.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('waiting for the webhook', () => {
    // The order is not paid when this page renders — verify-payment writes nothing, the
    // webhook does. So how fast the wheel appears after the money is confirmed is decided
    // entirely by this poll cadence.
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const flush = async () => { await act(async () => { await Promise.resolve(); }); };

    it('re-checks within about a second while the payment is confirming', async () => {
      mockGet.mockResolvedValue({ success: true, eligible: false, pending: true });
      render(<SpinSection orderId="o1" />);
      await flush();
      expect(mockGet).toHaveBeenCalledTimes(1);

      await act(async () => { jest.advanceTimersByTime(1000); });
      await flush();
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('shows the wheel on the first poll after the webhook lands', async () => {
      mockGet
        .mockResolvedValueOnce({ success: true, eligible: false, pending: true })
        .mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });

      render(<SpinSection orderId="o1" />);
      await flush();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await act(async () => { jest.advanceTimersByTime(1000); });
      await flush();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('backs off instead of hammering when the webhook is slow', async () => {
      mockGet.mockResolvedValue({ success: true, eligible: false, pending: true });
      render(<SpinSection orderId="o1" />);
      await flush();

      // Drive past the fast phase.
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { jest.advanceTimersByTime(1000); });
        await flush();
      }
      const afterFastPhase = mockGet.mock.calls.length;

      // A further 4s in the slow phase must NOT produce 4 more requests.
      await act(async () => { jest.advanceTimersByTime(4000); });
      await flush();
      expect(mockGet.mock.calls.length).toBeLessThan(afterFastPhase + 4);
    });

    it('eventually gives up rather than polling forever', async () => {
      mockGet.mockResolvedValue({ success: true, eligible: false, pending: true });
      const { container } = render(<SpinSection orderId="o1" />);
      await flush();

      for (let i = 0; i < 60; i += 1) {
        await act(async () => { jest.advanceTimersByTime(5000); });
        await flush();
      }
      // Silent, not an error: the webhook may still land, and returning to this page
      // re-checks from scratch.
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders nothing at all when no spin is on offer', async () => {
    mockGet.mockResolvedValue({ success: true, eligible: false, reason: 'no_campaign' });
    const { container } = render(<SpinSection orderId="o1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  /**
   * The availability/substitution clause.
   *
   * It is standing copy rather than the admin's `terms` field precisely so it cannot be
   * absent — a campaign published with an empty terms box would otherwise show a
   * customer a specific goodie on a wheel with no notice that a substitute may arrive.
   * These tests are what stop it being quietly dropped back into optional admin text.
   */
  describe('prize disclaimer', () => {
    const disclaimerRe = /subject to availability/i;

    it('is shown under the wheel before the customer spins', async () => {
      mockGet.mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });
      render(<SpinSection orderId="o1" />);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(disclaimerRe)).toBeInTheDocument();
    });

    it('names the substitution as equal or greater value', async () => {
      // "Subject to availability" alone tells a customer their prize might not come.
      // What they are owed instead is the part that has to be on screen.
      mockGet.mockResolvedValue({ success: true, eligible: true, segments, campaign: { terms: null } });
      render(<SpinSection orderId="o1" />);
      await screen.findByRole('dialog');
      expect(screen.getByText(/equal or greater value/i)).toBeInTheDocument();
      expect(PRIZE_DISCLAIMER).toMatch(/no cash alternative/i);
    });

    it('is STILL shown after the prize is revealed', async () => {
      // The reveal is exactly when a customer forms an expectation about what arrives,
      // so this is the one phase the disclaimer must not disappear from.
      mockGet.mockResolvedValue({
        success: true, eligible: false, alreadySpun: true,
        campaign: { terms: null },
        result: {
          prize: { name: 'Dashcam', sku: 'D1', kind: 'goodie', imageUrl: null },
          segmentIndex: 0, segmentLabels: ['Dashcam', 'Cap'], status: 'granted',
        },
      });
      render(<SpinSection orderId="o1" />);
      fireEvent.click(await screen.findByRole('button', { name: /View your prize/i }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(disclaimerRe)).toBeInTheDocument();
    });

    it('renders campaign-specific terms ALONGSIDE it, not instead of it', async () => {
      mockGet.mockResolvedValue({
        success: true, eligible: true, segments,
        campaign: { terms: 'Not valid in Tamil Nadu.' },
      });
      render(<SpinSection orderId="o1" />);
      await screen.findByRole('dialog');
      expect(screen.getByText(disclaimerRe)).toBeInTheDocument();
      expect(screen.getByText('Not valid in Tamil Nadu.')).toBeInTheDocument();
    });
  });

  it('keeps the coupon code on the card, not only inside the dialog', async () => {
    // The dialog is transient; the code is the thing the customer actually needs.
    mockGet.mockResolvedValue({
      success: true, eligible: false, alreadySpun: true,
      result: {
        prize: { name: '10% off', sku: null, kind: 'coupon', imageUrl: null, couponCode: 'SPIN-ABC123' },
        segmentIndex: 0, segmentLabels: ['10% off', 'Cap'], status: 'granted',
      },
    });
    render(<SpinSection orderId="o1" />);
    expect(await screen.findByText('SPIN-ABC123')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
