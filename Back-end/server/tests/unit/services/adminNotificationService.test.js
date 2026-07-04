/**
 * Unit tests for adminNotificationService.
 * DB + provider are mocked; asserts recipient resolution, content, the
 * email-disabled skip, and the provider-failure throw (so BullMQ retries).
 */

import { jest } from '@jest/globals';

const mockReviewFindById = jest.fn();
const mockConsultFindById = jest.fn();
const mockSendEmail = jest.fn();

/** Fake Mongoose query: chainable .populate(), awaitable to `result`. */
const query = (result) => ({
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
});

jest.unstable_mockModule('../../../repositories/reviewRepository.js', () => ({
  default: { findById: mockReviewFindById },
}));
jest.unstable_mockModule('../../../repositories/consultationRepository.js', () => ({
  default: { findById: mockConsultFindById },
}));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendEmail: mockSendEmail },
}));
jest.unstable_mockModule('../../../config/company.js', () => ({
  default: { name: 'Autobacs India', email: 'support@autobacsindia.com' },
}));

const { emailAdminReviewAlert, emailAdminConsultationAlert } = await import(
  '../../../services/adminNotificationService.js'
);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_NOTIFICATION_EMAIL;
  delete process.env.ADMIN_NOTIFICATION_EMAILS;
  process.env.FRONTEND_URL = 'https://autobacsindia.com';
});

describe('emailAdminReviewAlert', () => {
  const makeReview = (over = {}) => ({
    _id: 'rev1',
    rating: 4,
    title: 'Great fit',
    comment: 'Bolted right on.',
    isVerifiedPurchase: true,
    product: { _id: 'p1', name: 'Brake Pads', slug: 'brake-pads' },
    user: { _id: 'u1', name: 'Asha', email: 'asha@example.com' },
    ...over,
  });

  test('sends to the support inbox with product + rating in the subject', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminReviewAlert('rev1');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('Brake Pads');
    expect(arg.subject).toContain('4');
    expect(arg.text).toContain('asha@example.com');
    expect(arg.html).toContain('/admin/reviews');
  });

  test('honours ADMIN_NOTIFICATION_EMAIL override', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@autobacsindia.com';
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    await emailAdminReviewAlert('rev1');
    expect(mockSendEmail.mock.calls[0][0].to).toBe('ops@autobacsindia.com');
  });

  test('fans out to every recipient in ADMIN_NOTIFICATION_EMAILS (deduped)', async () => {
    process.env.ADMIN_NOTIFICATION_EMAILS = 'support@autobacsindia.com, sales@autobacsindia.com , support@autobacsindia.com';
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminReviewAlert('rev1');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(2); // deduped from 3
    expect(mockSendEmail.mock.calls.map((c) => c[0].to)).toEqual([
      'support@autobacsindia.com',
      'sales@autobacsindia.com',
    ]);
  });

  test('returns not-found when the review is missing', async () => {
    mockReviewFindById.mockReturnValue(query(null));
    expect(await emailAdminReviewAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('skips without error when email is disabled (no retry storm)', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: false, fallbackToConsole: true });

    expect(await emailAdminReviewAlert('rev1')).toEqual({ status: 'skipped-disabled' });
  });

  test('throws on a transient provider failure so BullMQ retries', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: false, error: 'postmark down' });

    await expect(emailAdminReviewAlert('rev1')).rejects.toThrow(/postmark down/);
  });
});

describe('emailAdminConsultationAlert', () => {
  const makeConsult = (over = {}) => ({
    _id: 'c1',
    name: 'Ravi',
    whatsapp: '+91 98952 57905',
    city: 'Kochi',
    makeModel: 'Toyota Fortuner',
    vehicleNumber: 'KL07AB1234',
    upgrades: ['Suspension Setup', 'Wheels & Tyres'],
    usage: 'Highway',
    drivingStyle: 'Spirited',
    mode: 'In-Person',
    preferredDate: new Date('2026-07-10T00:00:00Z'),
    preferredTime: '11:00',
    notes: 'Weekend track use.',
    ...over,
  });

  test('sends with name + vehicle in the subject and a wa.me link in the HTML', async () => {
    mockConsultFindById.mockResolvedValue(makeConsult());
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminConsultationAlert('c1');

    expect(result).toEqual({ status: 'sent' });
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('Ravi');
    expect(arg.subject).toContain('Toyota Fortuner');
    expect(arg.text).toContain('Suspension Setup');
    expect(arg.html).toContain('https://wa.me/919895257905');
    expect(arg.html).toContain('/admin/consultation');
  });

  test('returns not-found when the consultation is missing', async () => {
    mockConsultFindById.mockResolvedValue(null);
    expect(await emailAdminConsultationAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
