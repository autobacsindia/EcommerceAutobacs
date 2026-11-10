/**
 * Meta leads: the card, the Follow up button and losing the race, recording how it
 * went, who sees the phone (only what the server sends), filters in the request,
 * the details panel, and the sheet-problem banners.
 */
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import MetaLeadsList from './MetaLeadsList';
import type { MetaLead, MetaLeadSync, MetaLeadYou } from './metaLeadTypes';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);

const api = apiClient as unknown as { get: jest.Mock; patch: jest.Mock; post: jest.Mock };
const lead = (over: Partial<MetaLead> = {}): MetaLead => ({
  id: 'a1', tab: 'jimny suspension', rowNumber: 3, removedFromSheet: false, leadDate: '2026-11-08T03:51:17.000Z', dateRaw: '2026-11-07T22:51:17-05:00', dateHasTime: true,
  name: 'Asha', phone: '', email: '', contactHidden: true, product: 'jimny form', campaign: 'camp', salesPerson: 'nevin', status: 'responded',
  followUp1: 'msgd', followUp2: '', revision: 0, followingUp: null, followUpStatus: null, quietDays: 0, others: [], inWebsiteLeads: false, ...over,
});
const MEMBER: MetaLeadYou = { userId: 'u1', canEdit: false, canFollowUp: true, canManage: false };
const HEAD: MetaLeadYou = { userId: 'u9', canEdit: true, canFollowUp: true, canManage: true };
const SYNC: MetaLeadSync = { lastSuccessAt: '2026-11-09T04:00:00.000Z', connected: true, stale: false, columnsMoved: [], skippedTabs: [] };
const page = (leads: MetaLead[], you: MetaLeadYou = MEMBER, sync = SYNC) => ({ leads, nextCursor: null, tabs: [{ name: 'jimny suspension', rows: 1 }], sync, you });
const detail = (you: MetaLeadYou, extras = [{ label: 'your_car?', value: 'Jimny', readOnly: false }, { label: 'id', value: 'l:1', readOnly: true }]) =>
  ({ lead: { ...lead({ phone: '+919876543210' }), extras, edits: [], history: [{ type: 'follow_up', label: 'No response', followUpStatus: 'no_response', at: '2026-11-09T04:00:00.000Z', who: 'Priya', notes: 'Rang twice' }] }, you });

function mockApi(list: unknown, one: unknown = detail(HEAD)) {
  api.get.mockImplementation((url: string) => {
    if (url === '/staff/meta-leads/people') return Promise.resolve({ people: [{ userId: 'u2', name: 'Priya' }], members: [{ userId: 'u2', name: 'Priya' }] });
    return Promise.resolve(url.startsWith('/staff/meta-leads?') ? list : one);
  });
}
const listUrls = () => api.get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/staff/meta-leads?'));
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MetaLeadsList /></QueryClientProvider>,
);

beforeEach(() => { jest.clearAllMocks(); addressBar.reset('/team/meta-leads'); });

test('a free lead: time in India, a Follow up button, no number yet, the sheet notes kept', async () => {
  mockApi(page([lead()]));
  show();
  const card = await screen.findByTestId('meta-lead-card');
  expect(within(card).getByText('Asha')).toBeInTheDocument();
  expect(within(card).getByText(/8 Nov 2026.*9:21 am IST/i)).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /^Follow up$/ })).toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  expect(within(card).getByText(/Click Follow up to see the phone number/)).toBeInTheDocument();
  expect(within(card).getByText('From the sheet')).toBeInTheDocument();
  expect(within(card).getByText('msgd')).toBeInTheDocument();
});

