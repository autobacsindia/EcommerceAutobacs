'use client';

import { useContext, type ReactNode } from 'react';
import Link from 'next/link';
import AuthContext from '@/context/AuthContext';
import CopyId from '@/components/ui/CopyId';
import { entityHref, viewerOf, type EntityType } from '@/lib/entityLinks';

/**
 * An ID on a panel screen — order number, task, project, quotation, enquiry,
 * supplier… — that opens that item's page in the panel, with the copy button
 * beside it as before.
 *
 * Whether it is a link depends on who is looking (lib/entityLinks.ts): a role
 * with no page for it gets the plain ID, still copyable, never a link that ends
 * on "Not authorized". No ID to show → nothing.
 *
 * The link's click and keys stop at the link, so it can sit in a clickable row
 * or card without also opening or toggling it. `newTab` for screens holding a
 * half-filled form, where leaving the page would lose the work.
 */
export default function EntityLink({
  type,
  id,
  value,
  query,
  label = 'ID',
  children,
  copy = true,
  newTab = false,
  className = '',
  linkClassName = '',
}: {
  type: EntityType;
  /** The record's database id — opens its own page. */
  id?: string | null;
  /** What is shown and copied (the order number, the project code…). */
  value?: string | null;
  /** What to search for when there is no own page (defaults to `value`). */
  query?: string | null;
  /** Names what is copied, for the toast and screen readers ("Order number"). */
  label?: string;
  /** Shown instead of `value` (e.g. "PRJ-12 Showroom"); `value` is still what is copied. */
  children?: ReactNode;
  copy?: boolean;
  newTab?: boolean;
  className?: string;
  linkClassName?: string;
}) {
  // Read without useAuth's provider check: panels also render where no session is mounted (tests, previews).
  const user = useContext(AuthContext)?.user;
  const shown = (value ?? '').trim();
  if (!shown && !children) return null;

  const href = entityHref(type, { id, query: query ?? shown }, viewerOf(user));
  const text = children ?? shown;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {href ? (
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
          {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          title={`Open this ${label.toLowerCase().replace(/ (number|id)$/, '')}${newTab ? ' (new tab)' : ''}`}
          className={`text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 hover:decoration-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm ${linkClassName}`}
        >
          {text}
        </Link>
      ) : (
        <span className={linkClassName}>{text}</span>
      )}
      {copy && shown && <CopyId value={shown} label={label} />}
    </span>
  );
}
