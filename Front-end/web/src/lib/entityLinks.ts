/**
 * Where an ID shown in the admin / team panels opens — one table for every
 * screen, so an order number on Payments, Approvals or a task goes to the same
 * place, and to a page the person may actually open.
 *
 * The rule: a link only when the viewer's role has a page for that thing.
 * Otherwise `null`, and the caller shows the ID as plain (still copyable) text —
 * never a link that ends on "Not authorized". The API still decides per record
 * (an order accounts can't see yet answers "not found"); this mirrors the
 * role-level split the panel menus already use (TeamLayoutClient `navFor`).
 *
 * Keep in step with the routes under app/admin and app/team.
 */
import type { StaffTeam } from '@/lib/staffTeams';
import { MARKETING_BASE } from '@/lib/usePanel';

export type EntityType =
  | 'order'
  | 'invoice'
  | 'task'
  | 'project'
  | 'quotation'
  | 'enquiry'
  | 'supplier'
  | 'return'
  | 'lead'
  | 'customer';

/** Who is looking: the signed-in user's role and, for staff, their team. */
export type Viewer =
  | { role: 'admin' }
  | { role: 'staff'; team: StaffTeam; isHead: boolean; canSell: boolean }
  | null;

/**
 * `id`: the record's database id (opens its own page).
 * `query`: what to search for when there is no own page or no id — usually the
 * number shown on screen (an order number, a supplier's name).
 */
export type EntityRef = { id?: string | null; query?: string | null };

type AuthLike = {
  role?: string;
  staff?: { team?: string; isHead?: boolean; canSell?: boolean | null } | null;
} | null | undefined;

/** The viewer from the AuthContext user (null for customers and signed-out). */
export function viewerOf(user: AuthLike): Viewer {
  if (!user) return null;
  if (user.role === 'admin') return { role: 'admin' };
  if (user.role === 'staff' && user.staff?.team) {
    const team = user.staff.team as StaffTeam;
    return {
      role: 'staff',
      team,
      isHead: !!user.staff.isHead,
      // Older sessions predate canSell: a GTM member then was a seller (same default as the team layout).
      canSell: user.staff.canSell ?? team === 'sales',
    };
  }
  return null;
}

const enc = encodeURIComponent;
const withQuery = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`;

/** Order: its own page by id; a search by number when only the number is known. */
function orderHref(v: NonNullable<Viewer>, id: string, q: string): string | null {
  if (v.role === 'admin') return id ? `/admin/orders/${enc(id)}` : q ? withQuery('/admin/orders', { search: q }) : null;
  // Marketing views every order (view + export): the admin screens under /team/marketing.
  if (v.team === 'marketing') {
    return id ? `${MARKETING_BASE}/orders/${enc(id)}` : q ? withQuery(`${MARKETING_BASE}/orders`, { search: q }) : null;
  }
  // The work view (/staff/work/orders/:id): procurement, accounts, operations and the GTM head.
  const workView = ['procurement', 'accounts', 'operations'].includes(v.team) || (v.team === 'sales' && v.isHead);
  if (workView) {
    if (id) return `/team/orders/${enc(id)}`;
    if (!q) return null;
    if (v.team === 'procurement') return withQuery('/team/procurement', { list: 'all', q });
    if (v.team === 'sales') return withQuery('/team/sales', { q });
    return withQuery('/team/orders', { q });
  }
  // GTM leads: their own orders' payment page.
  if (v.team === 'sales' && v.canSell) return id ? `/team/sales/orders/${enc(id)}` : q ? withQuery('/team/sales', { q }) : null;
  return null;
}

/**
 * The panel address for `type`, or null when this viewer has no page for it
 * (or there is nothing to point at). Pure, so every rule is unit-tested.
 */
export function entityHref(type: EntityType, ref: EntityRef, viewer: Viewer): string | null {
  if (!viewer) return null;
  const id = (ref.id ?? '').trim();
  const q = (ref.query ?? '').trim();
  if (!id && !q) return null;
  const admin = viewer.role === 'admin';
  const team = viewer.role === 'staff' ? viewer.team : null;
  const tasksBase = admin ? '/admin/tasks' : '/team/tasks';

  switch (type) {
    case 'order':
    // An invoice is the order's own document: open the order it belongs to.
    case 'invoice':
      return orderHref(viewer, id, q);
    // Tasks and projects: every team has the Tasks page; the API scopes what is in it.
    case 'task':
      return id ? `${tasksBase}/${enc(id)}` : null;
    case 'project':
      return id ? withQuery(tasksBase, { view: 'project', project: id }) : null;
    // Quotations live in the GTM sellers' panel only.
    case 'quotation':
      return viewer.role === 'staff' && team === 'sales' && viewer.canSell && id ? `/team/sales/quotations/${enc(id)}` : null;
    case 'enquiry':
      if (!id) return null;
      if (admin) return `/admin/supplier-enquiries/${enc(id)}`;
      return team === 'procurement' ? `/team/supplier-enquiries/${enc(id)}` : null;
    // The supplier directory has no page per supplier: open it searched for this one.
    case 'supplier':
      if (!q) return null;
      if (admin) return withQuery('/admin/suppliers', { q });
      return team === 'procurement' || team === 'accounts' ? withQuery('/team/suppliers', { q }) : null;
    case 'return':
      if (!q) return null;
      if (admin) return withQuery('/admin/returns', { q });
      if (team === 'operations' || team === 'procurement' || team === 'accounts') return withQuery('/team/returns', { q });
      return viewer.role === 'staff' && team === 'sales' && viewer.canSell ? withQuery('/team/returns', { q }) : null;
    case 'lead':
      if (admin) return id ? `/admin/leads/${enc(id)}` : null;
      if (team === 'marketing') return id ? `${MARKETING_BASE}/leads/${enc(id)}` : null;
      return team === 'sales' && q ? withQuery('/team/leads', { q }) : null;
    // Customer accounts are the admin's (Users); no team page shows them.
    case 'customer':
      if (!admin) return null;
      return q || id ? withQuery('/admin/users', { search: q || id }) : null;
    default:
      return null;
  }
}
