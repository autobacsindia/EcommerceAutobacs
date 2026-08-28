/**
 * orderStatusService — transaction safety of the status-change side effects.
 *
 * `updateOrderStatus` is called INSIDE the Razorpay capture transaction
 * (razorpayService.processPaymentSuccess passes its `session` for the
 * `awaiting_payment → processing` move). Everything it fans out to that writes the
 * same order — or its user — must therefore join that session.
 *
 * A session-less write against a document the open transaction has already written
 * does NOT fail fast: WiredTiger makes it wait for the lock, the transaction cannot
 * commit because it is awaiting that write, and nothing breaks the tie until the
 * server's 60s transactionLifetimeLimitSeconds reaper aborts the transaction.
 * `withTransaction` then retries and deadlocks again until its ~120s budget expires.
 * Every capture stalled ~180s and threw `Transaction ... has been aborted`.
 *
 * These are unit tests over the private fan-out helpers, so they assert the
 * session is threaded at each call site rather than re-deriving the deadlock (the
 * end-to-end proof lives in tests/razorpayWebhookRace.test.js, which runs the real
 * capture path against a real replica set under a deliberately tight timeout).
 */

import { jest } from '@jest/globals';

const markPurchaseCountedOnce = jest.fn();
const markPurchaseReversedOnce = jest.fn();
const markPurchased = jest.fn();
const reversePurchase = jest.fn();
const voidForOrder = jest.fn();
const upsertFromOrder = jest.fn();

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { markPurchaseCountedOnce, markPurchaseReversedOnce },
}));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({
  default: { markPurchased, reversePurchase },
}));
jest.unstable_mockModule('../../../services/spinService.js', () => ({
  default: { voidForOrder },
}));
jest.unstable_mockModule('../../../services/leadSyncService.js', () => ({
  default: { safeSync: (fn) => fn(), upsertFromOrder },
}));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  getOrderQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
}));

const { OrderStatusService } = await import('../../../services/orderStatusService.js');
const service = new OrderStatusService();

// Stand-in for a mongoose ClientSession — the helpers only ever pass it through.
const SESSION = { id: 'fake-session' };
const ORDER = { _id: 'order123', user: 'user123', totalAmount: 1000 };

beforeEach(() => {
  markPurchaseCountedOnce.mockReset().mockResolvedValue(true);
  markPurchaseReversedOnce.mockReset().mockResolvedValue(true);
  markPurchased.mockReset().mockResolvedValue(undefined);
  reversePurchase.mockReset().mockResolvedValue(undefined);
  voidForOrder.mockReset().mockResolvedValue({ voided: true });
  upsertFromOrder.mockReset().mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('_syncCrmOnStatus forwards the caller transaction', () => {
  test('processing: the once-only flag and the LTV increment both join the session', async () => {
    await service._syncCrmOnStatus(ORDER, 'processing', SESSION);

    expect(markPurchaseCountedOnce).toHaveBeenCalledWith('order123', SESSION);
    expect(markPurchased).toHaveBeenCalledWith('user123', { amountPaise: 100000 }, SESSION);
  });

  test('cancelled: the reversal flag and the LTV decrement both join the session', async () => {
    await service._syncCrmOnStatus(ORDER, 'cancelled', SESSION);

    expect(markPurchaseReversedOnce).toHaveBeenCalledWith('order123', SESSION);
    expect(reversePurchase).toHaveBeenCalledWith('user123', { amountPaise: 100000 }, SESSION);
  });

  test('no transaction: the same writes run session-less (null, not undefined)', async () => {
    await service._syncCrmOnStatus(ORDER, 'processing');

    expect(markPurchaseCountedOnce).toHaveBeenCalledWith('order123', null);
    expect(markPurchased).toHaveBeenCalledWith('user123', { amountPaise: 100000 }, null);
  });

  test('the LTV write is skipped when the once-only flag was already claimed', async () => {
    markPurchaseCountedOnce.mockResolvedValue(false); // a concurrent delivery won

    await service._syncCrmOnStatus(ORDER, 'processing', SESSION);

    expect(markPurchased).not.toHaveBeenCalled();
  });

  test('leadSync stays OUTSIDE the transaction — it must not receive the session', async () => {
    // It writes Lead/Consultation documents, never this order, so it cannot deadlock;
    // keeping it out holds the money transaction's write set down.
    await service._syncCrmOnStatus(ORDER, 'processing', SESSION);

    expect(upsertFromOrder).toHaveBeenCalledWith(ORDER);
    expect(upsertFromOrder).not.toHaveBeenCalledWith(ORDER, SESSION);
  });

  test('a CRM failure never propagates out of a status change', async () => {
    markPurchaseCountedOnce.mockRejectedValue(new Error('mongo down'));

    await expect(service._syncCrmOnStatus(ORDER, 'processing', SESSION)).resolves.toBeUndefined();
  });
});

describe('_voidSpinRewardOnStatus refuses to run inside a caller transaction', () => {
  // spinService.voidForOrder opens its OWN transaction and writes this order
  // (markSpinRewardVoided). Nested inside a caller's transaction that is the same
  // self-deadlock, so the guard skips loudly instead of hanging the money path.
  test.each(['cancelled', 'returned', 'refunded'])(
    'skips the clawback for %s when handed a session',
    async (status) => {
      await service._voidSpinRewardOnStatus(ORDER, status, SESSION);

      expect(voidForOrder).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SKIPPED'));
    }
  );

  test('runs normally with no session, mapping the status to a void reason', async () => {
    await service._voidSpinRewardOnStatus(ORDER, 'cancelled');
    expect(voidForOrder).toHaveBeenCalledWith('order123', 'order_cancelled');

    await service._voidSpinRewardOnStatus(ORDER, 'returned');
    expect(voidForOrder).toHaveBeenCalledWith('order123', 'order_returned');

    await service._voidSpinRewardOnStatus(ORDER, 'refunded');
    expect(voidForOrder).toHaveBeenCalledWith('order123', 'order_refunded');
  });

  test('is a no-op for a status that carries no prize clawback', async () => {
    await service._voidSpinRewardOnStatus(ORDER, 'shipped', null);
    expect(voidForOrder).not.toHaveBeenCalled();
  });

  test('a clawback failure never propagates out of a status change', async () => {
    voidForOrder.mockRejectedValue(new Error('spin service down'));

    await expect(service._voidSpinRewardOnStatus(ORDER, 'cancelled')).resolves.toBeUndefined();
  });
});
