/**
 * Email Service Mock for Testing
 * 
 * Prevents actual email sending during tests
 * Tracks email calls for assertions
 */

export const sentEmails = [];

export const emailServiceMock = {
  sendEmail: jest.fn().mockImplementation(async (options) => {
    sentEmails.push({
      ...options,
      sentAt: new Date().toISOString()
    });
    return { success: true, messageId: `test_msg_${Date.now()}` };
  }),
  
  sendOrderConfirmation: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordReset: jest.fn().mockResolvedValue({ success: true }),
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendShippingNotification: jest.fn().mockResolvedValue({ success: true })
};

/**
 * Reset mock state between tests
 */
export const resetEmailMocks = () => {
  emailServiceMock.sendEmail.mockClear();
  emailServiceMock.sendOrderConfirmation.mockClear();
  emailServiceMock.sendPasswordReset.mockClear();
  emailServiceMock.sendWelcomeEmail.mockClear();
  emailServiceMock.sendShippingNotification.mockClear();
  sentEmails.length = 0; // Clear array
};

/**
 * Assert email was sent
 */
export const assertEmailSent = (expected) => {
  const call = emailServiceMock.sendEmail.mock.calls[0];
  
  if (!call) {
    throw new Error('Expected email to be sent, but sendEmail was not called');
  }
  
  const [actual] = call;
  
  if (expected.to && actual.to !== expected.to) {
    throw new Error(`Expected email to: ${expected.to}, got: ${actual.to}`);
  }
  
  if (expected.subject && !actual.subject.includes(expected.subject)) {
    throw new Error(`Expected subject to include: ${expected.subject}, got: ${actual.subject}`);
  }
};

/**
 * Assert no emails were sent
 */
export const assertNoEmailSent = () => {
  if (emailServiceMock.sendEmail.mock.calls.length > 0) {
    throw new Error('Expected no email to be sent, but sendEmail was called');
  }
};

/**
 * Get all sent emails
 */
export const getSentEmails = () => [...sentEmails];

export default emailServiceMock;
