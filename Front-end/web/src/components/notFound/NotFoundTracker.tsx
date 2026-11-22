'use client';

import { useEffect } from 'react';
import { pushToGtm } from '@/lib/gtm';

/**
 * Tells GA4 (through GTM) that someone hit a missing page, and where they came
 * from, so Marketing can find the old links that still send people here:
 * GTM event `page_not_found` with `page_path` and `page_referrer`.
 *
 * Fires once per missing page view. Never throws: analytics must not break the
 * page that is already the error path.
 */
export default function NotFoundTracker() {
  useEffect(() => {
    try {
      pushToGtm({
        event: 'page_not_found',
        page_path: `${window.location.pathname}${window.location.search}`.slice(0, 500),
        page_referrer: (document.referrer || '(direct)').slice(0, 500),
      });
    } catch {
      /* analytics is best-effort */
    }
  }, []);
  return null;
}
