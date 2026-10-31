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
jest.mock('react-hot-toast', () => {
  const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, toast, default: toast };
});

const post = apiClient.post as jest.Mock;

type Opts = Record<string, any>;
let opened: Opts[] = [];

class FakeRazorpay {
  opts: Opts;
  constructor(opts: Opts) {
    this.opts = opts;
  }
  on() {}
  open() {
    opened.push(this.opts);
  }
}

const USER = { name: 'Asha', email: 'asha@example.com', phone: '9000000000' };

beforeEach(() => {
  opened = [];
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