test('Follow up: the card changes only to what the server confirms, then asks how it went', async () => {
  mockApi(page([lead()]));
  const mine = lead({ phone: '+919876543210', contactHidden: false, followingUp: { userId: 'u1', name: 'Priya', at: '2026-11-09T04:00:00.000Z', mine: true } });
  api.post.mockImplementation(() => { mockApi(page([mine])); return Promise.resolve({ success: true, outcome: 'claimed', lead: mine }); });
  show();
  fireEvent.click(await screen.findByRole('button', { name: /^Follow up$/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff/meta-leads/a1/follow-up', {}));
  expect(await screen.findByText(/Following up: You/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /9876543210/ })).toHaveAttribute('href', 'tel:+919876543210');
  expect(await screen.findByRole('radiogroup', { name: 'Follow-up status' })).toBeInTheDocument();
});

test('losing the race shows who has it, not an error', async () => {
  mockApi(page([lead()]));
  const theirs = lead({ followingUp: { userId: 'u2', name: 'Arjun', at: '2026-11-09T04:00:00.000Z', mine: false } });
  api.post.mockImplementation(() => { mockApi(page([theirs])); return Promise.reject(Object.assign(new Error('x'), { rawData: { success: false, outcome: 'taken', message: 'Arjun is already following up on this lead.', lead: theirs } })); });
  show();
  fireEvent.click(await screen.findByRole('button', { name: /^Follow up$/ }));
  expect(await screen.findByRole('status')).toHaveTextContent('Arjun is already following up');
  expect(screen.getByText(/Following up: Arjun/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('recording a status posts it; Others needs a note', async () => {
  const mine = lead({ phone: '+919876543210', contactHidden: false, followingUp: { userId: 'u1', name: 'Priya', at: null, mine: true } });
  mockApi(page([mine]));
  const saved = { ...mine, followUpStatus: { status: 'whatsapp' as const, label: 'WhatsApp', at: '2026-11-09T05:00:00.000Z' } };
  api.post.mockImplementation(() => { mockApi(page([saved])); return Promise.resolve({ success: true, outcome: 'saved', lead: saved }); });
  show();
  fireEvent.click(await screen.findByRole('button', { name: /Update follow-up/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Not interested' }));
  expect(screen.getByText(/You can change this later/)).toBeInTheDocument();
  expect(screen.queryByText(/Closes the lead as Lost/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Others' }));
  expect(screen.getByRole('button', { name: /Save follow-up/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
  fireEvent.click(screen.getByRole('button', { name: /Save follow-up/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff/meta-leads/a1/follow-ups', { status: 'whatsapp', note: '' }));
  const card = await screen.findByTestId('meta-lead-card');
  expect(await within(card).findByText('WhatsApp')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument());
});

test("someone else's lead: no update button for a member; a head can update and move it", async () => {
  const theirs = lead({ followingUp: { userId: 'u2', name: 'Arjun', at: null, mine: false } });
  mockApi(page([theirs]));
  const { unmount } = show();
  await screen.findByText(/Following up: Arjun/);
  expect(screen.queryByRole('button', { name: /Update follow-up/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Make free/ })).not.toBeInTheDocument();
  unmount();
  mockApi(page([theirs], HEAD));
  show();
  expect(await screen.findByRole('button', { name: /Update follow-up/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Make free/ })).toBeInTheDocument();
  expect(await screen.findByLabelText('Move this lead to')).toBeInTheDocument();
});

test('the history opens from the server, with who, status and note', async () => {
  mockApi(page([lead()]), detail(MEMBER));
  show();
  fireEvent.click(await screen.findByRole('button', { name: /History/ }));
  expect(await screen.findByText('No response')).toBeInTheDocument();
  expect(screen.getByText(/Priya/)).toBeInTheDocument();
});

test('tabs and filters go to the server', async () => {
  mockApi(page([lead()]));
  show();
  fireEvent.click(await screen.findByRole('tab', { name: 'Unclaimed' }));
  await waitFor(() => expect(listUrls().at(-1)).toContain('view=free'));
  fireEvent.change(screen.getByLabelText('Follow-up'), { target: { value: 'no_response' } });
  await waitFor(() => expect(listUrls().at(-1)).toContain('followUp=no_response'));
  await screen.findByRole('option', { name: 'Priya' });
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'u2' } });
  await waitFor(() => expect(listUrls().at(-1)).toContain('owner=u2'));
});

test('notes for the caller: other enquiries, Website leads, left the sheet', async () => {
  mockApi(page([lead({ others: [{ tab: 'Thar Ironman', product: 'x', followingUp: 'Arjun' }], inWebsiteLeads: true, removedFromSheet: true })]));
  show();
  expect(await screen.findByText(/Also enquired on Thar Ironman \(Arjun following up\) · Also in Website leads/)).toBeInTheDocument();
  expect(screen.getByText('No longer in the sheet')).toBeInTheDocument();
});

test('edit sends only what changed, with the version it was based on', async () => {
  mockApi(page([lead()], HEAD));
  api.patch.mockResolvedValue({ lead: lead() });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  const status = await screen.findByLabelText('Status');
  fireEvent.change(status, { target: { value: 'called' } });
  fireEvent.change(screen.getByLabelText('your_car?'), { target: { value: 'Thar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/staff/meta-leads/a1', { revision: 0, changes: { status: 'called' }, extras: { 'your_car?': 'Thar' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test("Meta's own id can be read but not changed", async () => {
  mockApi(page([lead()], HEAD));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  expect(await screen.findByLabelText('id')).toBeDisabled();
});

test('someone saved first: the message shows, the form reloads their version and stays open', async () => {
  mockApi(page([lead()], HEAD));
  api.patch.mockRejectedValue(Object.assign(new Error('x'), { message: 'Someone else just changed this lead.', rawData: { outcome: 'changed' } }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha' }));
  fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'called' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('responded'));
});

test('view-only people read the details as text, with no form to save', async () => {
  mockApi(page([lead()]), detail(MEMBER));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'View Asha' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('your_car?')).toBeInTheDocument();
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});

test('a stopped feed warns, so "no new leads" is not believed', async () => {
  mockApi(page([lead()], MEMBER, { ...SYNC, stale: true }));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not update from the sheet/);
});

test('a skipped tab and a moved column each say so', async () => {
  mockApi(page([lead()], MEMBER, { ...SYNC, skippedTabs: ['odd tab'], columnsMoved: ['Thar'] }));
  show();
  const alerts = await screen.findAllByRole('alert');
  expect(alerts[0]).toHaveTextContent(/odd tab/);
  expect(alerts[1]).toHaveTextContent(/inserted or moved on: Thar/);
});

test('not connected yet, and a load failure, each say so', async () => {
  mockApi(page([], MEMBER, { ...SYNC, lastSuccessAt: null, connected: false, stale: true }));
  const { unmount } = show();
  expect(await screen.findByText(/not connected yet/)).toBeInTheDocument();
  unmount();
  api.get.mockRejectedValue(new Error('nope'));
  show();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
