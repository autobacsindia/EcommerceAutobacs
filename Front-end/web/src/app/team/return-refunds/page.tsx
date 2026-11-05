import { redirect } from 'next/navigation';

/**
 * Return refunds moved into the Refunds page as its "Returned items" tab (2026-11-05).
 * Kept so old bookmarks, emails and notifications still land in the right place.
 */
export default function ReturnRefundsMoved() {
  redirect('/team/refunds?tab=returns');
}
