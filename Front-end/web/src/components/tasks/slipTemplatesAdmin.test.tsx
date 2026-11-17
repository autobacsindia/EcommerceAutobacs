/**
 * Admin → Slip templates. The server validates every definition
 * (Back-end tests/slipTemplates.test.js); these pin what the screen lists,
 * what each button sends, and that refusals are shown as the server words them.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import SlipTemplatesAdmin, { insertAt, type SlipEditorOptions, type SlipTemplate } from './SlipTemplatesAdmin';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'X-XSRF-TOKEN': 't' }) },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SlipTemplatesAdmin /></QueryClientProvider>,
);

const tpl = (over: Partial<SlipTemplate>): SlipTemplate => ({
  id: 't1', key: 'delivery', label: 'Delivery slip', title: 'DELIVERY SLIP', forms: ['sales'], fields: [],
  blocks: [{ type: 'section', title: 'Customer', keys: ['customerName'] }], needs: [], declaration: '', signatures: ['Customer'],
  active: true, isDefault: true, order: 10, rev: 3, archivedAt: null, updatedAt: null, updatedByName: '', ...over,
});
const OPTIONS: SlipEditorOptions = {
  forms: [
    { key: 'general', label: 'General', fields: [] },
    { key: 'sales', label: 'Sales job', fields: [{ key: 'customerName', label: 'Customer name', type: 'text' }, { key: 'vehicleReg', label: 'Registration no.', type: 'text' }] },
  ],
  computed: [{ key: 'today', label: 'Date', type: 'date' }],
  fieldTypes: ['text', 'textarea', 'phone', 'date', 'number', 'money', 'items'],
  limits: { fields: 30, blocks: 30, signatures: 4, templates: 50 },
};
const LIST = {
  templates: [
    tpl({}),
    tpl({ id: 't2', key: 'gate_pass', label: 'Gate pass', isDefault: false, active: false, rev: 1 }),
    tpl({ id: 't3', key: 'old_note', label: 'Old note', isDefault: false, archivedAt: '2026-11-01T00:00:00Z', rev: 2 }),
  ],
  options: OPTIONS,
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue(LIST);
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the list', () => {
  it('shows the summary, live slips with their state, and deleted ones apart', async () => {
    wrap();
    const delivery = (await screen.findByText('Delivery slip')).closest('li')!;
    expect(delivery).toHaveTextContent('Built in');
    expect(delivery).toHaveTextContent('Sales job · one click');
    expect(screen.getByText('Gate pass').closest('li')).toHaveTextContent('Hidden');
    expect(within(screen.getByRole('region', { name: 'Deleted' })).getByText('Old note')).toBeInTheDocument();
    expect(screen.getByText(/Project summary/)).toBeInTheDocument();
    // Reset only for built-in slips.
    expect(within(delivery).getByRole('button', { name: /Reset/ })).toBeInTheDocument();
    expect(within(screen.getByText('Gate pass').closest('li')!).queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument();
  });

  it('Hide / Show, Delete, Restore and Reset send the rev and the one change', async () => {
    patch.mockResolvedValue({ template: tpl({}) });
    post.mockResolvedValue({ template: tpl({}) });
    wrap();
    const delivery = (await screen.findByText('Delivery slip')).closest('li')!;
    fireEvent.click(within(delivery).getByRole('button', { name: /Hide/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/slip-templates/t1', expect.objectContaining({ rev: 3, active: false, key: 'delivery' })));

    fireEvent.click(within(screen.getByText('Gate pass').closest('li')!).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/slip-templates/t2', { rev: 1, archived: true }));

    fireEvent.click(within(screen.getByRole('region', { name: 'Deleted' })).getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/slip-templates/t3', { rev: 2, archived: false }));

    fireEvent.click(within(delivery).getByRole('button', { name: /Reset/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/slip-templates/t1/reset', { rev: 3 }));
  });

  it('Delete asks first; saying no sends nothing', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    wrap();
    fireEvent.click(within((await screen.findByText('Gate pass')).closest('li')!).getByRole('button', { name: /Delete/ }));
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('the editor', () => {
  it('a new slip: box codes follow their names, placeholders insert, and the whole definition is sent', async () => {
    post.mockResolvedValue({ template: tpl({ id: 't9', key: 'gate_out', label: 'Gate out' }) });
    wrap();
    await screen.findByText('Delivery slip');
    fireEvent.click(screen.getByRole('button', { name: /New slip/ }));
    fireEvent.change(screen.getByLabelText('Name in the menu'), { target: { value: 'Gate out' } });
    fireEvent.change(screen.getByLabelText('Heading printed on the slip'), { target: { value: 'GATE PASS' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'Gate_Out' } });
    fireEvent.click(screen.getByLabelText('Sales job projects'));

    fireEvent.click(screen.getByRole('button', { name: /Add a box/ }));
    fireEvent.change(screen.getByLabelText('Box 1 name'), { target: { value: 'Driver name' } });
    expect(screen.getByLabelText('Box 1 code')).toHaveValue('driverName');

    // The first block becomes a paragraph naming the driver and the vehicle.
    fireEvent.change(screen.getByLabelText('Block 1 kind'), { target: { value: 'paragraph' } });
    fireEvent.change(screen.getByLabelText('Block 1 text'), { target: { value: 'Let ' } });
    const chips = screen.getByLabelText('Block 1 text').parentElement!;
    fireEvent.click(within(chips).getByRole('button', { name: 'Driver name' }));
    fireEvent.click(within(chips).getByRole('button', { name: 'Registration no.' }));
    expect(screen.getByLabelText('Block 1 text')).toHaveValue('Let {{driverName}}{{vehicleReg}}');

    fireEvent.click(screen.getByRole('button', { name: /^Add slip$/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/admin/slip-templates', expect.objectContaining({
      key: 'gate_out', label: 'Gate out', title: 'GATE PASS', forms: ['sales'],
      fields: [{ key: 'driverName', label: 'Driver name', type: 'text' }],
      blocks: [{ type: 'paragraph', text: 'Let {{driverName}}{{vehicleReg}}' }],
      signatures: ['Authorised signatory'],
    }));
    expect(toast.success).toHaveBeenCalled();
    expect(await screen.findByText('Delivery slip')).toBeInTheDocument(); // back on the list
  });

  it('editing: the code is fixed, the server’s refusal is shown as is, the form stays', async () => {
    patch.mockRejectedValue(Object.assign(new Error('x'), { status: 400, rawData: { message: 'Block 1 prints “nope”, which is not a box of this slip or a detail of its forms.' } }));
    wrap();
    fireEvent.click(within((await screen.findByText('Delivery slip')).closest('li')!).getByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('Code')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Block 1 prints “nope”, which is not a box of this slip or a detail of its forms.'));
    expect(patch.mock.calls[0][1]).toMatchObject({ rev: 3, label: 'Delivery slip' });
    expect(screen.getByLabelText('Name in the menu')).toHaveValue('Delivery slip');
  });

  it('someone saved first: says who, keeps the form, and the next Save carries their rev', async () => {
    patch.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409 }));
    patch.mockResolvedValueOnce({ template: tpl({ rev: 5 }) });
    wrap();
    fireEvent.click(within((await screen.findByText('Delivery slip')).closest('li')!).getByRole('button', { name: /Edit/ }));
    get.mockResolvedValue({ ...LIST, templates: [tpl({ rev: 4, updatedByName: 'Nevin' }), ...LIST.templates.slice(1)] });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Nevin changed this slip just now/)));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1][1].rev).toBe(4);
  });

  it('Preview posts the draft (a new one gets a stand-in code) and opens the PDF; a refusal closes the tab', async () => {
    const tab = { location: { href: '' }, close: jest.fn() };
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const created = jest.fn(() => 'blob:pdf');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: jest.fn() });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'])) });
    global.fetch = fetchMock as unknown as typeof fetch;
    wrap();
    await screen.findByText('Delivery slip');
    fireEvent.click(screen.getByRole('button', { name: /New slip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Preview PDF/ }));
    await waitFor(() => expect(tab.location.href).toBe('blob:pdf'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/slip-templates/preview');
    expect(init.headers['X-XSRF-TOKEN']).toBe('t');
    expect(JSON.parse(init.body).key).toBe('preview_draft');

    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ message: 'Add at least one block to print.' }) });
    fireEvent.click(screen.getByRole('button', { name: /Preview PDF/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Add at least one block to print.');
  });
});

describe('preview with pop-ups blocked', () => {
  it('downloads the PDF instead of leaving the page, so the draft is kept', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:pdf'), revokeObjectURL: jest.fn() });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'])) }) as unknown as typeof fetch;
    const clicked: string[] = [];
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    wrap();
    await screen.findByText('Delivery slip');
    fireEvent.click(screen.getByRole('button', { name: /New slip/ }));
    fireEvent.change(screen.getByLabelText('Name in the menu'), { target: { value: 'Draft kept' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview PDF/ }));
    await waitFor(() => expect(clicked).toEqual(['Slip-preview.pdf']));
    expect(screen.getByLabelText('Name in the menu')).toHaveValue('Draft kept');
    click.mockRestore();
  });
});

describe('insertAt', () => {
  it('puts the placeholder at the cursor of the focused paragraph, else at the end', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.value = 'Allow  to drive';
    ta.focus();
    ta.setSelectionRange(6, 6);
    expect(insertAt(ta, ta.value, '{{driverName}}')).toBe('Allow {{driverName}} to drive');
    ta.blur();
    expect(insertAt(ta, 'Allow', '{{x}}')).toBe('Allow{{x}}');
    expect(insertAt(null, 'Allow', '{{x}}')).toBe('Allow{{x}}');
    ta.remove();
  });
});
