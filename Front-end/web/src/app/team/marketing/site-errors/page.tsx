'use client';

import WebsiteErrorsPage from '@/components/clientErrors/WebsiteErrorsPage';

/** Marketing: failed payments, checkout and careers problems customers hit. Read only (the API scopes it). */
export default function MarketingWebsiteErrorsPage() {
  return (
    <WebsiteErrorsPage intro="Problems customers hit while paying, checking out or applying for a job. Each row is one kind of problem, with how many times it happened. The developer team fixes them and marks them resolved." />
  );
}
