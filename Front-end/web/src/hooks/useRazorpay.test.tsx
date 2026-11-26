/**
 * Razorpay checkout options built by useRazorpay.processPayment.
 *
 * The EMI choice must only change WHERE the Razorpay window opens (`prefill.method`).
 * The amount, order id and key must still come from the backend's create-order response
 * — never from the browser — whichever choice the shopper made.
 */
import { renderHook, act } from '@testing-library/react';
import { useRazorpay } from './useRazorpay';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), put: jest.fn() },
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/analytics', () => ({
  trackRazorpayOpened: jest.fn(),
  trackRazorpayDismissed: jest.fn(),
  trackPaymentFailed: jest.fn(),
}));
jest.mock('@/lib/reportClientError', () => ({
  reportClientError: jest.fn(),
  httpStatusOf: (e: { status?: number }) => (typeof e?.status === 'number' ? e.status : undefined),
}));
jest.mock('react-hot-toast', () => {
  const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, toast, default: toast };
});

const post = apiClient.post as jest.Mock;
const put = apiClient.put as jest.Mock;
const analytics = jest.requireMock('@/lib/analytics') as Record<string, jest.Mock>;
const reporter = jest.requireMock('@/lib/reportClientError') as { reportClientError: jest.Mock };

type Opts = Record<string, any>;
let opened: Opts[] = [];
let instances: FakeRazorpay[] = [];

class FakeRazorpay {
  opts: Opts;
  handlers: Record<string, (r: any) => unknown> = {};
  constructor(opts: Opts) {
    this.opts = opts;
    instances.push(this);
  }
  on(event: string, fn: (r: any) => unknown) {
    this.handlers[event] = fn;
  }
  open() {
    opened.push(this.opts);
  }
}

const USER = { name: 'Asha', email: 'asha@example.com', phone: '9000000000' };

beforeEach(() => {
  opened = [];
  instances = [];
  Object.values(analytics).forEach((m) => m.mockClear());
  reporter.reportClientError.mockClear();
  put.mockReset();
  put.mockResolvedValue({});
  post.mockReset();
  post.mockResolvedValue({
    success: true,
    data: { keyId: 'rzp_live_aaaaaa', orderId: 'order_server1', amount: 20300000, currency: 'INR' },
  });
  (window as any).Razorpay = FakeRazorpay;
});

afterEach(() => {
  delete (window as any).Razorpay;
});

async function pay(displayOptions?: { startMethod?: 'emi' }) {
  const { result } = renderHook(() => useRazorpay({ onSuccess: jest.fn() }));
  await act(async () => {
    // 1 is a deliberately wrong browser-side amount: the server's must win.
    await result.current.processPayment('ord_1', 1, USER, displayOptions);
  });
  expect(opened).toHaveLength(1);
  return opened[0];
}

describe('useRazorpay.processPayment', () => {
  it('opens Razorpay on its EMI section when the shopper chose EMI', async () => {
    const opts = await pay({ startMethod: 'emi' });
    expect(opts.prefill.method).toBe('emi');
  });

  it("leaves Razorpay's default section when no start method is given", async () => {
    const opts = await pay();
    expect(opts.prefill).not.toHaveProperty('method');
  });

  it.each([[undefined], [{ startMethod: 'emi' as const }]])(
    'takes key, order id and amount from the backend either way (%p)',
    async (displayOptions) => {
      const opts = await pay(displayOptions);
      expect(opts.key).toBe('rzp_live_aaaaaa');
      expect(opts.order_id).toBe('order_server1');
      expect(opts.amount).toBe(20300000);
      expect(opts.prefill).toMatchObject({ name: 'Asha', email: 'asha@example.com', contact: '9000000000' });
    }
  );
});

