/**
 * A project's Job details box, its editor, the "Create slip" menu and the
 * owner's daily pop-up. The server checks every field and works out the
 * balance (Back-end tests/staffProjectDetails.test.js); these pin what the
 * screen shows and sends.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ProjectDetailsPanel, shownValue, slipHref } from './ProjectDetails';
import ProjectReminderPopup from './ProjectReminderPopup';
import type { Project, ProjectDetails, ProjectReminder, ProjectSlip } from './types';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, onClick, className }: { children: React.ReactNode; href: string; onClick?: () => void; className?: string }) => <a href={href} onClick={onClick} className={className}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const f = (key: string, label: string, type: string, group: string) => ({ key, label, type, group });
const TEMPLATES = {
  templates: [
    { key: 'general', label: 'General', hint: '', groups: {}, fields: [] },
    {
      key: 'sales', label: 'Sales job (customer + vehicle)', hint: 'A customer’s vehicle job',
      groups: { customer: 'Customer', vehicle: 'Vehicle', job: 'The job', money: 'Amounts' },
      fields: [
        f('customerName', 'Customer name', 'text', 'customer'), f('customerPhone', 'Phone', 'phone', 'customer'),
        f('vehicleModel', 'Vehicle model', 'text', 'vehicle'), f('vehicleReceivedOn', 'Date vehicle received', 'date', 'vehicle'),
        f('workToDo', 'Work being done', 'textarea', 'job'),
        f('amountQuoted', 'Amount quoted (₹)', 'money', 'money'), f('advancePaid', 'Advance paid (₹)', 'money', 'money'),
      ],
    },
  ],
  limits: { customFields: 20, customLabel: 40, customValue: 300 },
};
const DETAILS: ProjectDetails = {
  template: 'sales', templateLabel: 'Sales job (customer + vehicle)',
  values: { customerName: 'Vicky', vehicleModel: 'Toyota Hilux', vehicleReceivedOn: '2026-11-10', amountQuoted: 85000, advancePaid: 25000 },
  custom: [{ label: 'Key tag', value: '14' }],
  order: { id: 'o1', number: '#AB12CD34' },
  balance: 60000,
  updatedAt: '2026-11-17T05:00:00Z', updatedByName: 'Ravi',
};
const slip = (key: string, label: string, over: Partial<ProjectSlip> = {}): ProjectSlip => ({ key, label, missing: [], fields: [], values: {}, ...over });
const SLIPS: ProjectSlip[] = [
  slip('delivery', 'Delivery slip', { missing: ['Phone', 'Work being done'] }),
  slip('job_card', 'Job card'),
  slip('vehicle_authorisation', 'Vehicle authorisation', {
    fields: [
      { key: 'driverName', label: 'Driver name', type: 'text' },
      { key: 'driverLicence', label: 'Driving licence no.', type: 'text', upper: true },
      { key: 'validFrom', label: 'Valid from', type: 'date' },
    ],
    values: { driverName: 'Suresh' },
    missing: ['Driving licence no.'],
  }),
  slip('office_supplies', 'Office supplies purchase', {
    fields: [{ key: 'month', label: 'Month', type: 'text' }, { key: 'items', label: 'Items', type: 'items' }],
    values: { month: 'November 2026', items: [{ name: 'A4 paper', qty: 2, rate: 260 }] },
  }),
  slip('summary', 'Project summary'),
];
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Vicky’s Hilux', description: '', colour: 'blue',
  owner: { id: 'n1', name: 'Nevin' }, people: [{ id: 'n1', name: 'Nevin', team: 'operations' }],
  teams: [{ value: 'operations', label: 'Operations' }], startOn: null, dueOn: null,
  status: 'on_track', statusLabel: 'On track', statusOverride: null,
  progress: { total: 0, done: 0, overdue: 0, percent: 0 }, archivedAt: null,
  createdBy: { id: 'a1', name: 'Vyshnav' }, rev: 4, details: DETAILS, slips: SLIPS,
  can: { edit: true, archive: true, restore: false, editDetails: true, fillFromOrder: true },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/projects/templates') return Promise.resolve(TEMPLATES);
    if (url.includes('/details/from-order')) return Promise.resolve({ order: { id: 'o9', number: '#45123' }, values: { customerName: 'Vicky Kumar', customerPhone: '9847012345' } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
});

describe('Job details box', () => {
  it('shows the stored details in groups, with the server’s balance', async () => {
    wrap(<ProjectDetailsPanel p={project()} />);
    const box = screen.getByRole('region', { name: 'Job details' });
    expect(await within(box).findByText('Vicky')).toBeInTheDocument();
    expect(within(box).getByText('Toyota Hilux')).toBeInTheDocument();
    expect(within(box).getByText('₹85,000')).toBeInTheDocument();
    expect(within(box).getByText('Balance due').nextSibling).toHaveTextContent('₹60,000');
    expect(within(box).getByText('Key tag').nextSibling).toHaveTextContent('14');
    expect(within(box).getByText('#AB12CD34')).toBeInTheDocument();
    // The order number keeps its copy button (no session here, so plain text rather than a link).
    expect(within(box).getByRole('button', { name: 'Copy order number #AB12CD34' })).toBeInTheDocument();
    expect(within(box).getByText('Last changed by Ravi')).toBeInTheDocument();
  });

  it('empty: says what goes here, and offers Add details only to those who may', async () => {
    const { unmount } = wrap(<ProjectDetailsPanel p={project({ details: null })} />);
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add details/ })).toBeInTheDocument();
    unmount();
    wrap(<ProjectDetailsPanel p={project({ details: null, can: { edit: false, archive: false, restore: false, editDetails: false } })} />);
    expect(screen.queryByRole('button', { name: /Add details/ })).not.toBeInTheDocument();
  });

  it('Create slip: one link per slip, opening the server’s PDF, with what will print blank', () => {
    wrap(<ProjectDetailsPanel p={project()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    const menu = screen.getByRole('list', { name: 'Slips' });
    const delivery = within(menu).getByRole('link', { name: /Delivery slip/ });
    expect(delivery).toHaveAttribute('href', '/api/v1/staff/tasks/projects/p1/slip/delivery');
    expect(delivery).toHaveAttribute('target', '_blank');
    expect(delivery).toHaveTextContent('Blank to fill by hand: Phone, Work being done');
    expect(within(menu).getByRole('link', { name: /Job card/ })).not.toHaveTextContent('Blank');
    // Slips with boxes of their own ask first: a button, not a link.
    expect(within(menu).getAllByRole('link')).toHaveLength(3);
    expect(within(menu).getByRole('button', { name: /Vehicle authorisation/ })).toHaveTextContent('Asks for: Driver name, Driving licence no., Valid from');
    // Its own boxes are asked next, so they are not warned about as blank.
    expect(within(menu).getByRole('button', { name: /Vehicle authorisation/ })).not.toHaveTextContent('Blank');
  });

  it('a slip with its own boxes: prefilled from last time, saved with the rev, then the PDF opens', async () => {
    const tab = { location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    put.mockResolvedValue({ project: project({ rev: 5 }) });
    wrap(<ProjectDetailsPanel p={project()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Vehicle authorisation/ }));
    expect(screen.getByLabelText('Driver name')).toHaveValue('Suresh');
    fireEvent.change(screen.getByLabelText('Driving licence no.'), { target: { value: ' kl0720110012345 ' } });
    fireEvent.change(screen.getByLabelText('Valid from'), { target: { value: '2026-11-18' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Create slip$/ }));
    // The tab opens inside the click (pop-up blockers), before the save.
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() => expect(tab.location.href).toBe('/api/v1/staff/tasks/projects/p1/slip/vehicle_authorisation'));
    expect(put).toHaveBeenCalledWith('/staff/tasks/projects/p1/slips/vehicle_authorisation', {
      rev: 4, values: { driverName: 'Suresh', driverLicence: 'kl0720110012345', validFrom: '2026-11-18' },
    });
    open.mockRestore();
  });

  it('an item list: rows added and removed, empty rows dropped, no totals sent', async () => {
    const tab = { location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    put.mockResolvedValue({ project: project() });
    wrap(<ProjectDetailsPanel p={project()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Office supplies purchase/ }));
    expect(screen.getByLabelText('Item 1')).toHaveValue('A4 paper');
    fireEvent.click(screen.getByRole('button', { name: /Add an item/ }));
    fireEvent.change(screen.getByLabelText('Item 2'), { target: { value: 'Pens' } });
    fireEvent.change(screen.getByLabelText('Item 2 quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Item 2 rate'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Add an item/ })); // left empty
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Create slip$/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const sent = put.mock.calls[0][1].values;
    expect(sent.items).toEqual([{ name: 'A4 paper', qty: '2', rate: '260' }, { name: 'Pens', qty: '10', rate: '12.5' }]);
    expect(JSON.stringify(sent)).not.toMatch(/amount|total/i);
    open.mockRestore();
  });

  it('a refused save closes the blank tab and shows why; the answers stay', async () => {
    const tab = { location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    put.mockRejectedValue(Object.assign(new Error('x'), { status: 400, rawData: { message: 'Valid to cannot be before valid from.' } }));
    wrap(<ProjectDetailsPanel p={project()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Vehicle authorisation/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Create slip$/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Valid to cannot be before valid from.');
    expect(tab.location.href).toBe('');
    expect(screen.getByLabelText('Driver name')).toHaveValue('Suresh');
    open.mockRestore();
  });

  it('someone who may not edit the project gets the slips as plain links', () => {
    wrap(<ProjectDetailsPanel p={project({ can: { edit: false, archive: false, restore: false, editDetails: false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    expect(within(screen.getByRole('list', { name: 'Slips' })).getByRole('link', { name: /Vehicle authorisation/ }))
      .toHaveAttribute('href', '/api/v1/staff/tasks/projects/p1/slip/vehicle_authorisation');
  });

  it('a project with no slips listed still offers the summary slip', () => {
    wrap(<ProjectDetailsPanel p={project({ details: null, slips: undefined })} />);
    fireEvent.click(screen.getByRole('button', { name: /Create slip/ }));
    expect(within(screen.getByRole('list', { name: 'Slips' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Project summary']);
  });
});

describe('the editor', () => {
  const openEditor = async (p = project()) => {
    wrap(<ProjectDetailsPanel p={p} />);
    fireEvent.click(screen.getByRole('button', { name: p.details ? /Edit details/ : /Add details/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Job details' });
    await within(dialog).findByRole('button', { name: /Save details/ }); // the form is drawn once the templates load
    return dialog;
  };

  it('sends the form’s fields, trimmed of empty ones, and never a balance', async () => {
    put.mockResolvedValue({ project: project() });
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '9847012345' } });
    fireEvent.change(within(dialog).getByLabelText('Vehicle model'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save details/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/staff/tasks/projects/p1/details');
    expect(body).toEqual({
      rev: 4, template: 'sales',
      values: { customerName: 'Vicky', customerPhone: '9847012345', vehicleReceivedOn: '2026-11-10', amountQuoted: '85000', advancePaid: '25000' },
      custom: [{ label: 'Key tag', value: '14' }],
    });
    expect(toast.success).toHaveBeenCalledWith('Details saved');
  });

  it('a new sales/operations project opens on the sales form', async () => {
    const dialog = await openEditor(project({ details: null }));
    expect(within(dialog).getByRole('combobox')).toHaveValue('sales');
    expect(within(dialog).getByLabelText('Customer name')).toHaveValue('');
  });

  it('fills the customer from an order, links it, and saves the link', async () => {
    put.mockResolvedValue({ project: project() });
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('Order number or link'), { target: { value: '#45123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fill' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Customer name')).toHaveValue('Vicky Kumar'));
    expect(get).toHaveBeenCalledWith('/staff/tasks/projects/p1/details/from-order?q=%2345123');
    expect(within(dialog).getByText(/Linked to order #45123/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save details/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toMatchObject({ orderId: 'o9', values: { customerPhone: '9847012345' } });
  });

  it('hides "fill from order" from people whose team does not handle orders', async () => {
    const dialog = await openEditor(project({ can: { edit: true, archive: true, restore: false, editDetails: true, fillFromOrder: false } }));
    expect(within(dialog).queryByLabelText('Order number or link')).not.toBeInTheDocument();
  });

  it('extra fields: add and remove; empty rows are not sent', async () => {
    put.mockResolvedValue({ project: project() });
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: /Add a field/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove extra field 1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Save details/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1].custom).toEqual([]);
  });

  it('when someone else saved first: says so and keeps the form open', async () => {
    put.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save details/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Someone changed this project/)));
    expect(screen.getByRole('dialog', { name: 'Job details' })).toBeInTheDocument();
  });

  it('shows the server’s refusal as it is', async () => {
    put.mockRejectedValue(Object.assign(new Error('Bad'), { status: 400, rawData: { message: 'Phone: enter a phone number (digits, + - and spaces).' } }));
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save details/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Phone: enter a phone number/)));
  });
});

describe('helpers', () => {
  it('formats values and slip links', () => {
    expect(shownValue({ type: 'money' }, 60000.5)).toBe('₹60,000.50');
    expect(shownValue({ type: 'number' }, 18250)).toBe('18,250');
    expect(shownValue({ type: 'text' }, '')).toBe('');
    expect(slipHref('p 1', 'job_card')).toBe('/api/v1/staff/tasks/projects/p%201/slip/job_card');
  });
});

describe('the daily pop-up', () => {
  const NONE_MINE: ProjectReminder['mine'] = { overdue: [], today: [], soon: [], noDate: [], counts: { overdue: 0, today: 0, soon: 0, noDate: 0, later: 0 } };
  const REMINDER: ProjectReminder = {
    day: '2026-11-17',
    weekly: false,
    mine: NONE_MINE,
    deadlines: [],
    team: [],
    projects: [{
      id: 'p1', name: 'Vicky’s Hilux', colour: 'blue', dueOn: '2026-11-20', projectLate: false, projectDueToday: false,
      open: 3, late: 1, dueToday: 1,
      lateTasks: [{ id: 't1', title: 'Fit seat covers', dueOn: '2026-11-15' }],
      dueTodayTasks: [{ id: 't2', title: 'Roof rack', dueOn: '2026-11-17' }],
      notUpdated: [{ id: 'u5', name: 'Nevin', late: 1, daysLate: 2, lastUpdate: '2026-11-10T06:00:00.000Z' }],
    }],
    totals: { open: 3, late: 1, dueToday: 1 },
  };
  const HILUX = { id: 'p1', name: 'Vicky’s Hilux', colour: 'blue' };
  const item = (id: string, title: string, dueOn: string | null, daysLate = 0) => ({ id, code: `T-${id}`, title, dueOn, daysLate, project: HILUX });

  it('shows the owner what is open, due today and late; Got it dismisses it for the day', async () => {
    get.mockResolvedValue({ reminder: REMINDER });
    post.mockResolvedValue({ ok: true });
    wrap(<ProjectReminderPopup tasksHref="/team/tasks" />);
    const dialog = await screen.findByRole('dialog', { name: 'Your projects today' });
    expect(within(dialog).getByText(/3 open tasks/)).toBeInTheDocument();
    expect(within(dialog).getByText('Fit seat covers')).toBeInTheDocument();
    expect(within(dialog).getByText('Roof rack')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Vicky’s Hilux/ })).toHaveAttribute('href', '/team/tasks?view=project&project=p1');
    // The owner sees who has late work.
    expect(within(dialog).getByText('Not updated')).toBeInTheDocument();
    expect(within(dialog).getByText('Nevin')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 late item \(up to 2 days\) · last update 10 Nov/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/projects/reminder/dismiss', { day: '2026-11-17' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a member: overdue first (red, “please update”), then today, then soon; each task opens', async () => {
    get.mockResolvedValue({
      reminder: {
        ...REMINDER,
        projects: [],
        mine: {
          overdue: [item('t1', 'Fit roof rack', '2026-11-15', 2)],
          today: [item('t2', 'Order mats', '2026-11-17')],
          soon: [item('t3', 'Book alignment', '2026-11-19')],
          noDate: [],
          counts: { overdue: 1, today: 1, soon: 1, noDate: 4, later: 2 },
        },
        deadlines: [{ ...HILUX, dueOn: '2026-11-17', daysLate: 0, open: 3 }],
      },
    });
    wrap(<ProjectReminderPopup tasksHref="/team/tasks" />);
    const dialog = await screen.findByRole('dialog', { name: 'Your projects today' });
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('1 item overdue — please update');
    const headings = within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue (1)', 'Due today (1)', 'Due in the next 2 days (1)', 'Project deadlines']);
    expect(within(dialog).getByRole('link', { name: 'Fit roof rack' })).toHaveAttribute('href', '/team/tasks/t1');
    expect(within(dialog).getByText(/2 days late/)).toBeInTheDocument();
    expect(within(dialog).getByText(/deadline today · 3 open/)).toBeInTheDocument();
    expect(within(dialog).getByText('2 more tasks due later — nothing to do yet.')).toBeInTheDocument();
    // Undated work waits for Monday.
    expect(within(dialog).queryByText(/No due date/)).toBeNull();
  });

  it('Mondays list the undated work; the admin sees everyone with late work', async () => {
    get.mockResolvedValue({
      reminder: {
        ...REMINDER,
        weekly: true,
        projects: [],
        mine: { ...NONE_MINE, noDate: [item('t4', 'Find a supplier', null)], counts: { ...NONE_MINE.counts, noDate: 1 } },
        team: [{ id: 'u5', name: 'Nevin', late: 3, daysLate: 6, lastUpdate: null }],
      },
    });
    wrap(<ProjectReminderPopup tasksHref="/admin/tasks" />);
    const dialog = await screen.findByRole('dialog', { name: 'Your projects today' });
    expect(within(dialog).getByText('No due date — add one (1)')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Find a supplier' })).toHaveAttribute('href', '/admin/tasks/t4');
    expect(within(dialog).getByText('Late work across projects')).toBeInTheDocument();
    expect(within(dialog).getByText(/3 late items \(up to 6 days\) · no update yet/)).toBeInTheDocument();
  });

  it('nothing to say: no pop-up', async () => {
    get.mockResolvedValue({ reminder: null });
    wrap(<ProjectReminderPopup tasksHref="/team/tasks" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks/projects/reminder'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failed read shows nothing rather than an error over the panel', async () => {
    get.mockRejectedValue(new Error('offline'));
    wrap(<ProjectReminderPopup tasksHref="/admin/tasks" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
