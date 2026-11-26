import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ParcelOverdueReason from './ParcelOverdueReason';
import { EtaRowBadge } from './ParcelEta';
import type { WorkOrder } from './types';

const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({}) },
}));

type Parcel = WorkOrder['parcels'][number];
const parcel: Parcel = {
  id: 's1', sequence: 1, status: 'shipped', courier: 'DTDC', trackingNumber: 'R100',
  shippedAt: '2026-11-14T05:00:00Z', deliveredAt: null, items: [{ name: 'Keycase', quantity: 1 }],
  photoUrl: null, canMarkDelivered: true, eta: { date: '2026-11-17', setBy: 'binu joy', setAt: null },
  etaState: 'overdue', etaHistory: [], canSetEta: true,
  overdueReason: null, overdueReasonHistory: [], canExplainOverdue: true,
};

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => put.mockReset());

describe('ParcelOverdueReason', () => {
  it('an overdue parcel with no reason says so; procurement picks one and it is sent with the date shown', async () => {
    put.mockResolvedValue({ order: { parcels: [] } });
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    expect(screen.getByText('No reason for overdue yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    const save = screen.getByRole('button', { name: 'Save reason' });
    expect(save).toBeDisabled(); // nothing picked yet
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'courier_delay' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '  stuck at hub ' } });
    fireEvent.click(save);

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/staff/work/orders/o1/parcels/s1/overdue-reason',
      { code: 'courier_delay', note: 'stuck at hub', expectedDate: '2026-11-17', requestId: expect.any(String) },
    ));
  });

  it('"Other" needs details before it can be saved', () => {
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: 'Save reason' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Customer on holiday' } });
    expect(screen.getByRole('button', { name: 'Save reason' })).toBeEnabled();
  });

  it('shows the reason, who gave it and the history; no button for someone who may not give it', () => {
    wrap(<ParcelOverdueReason orderId="o1" parcel={{
      ...parcel, canExplainOverdue: false,
      overdueReason: { code: 'courier_delay', label: 'Courier delay', note: 'stuck at hub', text: 'Courier delay — stuck at hub', by: 'Aromal S', at: null },
      overdueReasonHistory: [
        { code: 'courier_delay', label: 'Courier delay', note: 'stuck at hub', forDate: '2026-11-17', by: 'Aromal S', at: '2026-11-20T05:00:00Z' },
        { code: 'supplier_delay', label: 'Supplier delay', note: '', forDate: '2026-11-17', by: 'Admin', at: '2026-11-19T05:00:00Z' },
      ],
    }} />);
    expect(screen.getByText('Courier delay — stuck at hub')).toBeInTheDocument();
    expect(screen.getByText(/by Aromal S/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reason$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Reasons given \(2\)/ }));
    expect(screen.getByText('Supplier delay')).toBeInTheDocument();
    expect(screen.getAllByText(/was due 17\/11\/2026/)).toHaveLength(2);
  });

  it('a server refusal is shown', async () => {
    put.mockRejectedValue(new Error('A reason can only be given while the parcel is overdue.'));
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'address_issue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reason' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('nothing for a parcel that is not overdue and was never explained', () => {
    const { container } = wrap(<ParcelOverdueReason orderId="o1" parcel={{ ...parcel, etaState: 'upcoming', canExplainOverdue: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ParcelOverdueReason — optional file', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });
  const png = (name = 'courier.png', size = 1000, type = 'image/png') => {
    const f = new File([new Uint8Array(1)], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const openForm = () => {
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'courier_delay' } });
  };
  const attach = (f: File) => fireEvent.change(screen.getByLabelText('Attach a photo or PDF (optional)'), { target: { files: [f] } });

  it('a picked photo goes with the reason as one multipart save (with a requestId); no JSON call', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ order: { parcels: [] } }) });
    openForm();
    attach(png());
    expect(screen.getByText('courier.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save reason' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/staff/work/orders/o1/parcels/s1/overdue-reason');
    expect(init.method).toBe('PUT');
    const form = init.body as FormData;
    expect(form.get('code')).toBe('courier_delay');
    expect(form.get('expectedDate')).toBe('2026-11-17');
    expect((form.get('file') as File).name).toBe('courier.png');
    expect(String(form.get('requestId'))).toMatch(/.{8,}/);
    expect(put).not.toHaveBeenCalled();
  });

  it('a wrong type or a file over 10 MB is refused with a clear message and not attached', () => {
    openForm();
    attach(png('notes.docx', 1000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(screen.getByRole('alert')).toHaveTextContent('"notes.docx" is not a photo (JPG, PNG, WebP) or a PDF.');
    expect(screen.queryByText('notes.docx')).toBeNull();
    attach(png('huge.png', 11 * 1024 * 1024));
    expect(screen.getByRole('alert')).toHaveTextContent('"huge.png" is too large (10 MB maximum).');
    expect(screen.queryByRole('button', { name: 'Remove file' })).toBeNull();
  });

  it('upload fails → nothing saved silently; "Save without file" saves the reason with the SAME requestId', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'The file could not be uploaded, so the reason was not saved. Try again, or save the reason without the file.' }) });
    put.mockResolvedValue({ order: { parcels: [] } });
    openForm();
    attach(png());
    fireEvent.click(screen.getByRole('button', { name: 'Save reason' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reason was not saved/);
    expect(put).not.toHaveBeenCalled();
    const firstId = (fetchMock.mock.calls[0][1].body as FormData).get('requestId');
    fireEvent.click(screen.getByRole('button', { name: 'Save without file' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/staff/work/orders/o1/parcels/s1/overdue-reason',
      { code: 'courier_delay', note: '', expectedDate: '2026-11-17', requestId: firstId },
    ));
  });

  it('a double-click sends one save', async () => {
    let resolve: (v: unknown) => void = () => {};
    put.mockReturnValue(new Promise((r) => { resolve = r; }));
    openForm();
    const save = screen.getByRole('button', { name: 'Save reason' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    expect(put).toHaveBeenCalledTimes(1);
    resolve({ order: { parcels: [] } });
  });

  it('shows the file chip on the reason and on each history entry, linking to the staff file route', () => {
    const f1 = { name: 'courier page.png', mime: 'image/png', size: 2048, uploadedAt: null, url: '/api/v1/staff/work/orders/o1/parcels/s1/overdue-files/overdue-a.png' };
    const f0 = { name: 'old.pdf', mime: 'application/pdf', size: 4096, uploadedAt: null, url: '/api/v1/staff/work/orders/o1/parcels/s1/overdue-files/overdue-b.pdf' };
    wrap(<ParcelOverdueReason orderId="o1" parcel={{
      ...parcel,
      overdueReason: { code: 'courier_delay', label: 'Courier delay', note: '', text: 'Courier delay', by: 'Aromal S', at: null, attachment: f1 },
      overdueReasonHistory: [
        { code: 'courier_delay', label: 'Courier delay', note: '', forDate: '2026-11-17', by: 'Aromal S', at: '2026-11-20T05:00:00Z', attachment: f1 },
        { code: 'address_issue', label: 'Address issue', note: '', forDate: '2026-11-17', by: 'Admin', at: '2026-11-19T05:00:00Z', attachment: null },
        { code: 'supplier_delay', label: 'Supplier delay', note: '', forDate: '2026-11-17', by: 'Admin', at: '2026-11-18T05:00:00Z', attachment: f0 },
      ],
    }} />);
    expect(screen.getByRole('link', { name: 'Open file courier page.png' })).toHaveAttribute('href', f1.url);
    fireEvent.click(screen.getByRole('button', { name: /Reasons given \(3\)/ }));
    expect(screen.getAllByRole('link', { name: 'Open file courier page.png' })).toHaveLength(2);
    const old = screen.getByRole('link', { name: 'Open file old.pdf' });
    expect(old).toHaveAttribute('href', f0.url);
    expect(old).toHaveAttribute('target', '_blank');
  });
});

describe('EtaRowBadge', () => {
  it('hovering Overdue shows the reason, or that none was given', () => {
    const { rerender } = render(<EtaRowBadge eta={{ overdue: 1, dueToday: 0, missing: 0, earliest: '2026-11-17', noReason: 1, reason: null }} />);
    expect(screen.getByTitle('No reason for overdue yet')).toHaveTextContent('Overdue· no reason');
    rerender(<EtaRowBadge eta={{ overdue: 1, dueToday: 0, missing: 0, earliest: '2026-11-17', noReason: 0, reason: { text: 'Courier delay', by: 'Aromal S', at: null } }} />);
    expect(screen.getByTitle('Reason: Courier delay (Aromal S)')).toHaveTextContent(/^Overdue$/);
  });
});
