/**
 * Unit tests for careersApplicantEmailService — the two candidate-facing emails.
 * DB (repository) + provider (emailHandler) are mocked; asserts the idempotency
 * stamps, the rejection status guard, and the "email disabled" short-circuit.
 */

import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockSave = jest.fn();
const mockSendAck = jest.fn();
const mockSendRej = jest.fn();

jest.unstable_mockModule('../../../repositories/jobApplicationRepository.js', () => ({
  default: { findById: mockFindById, save: mockSave },
}));

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendCareersAcknowledgement: mockSendAck, sendCareersRejection: mockSendRej },
}));

const { emailCareersAcknowledgement, emailCareersRejection } = await import(
  '../../../services/careersApplicantEmailService.js'
);

const makeApp = (over = {}) => ({
  _id: 'app1',
  email: 'asha@example.com',
  fullName: 'Asha K',
  roleTitle: 'Marketing Manager',
  status: 'new',
  acknowledgementEmailedAt: null,
  rejectionEmailedAt: null,
  ...over,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('emailCareersAcknowledgement', () => {
  test('sends and stamps acknowledgementEmailedAt on success', async () => {
    const app = makeApp();
    mockFindById.mockResolvedValue(app);
    mockSendAck.mockResolvedValue({ success: true });

    expect(await emailCareersAcknowledgement('app1')).toEqual({ status: 'sent' });
    expect(mockSendAck).toHaveBeenCalledWith({ to: 'asha@example.com', application: app });
    expect(app.acknowledgementEmailedAt).toBeInstanceOf(Date);
    expect(mockSave).toHaveBeenCalledWith(app);
  });

  test('skips (no re-send) when already acknowledged', async () => {
    mockFindById.mockResolvedValue(makeApp({ acknowledgementEmailedAt: new Date() }));
    expect(await emailCareersAcknowledgement('app1')).toEqual({ status: 'skipped' });
    expect(mockSendAck).not.toHaveBeenCalled();
  });

  test('skipped-disabled when email is off (no stamp, no throw)', async () => {
    const app = makeApp();
    mockFindById.mockResolvedValue(app);
    mockSendAck.mockResolvedValue({ success: false, fallbackToConsole: true });

    expect(await emailCareersAcknowledgement('app1')).toEqual({ status: 'skipped-disabled' });
    expect(app.acknowledgementEmailedAt).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('throws on a hard provider failure so BullMQ retries', async () => {
    mockFindById.mockResolvedValue(makeApp());
    mockSendAck.mockResolvedValue({ success: false, error: 'boom' });
    await expect(emailCareersAcknowledgement('app1')).rejects.toThrow(/boom/);
  });

  test('not-found for a missing application', async () => {
    mockFindById.mockResolvedValue(null);
    expect(await emailCareersAcknowledgement('nope')).toEqual({ status: 'not-found' });
  });
});

describe('emailCareersRejection', () => {
  test('sends and stamps rejectionEmailedAt when status is rejected', async () => {
    const app = makeApp({ status: 'rejected' });
    mockFindById.mockResolvedValue(app);
    mockSendRej.mockResolvedValue({ success: true });

    expect(await emailCareersRejection('app1')).toEqual({ status: 'sent' });
    expect(mockSendRej).toHaveBeenCalledWith({ to: 'asha@example.com', application: app });
    expect(app.rejectionEmailedAt).toBeInstanceOf(Date);
  });

  test('guards on status: a stale job for a no-longer-rejected app does not send', async () => {
    mockFindById.mockResolvedValue(makeApp({ status: 'shortlisted' }));
    expect(await emailCareersRejection('app1')).toEqual({ status: 'not-rejected' });
    expect(mockSendRej).not.toHaveBeenCalled();
  });

  test('skips when already rejection-mailed', async () => {
    mockFindById.mockResolvedValue(makeApp({ status: 'rejected', rejectionEmailedAt: new Date() }));
    expect(await emailCareersRejection('app1')).toEqual({ status: 'skipped' });
    expect(mockSendRej).not.toHaveBeenCalled();
  });
});
