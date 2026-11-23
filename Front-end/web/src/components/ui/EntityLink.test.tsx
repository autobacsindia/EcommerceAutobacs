/**
 * IDs in the panels open the item's page — but only for a role that may open it.
 *
 * The contract: the right panel address per type and role; a role with no page
 * gets plain text (still copyable), never a link to "Not authorized"; nothing to
 * show → nothing rendered; the copy button keeps working; a click on the link
 * never reaches the row it sits in.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import AuthContext from '@/context/AuthContext';
import EntityLink from './EntityLink';
import { entityHref, viewerOf, type EntityType, type Viewer } from '@/lib/entityLinks';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const ID = 'a'.repeat(24);
const admin: Viewer = { role: 'admin' };
const staff = (team: string, extra: Partial<{ isHead: boolean; canSell: boolean }> = {}): Viewer => (
  { role: 'staff', team: team as never, isHead: false, canSell: false, ...extra }
);
const accounts = staff('accounts');
const procurement = staff('procurement');
const operations = staff('operations');
const marketing = staff('marketing');
const marketingHead = staff('marketing', { isHead: true });
const gtmHead = staff('sales', { isHead: true, canSell: true });
const gtmLead = staff('sales', { canSell: true });
const gtmSupport = staff('sales');
const developer = staff('developer');

describe('entityHref — orders', () => {
  it.each([
    ['admin', admin, `/admin/orders/${ID}`],
    ['accounts', accounts, `/team/orders/${ID}`],
    ['procurement', procurement, `/team/orders/${ID}`],
    ['operations', operations, `/team/orders/${ID}`],
    ['GTM head', gtmHead, `/team/orders/${ID}`],
    ['GTM lead', gtmLead, `/team/sales/orders/${ID}`],
    ['marketing member', marketing, `/team/marketing/orders/${ID}`],
    ['marketing head', marketingHead, `/team/marketing/orders/${ID}`],
  ])('%s opens the order by id', (_n, v, href) => {
    expect(entityHref('order', { id: ID, query: 'AB1001' }, v)).toBe(href);
  });

  it.each([
    ['admin', admin, '/admin/orders?search=AB1001'],
    ['accounts', accounts, '/team/orders?q=AB1001'],
    ['operations', operations, '/team/orders?q=AB1001'],
    ['procurement', procurement, '/team/procurement?list=all&q=AB1001'],
    ['GTM head', gtmHead, '/team/sales?q=AB1001'],
    ['GTM lead', gtmLead, '/team/sales?q=AB1001'],
    ['marketing', marketing, '/team/marketing/orders?search=AB1001'],
  ])('%s with only the number searches for it', (_n, v, href) => {
    expect(entityHref('order', { query: 'AB1001' }, v)).toBe(href);
  });

  it('an invoice opens its order', () => {
    expect(entityHref('invoice', { id: ID }, accounts)).toBe(`/team/orders/${ID}`);
    expect(entityHref('invoice', { id: ID }, admin)).toBe(`/admin/orders/${ID}`);
  });

  it.each([['GTM support', gtmSupport], ['developer', developer], ['HR', staff('hr')]])('%s has no order page → no link', (_n, v) => {
    expect(entityHref('order', { id: ID, query: 'AB1001' }, v)).toBeNull();
  });

  it('encodes what goes into the address', () => {
    expect(entityHref('order', { query: 'AB 10&1' }, admin)).toBe('/admin/orders?search=AB+10%261');
    expect(entityHref('order', { id: 'x/y' }, admin)).toBe('/admin/orders/x%2Fy');
  });
});

describe('entityHref — other types', () => {
  it('tasks and projects open on every team\'s Tasks page', () => {
    for (const v of [accounts, procurement, operations, marketing, gtmSupport, developer]) {
      expect(entityHref('task', { id: ID }, v)).toBe(`/team/tasks/${ID}`);
      expect(entityHref('project', { id: ID, query: 'PRJ-7' }, v)).toBe(`/team/tasks?view=project&project=${ID}`);
    }
    expect(entityHref('task', { id: ID }, admin)).toBe(`/admin/tasks/${ID}`);
    expect(entityHref('project', { id: ID }, admin)).toBe(`/admin/tasks?view=project&project=${ID}`);
    // A project code alone has no page to point at.
    expect(entityHref('project', { query: 'PRJ-7' }, admin)).toBeNull();
  });

  it('quotations: GTM sellers only', () => {
    expect(entityHref('quotation', { id: ID }, gtmLead)).toBe(`/team/sales/quotations/${ID}`);
    expect(entityHref('quotation', { id: ID }, gtmHead)).toBe(`/team/sales/quotations/${ID}`);
    for (const v of [admin, accounts, procurement, gtmSupport]) expect(entityHref('quotation', { id: ID }, v)).toBeNull();
  });

  it('supplier enquiries: procurement and admin', () => {
    expect(entityHref('enquiry', { id: ID }, procurement)).toBe(`/team/supplier-enquiries/${ID}`);
    expect(entityHref('enquiry', { id: ID }, admin)).toBe(`/admin/supplier-enquiries/${ID}`);
    expect(entityHref('enquiry', { id: ID }, accounts)).toBeNull();
  });

  it('suppliers: the directory searched for the name (procurement, accounts, admin)', () => {
    expect(entityHref('supplier', { query: 'Ram Traders' }, procurement)).toBe('/team/suppliers?q=Ram+Traders');
    expect(entityHref('supplier', { query: 'Ram Traders' }, accounts)).toBe('/team/suppliers?q=Ram+Traders');
    expect(entityHref('supplier', { query: 'Ram Traders' }, admin)).toBe('/admin/suppliers?q=Ram+Traders');
    expect(entityHref('supplier', { query: 'Ram Traders' }, operations)).toBeNull();
  });

  it('returns: the returns list searched for it', () => {
    expect(entityHref('return', { query: 'RT-9' }, operations)).toBe('/team/returns?q=RT-9');
    expect(entityHref('return', { query: 'RT-9' }, accounts)).toBe('/team/returns?q=RT-9');
    expect(entityHref('return', { query: 'RT-9' }, gtmLead)).toBe('/team/returns?q=RT-9');
    expect(entityHref('return', { query: 'RT-9' }, admin)).toBe('/admin/returns?q=RT-9');
    expect(entityHref('return', { query: 'RT-9' }, marketing)).toBeNull();
  });

  it('leads and customers', () => {
    expect(entityHref('lead', { id: ID }, admin)).toBe(`/admin/leads/${ID}`);
    expect(entityHref('lead', { id: ID }, marketing)).toBe(`/team/marketing/leads/${ID}`);
    expect(entityHref('lead', { id: ID, query: 'Ravi' }, gtmSupport)).toBe('/team/leads?q=Ravi');
    expect(entityHref('lead', { id: ID }, accounts)).toBeNull();
    expect(entityHref('customer', { query: 'ravi@example.com' }, admin)).toBe('/admin/users?search=ravi%40example.com');
    expect(entityHref('customer', { query: 'ravi@example.com' }, accounts)).toBeNull();
  });

  it.each<EntityType>(['order', 'invoice', 'task', 'project', 'quotation', 'enquiry', 'supplier', 'return', 'lead', 'customer'])(
    '%s: nothing to point at, or nobody signed in → no link',
    (type) => {
      expect(entityHref(type, { id: '', query: '  ' }, admin)).toBeNull();
      expect(entityHref(type, { id: ID, query: 'X' }, null)).toBeNull();
    },
  );
});

describe('viewerOf', () => {
  it('reads the role and team from the signed-in user', () => {
    expect(viewerOf({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(viewerOf({ role: 'staff', staff: { team: 'accounts', isHead: true } })).toEqual({ role: 'staff', team: 'accounts', isHead: true, canSell: false });
    // Older sessions predate canSell: a GTM member then was a seller.
    expect(viewerOf({ role: 'staff', staff: { team: 'sales' } })).toMatchObject({ canSell: true });
    expect(viewerOf({ role: 'staff', staff: { team: 'sales', canSell: false } })).toMatchObject({ canSell: false });
    expect(viewerOf({ role: 'customer' })).toBeNull();
    expect(viewerOf({ role: 'staff', staff: null })).toBeNull();
    expect(viewerOf(null)).toBeNull();
  });
});

describe('<EntityLink>', () => {
  const as = (user: unknown, ui: ReactElement) => render(
    <AuthContext.Provider value={{ user } as never}>{ui}</AuthContext.Provider>,
  );
  const accountsUser = { role: 'staff', staff: { team: 'accounts', isHead: false } };
  const writeText = jest.fn().mockResolvedValue(undefined);
  beforeAll(() => { Object.assign(navigator, { clipboard: { writeText } }); });
  beforeEach(() => writeText.mockClear());

  it('links the order number to the order and keeps the copy button', async () => {
    as(accountsUser, <EntityLink type="order" id={ID} value="AB1001" label="Order number" />);
    const link = screen.getByRole('link', { name: 'AB1001' });
    expect(link).toHaveAttribute('href', `/team/orders/${ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy order number AB1001' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AB1001'));
  });

  it('a role without the page gets plain text, still copyable', async () => {
    as({ role: 'staff', staff: { team: 'developer', isHead: false } }, <EntityLink type="order" id={ID} value="AB1001" label="Order number" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('AB1001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy order number AB1001' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AB1001'));
  });

  it('no session mounted (tests, previews) → plain text', () => {
    render(<EntityLink type="task" id={ID} value="T-1" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('T-1')).toBeInTheDocument();
  });

  it('no id → searches by the number shown', () => {
    as({ role: 'admin' }, <EntityLink type="order" value="AB1001" label="Order number" />);
    expect(screen.getByRole('link', { name: 'AB1001' })).toHaveAttribute('href', '/admin/orders?search=AB1001');
  });

  it('no id and no number → nothing at all', () => {
    const { container } = as({ role: 'admin' }, <EntityLink type="order" id={null} value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows custom text but copies the ID', async () => {
    as({ role: 'admin' }, <EntityLink type="project" id={ID} value="PRJ-7" label="Project ID"><b>PRJ-7</b> Showroom</EntityLink>);
    expect(screen.getByRole('link')).toHaveAttribute('href', `/admin/tasks?view=project&project=${ID}`);
    expect(screen.getByRole('link')).toHaveTextContent('PRJ-7 Showroom');
    fireEvent.click(screen.getByRole('button', { name: 'Copy project ID PRJ-7' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('PRJ-7'));
  });

  it('copy={false} leaves the copy button out', () => {
    as({ role: 'admin' }, <EntityLink type="order" id={ID} value="AB1001" copy={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a click on the link or the copy button never reaches the row', async () => {
    const onRow = jest.fn();
    as(accountsUser, <div onClick={onRow}><EntityLink type="order" id={ID} value="AB1001" label="Order number" /></div>);
    fireEvent.click(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(onRow).not.toHaveBeenCalled();
  });

  it('newTab opens a new tab (screens holding a half-filled form)', () => {
    as({ role: 'admin' }, <EntityLink type="order" id={ID} value="AB1001" newTab />);
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