/*
  Funnel events: razorpay_opened → razorpay_dismissed | payment_failed. Each carries the
  order id and the SERVER's amount (₹2,03,000 = 20300000 paise), never PII, and fires
  once even though Razorpay may call ondismiss twice or emit payment.failed again for
  the same payment.
*/
describe('useRazorpay funnel analytics', () => {
  it('fires razorpay_opened once with the order id and the server amount', async () => {
    await pay({ startMethod: 'emi' });
    expect(analytics.trackRazorpayOpened).toHaveBeenCalledTimes(1);
    expect(analytics.trackRazorpayOpened).toHaveBeenCalledWith({ orderId: 'ord_1', amount: 203000, method: 'emi' });
    expect(analytics.trackRazorpayDismissed).not.toHaveBeenCalled();
    expect(analytics.trackPaymentFailed).not.toHaveBeenCalled();
  });

  it('fires razorpay_dismissed once when the shopper closes the window (even if Razorpay calls it twice)', async () => {
    const opts = await pay();
    await act(async () => {
      await opts.modal.ondismiss();
      await opts.modal.ondismiss();
    });
    expect(analytics.trackRazorpayDismissed).toHaveBeenCalledTimes(1);
    expect(analytics.trackRazorpayDismissed).toHaveBeenCalledWith({ orderId: 'ord_1', amount: 203000, method: null });
  });

  it('does not fire razorpay_dismissed after a successful payment', async () => {
    post.mockResolvedValueOnce({
      success: true,
      data: { keyId: 'rzp_live_aaaaaa', orderId: 'order_server1', amount: 20300000, currency: 'INR' },
    }).mockResolvedValueOnce({ success: true });
    const opts = await pay();
    await act(async () => {
      await opts.handler({ razorpay_order_id: 'order_server1', razorpay_payment_id: 'pay_1', razorpay_signature: 's' });
      await opts.modal.ondismiss();
    });
    expect(analytics.trackRazorpayDismissed).not.toHaveBeenCalled();
  });

  it('fires payment_failed with Razorpay error code/reason and no PII, once per payment id', async () => {
    await pay({ startMethod: 'emi' });
    const failure = {
      error: {
        code: 'BAD_REQUEST_ERROR',
        description: 'Your card ending 4242 was declined',
        source: 'bank',
        step: 'payment_authorization',
        reason: 'payment_failed',
        metadata: { payment_id: 'pay_A', order_id: 'order_server1' },
      },
    };
    await act(async () => {
      await instances[0].handlers['payment.failed'](failure);
      await instances[0].handlers['payment.failed'](failure); // same payment replayed
      await instances[0].handlers['payment.failed']({ error: { ...failure.error, metadata: { payment_id: 'pay_B' } } });
    });
    expect(analytics.trackPaymentFailed).toHaveBeenCalledTimes(2);
    const props = analytics.trackPaymentFailed.mock.calls[0][0];
    expect(props).toEqual({
      orderId: 'ord_1', amount: 203000, method: 'emi',
      errorCode: 'BAD_REQUEST_ERROR', errorReason: 'payment_failed',
      errorSource: 'bank', errorStep: 'payment_authorization',
    });
    // The description can hold card/contact details: it never reaches analytics.
    expect(JSON.stringify(analytics.trackPaymentFailed.mock.calls)).not.toMatch(/4242|asha|9000000000/i);
  });

  /*
    "Website errors" reports: what failed and the gateway's own codes, never the
    payer's details. Reporting only — the payment flow is unchanged.
  */
  it('reports a failed payment once per payment id, with codes and the order, no PII', async () => {
    await pay();
    const failure = {
      error: {
        code: 'BAD_REQUEST_ERROR', description: 'Your card ending 4242 was declined', source: 'bank',
        step: 'payment_authorization', reason: 'payment_failed', metadata: { payment_id: 'pay_A' },
      },
    };
    await act(async () => {
      await instances[0].handlers['payment.failed'](failure);
      await instances[0].handlers['payment.failed'](failure);
    });
    expect(reporter.reportClientError).toHaveBeenCalledTimes(1);
    expect(reporter.reportClientError.mock.calls[0][0]).toMatchObject({
      feature: 'payment', step: 'payment-failed', orderId: 'ord_1',
      context: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', source: 'bank', gatewayStep: 'payment_authorization' },
    });
    expect(JSON.stringify(reporter.reportClientError.mock.calls)).not.toMatch(/4242|asha|9000000000/i);
  });

  it('reports a dismissed window as a warning, once', async () => {
    const opts = await pay();
    await act(async () => { await opts.modal.ondismiss(); await opts.modal.ondismiss(); });
    expect(reporter.reportClientError).toHaveBeenCalledTimes(1);
    expect(reporter.reportClientError.mock.calls[0][0]).toMatchObject({ feature: 'payment', step: 'dismissed', level: 'warning', orderId: 'ord_1' });
  });

  it('reports a failed create-order with its HTTP status, and still fails the payment as before', async () => {
    post.mockReset();
    post.mockRejectedValueOnce(Object.assign(new Error('Order already paid'), { status: 409 }));
    const onFailure = jest.fn();
    const { result } = renderHook(() => useRazorpay({ onSuccess: jest.fn(), onFailure }));
    await act(async () => { await result.current.processPayment('ord_1', 1, USER); });
    expect(onFailure).toHaveBeenCalled();
    expect(opened).toHaveLength(0);
    expect(reporter.reportClientError.mock.calls[0][0]).toMatchObject({ feature: 'payment', step: 'open', orderId: 'ord_1', context: expect.objectContaining({ httpStatus: 409 }) });
  });

  it('reports a failed verify', async () => {
    post.mockResolvedValueOnce({
      success: true, data: { keyId: 'rzp_live_aaaaaa', orderId: 'order_server1', amount: 20300000, currency: 'INR' },
    }).mockRejectedValueOnce(Object.assign(new Error('Bad signature'), { status: 400 }));
    const opts = await pay();
    await act(async () => { await opts.handler({ razorpay_order_id: 'order_server1', razorpay_payment_id: 'pay_1', razorpay_signature: 's' }); });
    expect(reporter.reportClientError.mock.calls[0][0]).toMatchObject({ feature: 'payment', step: 'verify', orderId: 'ord_1', context: { httpStatus: 400 } });
  });
});
