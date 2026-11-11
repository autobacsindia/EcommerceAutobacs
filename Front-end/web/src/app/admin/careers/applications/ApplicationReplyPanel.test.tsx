/**
 * Careers "Reply to applicant" panel:
 *   - Send posts subject + message + a draft key, and shows "Sent" only on the
 *     server's confirmation, then lists the reply
 *   - a double-click sends ONE request
 *   - a server failure is shown, never reported as sent, and the next attempt
 *     uses a new key (the failed one is spent)
 *   - a network drop (outcome unknown) keeps the SAME key so a retry is deduped
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '@/lib/api';
import ApplicationReplyPanel, { type ApplicationReply } from './ApplicationReplyPanel';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn() } }));
const post = apiClient.post as jest.Mock;

const sent = (over: Partial<ApplicationReply> = {}): ApplicationReply => ({
  _id: 'r1', key: 'k', subject: 'Your application', text: 'See you Monday', status: 'sent',
  sentByName: 'HR Admin', createdAt: '2026-11-11T10:00:00Z', sentAt: '2026-11-11T10:00:01Z', ...over,
});

function setup() {
  render(<ApplicationReplyPanel applicationId="a1" applicantEmail="applicant@example.com" roleTitle="Service Advisor" />);
  fireEvent.change(screen.getByLabelText('Reply message'), { target: { value: 'See you Monday' } });
  return screen.getByRole('button', { name: /send reply/i });
}

beforeEach(() => {
  post.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

test('sends and shows the confirmed reply', async () => {
  post.mockResolvedValue({ success: true, outcome: 'sent', reply: sent(), replies: [sent()] });
  fireEvent.click(setup());

  await screen.findByText(/Sent to applicant@example.com/);
  expect(post).toHaveBeenCalledWith('/careers/admin/applications/a1/reply', expect.objectContaining({
    subject: 'Your application for Service Advisor — ROAVION Automotive', message: 'See you Monday', key: expect.any(String),
  }));
  expect(screen.getByText('Replies sent (1)')).toBeInTheDocument();
  expect((screen.getByLabelText('Reply message') as HTMLTextAreaElement).value).toBe('');
});

test('a double-click sends one request', async () => {
  let resolve!: (v: unknown) => void;
  post.mockReturnValue(new Promise((r) => { resolve = r; }));
  const button = setup();
  fireEvent.click(button);
  fireEvent.click(button);
  resolve({ success: true, outcome: 'sent', reply: sent(), replies: [sent()] });
  await screen.findByText(/Sent to/);
  expect(post).toHaveBeenCalledTimes(1);
});

test('a server failure is shown, not reported as sent; the retry uses a new key', async () => {
  const failed = sent({ status: 'failed', error: 'The email could not be sent: Sender not verified', sentAt: null });
  post.mockRejectedValueOnce(Object.assign(new Error('x'), {
    status: 502, rawData: { success: false, outcome: 'failed', message: failed.error, reply: failed, replies: [failed] },
  }));
  fireEvent.click(setup());

  await screen.findByText(/Not sent\. The email could not be sent: Sender not verified/);
  expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument();

  post.mockResolvedValueOnce({ success: true, outcome: 'sent', reply: sent(), replies: [failed, sent()] });
  fireEvent.click(screen.getByRole('button', { name: /send reply/i }));
  await screen.findByText(/Sent to/);
  expect(post.mock.calls[1][1].key).not.toBe(post.mock.calls[0][1].key);
});

test('a network drop keeps the same key so a retry cannot double-send', async () => {
  post.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: 0 }));
  fireEvent.click(setup());
  await screen.findByText(/could not confirm whether it was sent/);

  post.mockResolvedValueOnce({ success: true, outcome: 'duplicate', reply: sent(), replies: [sent()] });
  fireEvent.click(screen.getByRole('button', { name: /send reply/i }));
  await screen.findByText(/Sent to/);
  expect(post.mock.calls[1][1].key).toBe(post.mock.calls[0][1].key);
});

test('cannot send an empty message', () => {
  render(<ApplicationReplyPanel applicationId="a1" applicantEmail="applicant@example.com" roleTitle="X" />);
  expect(screen.getByRole('button', { name: /send reply/i })).toBeDisabled();
});
