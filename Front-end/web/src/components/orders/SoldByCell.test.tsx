/** "Sold by" on the admin orders list: text when unpaid; on a paid order a dropdown that needs proof in a popup. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SoldByCell, { type Seller } from './SoldByCell';

const postForm = jest.fn();
jest.mock('@/lib/postForm', () => ({ postForm: (...a: unknown[]) => postForm(...a) }));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));

const SELLERS: Seller[] = [{ id: 's1', name: 'Sam', isHead: false }, { id: 's2', name: 'Hari', isHead: true }];
const LONG_NOTE = 'Closed by Hari on a call on 5 Nov';
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const cell = (seller: { _id: string; name?: string } | null = { _id: 's1', name: 'Sam' }, onChanged = jest.fn()) =>
  wrap(<SoldByCell orderId="o1" paid seller={seller} sellers={SELLERS} onChanged={onChanged} />);
const pick = (value: string) => fireEvent.change(screen.getByLabelText('Sold by'), { target: { value } });
const submitButton = () => screen.getByRole('button', { name: /Submit change/ });
const writeNote = (value: string) => fireEvent.change(screen.getByLabelText('Note'), { target: { value } });
const attach = (...files: File[]) => fireEvent.change(screen.getByLabelText('Attach proof'), { target: { files } });
const sent = (call = 0) => Object.fromEntries((postForm.mock.calls[call][1] as FormData).entries());

beforeEach(() => { postForm.mockReset(); });

it('unpaid: just says who sold it (no dropdown)', () => {
  wrap(<SoldByCell orderId="o1" paid={false} seller={{ _id: 's1', name: 'Sam' }} sellers={SELLERS} onChanged={jest.fn()} />);
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('choosing someone opens the popup, saying from and to; nothing is sent yet', () => {
  cell();
  pick('s2');
  expect(within(screen.getByRole('dialog')).getByText('Sam')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText('Hari')).toBeInTheDocument();
  expect(submitButton()).toBeDisabled();
  expect(postForm).not.toHaveBeenCalled();
});

it('cancel: the dropdown stays on the old salesman and nothing is sent', () => {
  cell();
  pick('s2');
  expect(screen.getByLabelText('Sold by')).toHaveValue('s1');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Sold by')).toHaveValue('s1');
  expect(postForm).not.toHaveBeenCalled();
});

it('a short note is not proof; a long enough one is', () => {
  cell();
  pick('s2');
  writeNote('ok');
  expect(submitButton()).toBeDisabled();
  expect(screen.getByText(/more characters needed/)).toBeInTheDocument();
  writeNote(LONG_NOTE);
  expect(submitButton()).toBeEnabled();
});

it('sends the note, what the screen showed and a change id; "Website order" is sent as empty', async () => {
  postForm.mockResolvedValue({});
  const onChanged = jest.fn();
  cell(undefined, onChanged);
  pick('');
  writeNote(LONG_NOTE);
  fireEvent.click(submitButton());
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(postForm.mock.calls[0][0]).toBe('/staff/attribution/orders/o1');
  expect(postForm.mock.calls[0][2]).toBe('PUT');
  expect(sent()).toMatchObject({ salesUserId: '', expectedSalesUserId: 's1', note: LONG_NOTE, changeId: expect.any(String) });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('several files of different kinds are enough without a note', async () => {
  postForm.mockResolvedValue({});
  cell();
  pick('s2');
  attach(new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.docx', { type: '' }), new File(['c'], 'c.csv', { type: 'application/vnd.ms-excel' }));
  expect(await screen.findByText('b.docx')).toBeInTheDocument();
  fireEvent.click(submitButton());
  await waitFor(() => expect(postForm).toHaveBeenCalled());
  expect((postForm.mock.calls[0][1] as FormData).getAll('proof')).toHaveLength(3);
});

it('refuses a file type that is not allowed, in words', () => {
  cell();
  pick('s2');
  attach(new File(['x'], 'tool.exe', { type: 'application/x-msdownload' }));
  expect(screen.getByRole('alert')).toHaveTextContent('"tool.exe" can\'t be attached here');
  expect(submitButton()).toBeDisabled();
});

it('a failed save keeps the popup, the old salesman shows, and a retry reuses the same change id', async () => {
  postForm.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({});
  cell();
  pick('s2');
  writeNote(LONG_NOTE);
  fireEvent.click(submitButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByLabelText('Sold by')).toHaveValue('s1');
  fireEvent.click(submitButton());
  await waitFor(() => expect(postForm).toHaveBeenCalledTimes(2));
  expect(sent(1).changeId).toBe(sent(0).changeId);
});

it('double-click sends once', async () => {
  let finish: (v: unknown) => void = () => {};
  postForm.mockReturnValue(new Promise((r) => { finish = r; }));
  cell();
  pick('s2');
  writeNote(LONG_NOTE);
  fireEvent.click(submitButton());
  fireEvent.click(submitButton());
  expect(postForm).toHaveBeenCalledTimes(1);
  finish({});
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it("someone else's change: the popup closes and the server's words are shown", async () => {
  postForm.mockRejectedValue(Object.assign(new Error('x'), { status: 409, rawData: { message: 'Someone else just changed this order.' } }));
  cell();
  pick('s2');
  writeNote(LONG_NOTE);
  fireEvent.click(submitButton());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toHaveTextContent('Someone else just changed');
  expect(screen.getByLabelText('Sold by')).toHaveValue('s1');
});
