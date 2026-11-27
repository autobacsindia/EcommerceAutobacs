'use client';

import WebsiteErrorsPage from '@/components/clientErrors/WebsiteErrorsPage';

/**
 * The Developer (DevOps) team's "Website errors" page: every customer-facing error,
 * with Mark resolved. Other teams reaching this address get a 403 from the API
 * (routes/clientErrors.js) — the menu only shows it to the developer team.
 */
export default function TeamWebsiteErrorsPage() {
  return <WebsiteErrorsPage />;
}
