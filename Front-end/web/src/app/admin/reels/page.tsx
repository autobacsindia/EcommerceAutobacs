'use client';

import { useState } from 'react';
import ReelsQueue from '@/components/admin/reels/ReelsQueue';
import TeamReelUpload from '@/components/admin/reels/TeamReelUpload';

/**
 * Staff Reels: review shopper-uploaded reels and publish team reels.
 * Private admin route — /admin is disallowed in robots.ts and never in the sitemap;
 * the admin layout verifies the role server-side before this renders.
 */
export default function AdminReelsPage() {
  const [showUpload, setShowUpload] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reels</h1>
          <p className="text-sm text-gray-500">Short product videos for the app. Approve shoppers&apos; reels before they go public.</p>
        </div>
        <button type="button" onClick={() => setShowUpload((v) => !v)} aria-expanded={showUpload}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
          {showUpload ? 'Close upload' : 'Upload team reel'}
        </button>
      </header>
      {showUpload && <TeamReelUpload />}
      <ReelsQueue />
    </div>
  );
}
