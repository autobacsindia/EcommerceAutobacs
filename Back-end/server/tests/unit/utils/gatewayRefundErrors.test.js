import { isAlreadyRefundedAtGateway, alreadyRefundedGuidance } from '../../../utils/gatewayRefundErrors.js';

/**
 * Recognising the gateway rejection that means "this was already refunded in the
 * Razorpay dashboard", so the admin is offered offline recording instead of a Retry
 * button that can never succeed.
 *
 * Advisory only — see the file's own note. A false negative just shows the raw error.
 */

describe('isAlreadyRefundedAtGateway', () => {
  it.each([
    'The payment has been fully refunded already',
    'This payment has already been refunded',
    'Payment already refunded',
    'The refund amount is greater than amount captured',
  ])('recognises %j', (message) => {
    expect(isAlreadyRefundedAtGateway(new Error(message))).toBe(true);
    expect(isAlreadyRefundedAtGateway(message)).toBe(true);
  });

  it.each([
    'Network timeout',
    'Invalid payment id',
    'Your account is not authorised to issue refunds',
    // Close but genuinely different: nothing has been refunded, the id is simply wrong.
    'The payment id provided does not exist',
  ])('does NOT misread %j', (message) => {
    expect(isAlreadyRefundedAtGateway(new Error(message))).toBe(false);
  });

  it('is safe on empty, null and undefined input', () => {
    expect(isAlreadyRefundedAtGateway(null)).toBe(false);
    expect(isAlreadyRefundedAtGateway(undefined)).toBe(false);
    expect(isAlreadyRefundedAtGateway('')).toBe(false);
    expect(isAlreadyRefundedAtGateway({})).toBe(false);
  });
});

describe('alreadyRefundedGuidance', () => {
  it('keeps the gateway wording AND names the action that resolves it', () => {
    const text = alreadyRefundedGuidance('The payment has been fully refunded already');
    // Nothing hidden from the admin.
    expect(text).toContain('The payment has been fully refunded already');
    expect(text).toMatch(/dashboard/);
    expect(text).toMatch(/settled offline/);
  });
});
