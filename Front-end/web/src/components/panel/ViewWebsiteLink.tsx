import { ExternalLink } from 'lucide-react';

/**
 * "View website" in the admin and team panel headers.
 *
 * A new tab, so the panel — often mid-way through an order — stays where it was.
 * A plain anchor, not next/link: the storefront is a different layout tree and
 * a client-side jump into it gains nothing in a fresh tab. Root-relative, so it
 * follows whichever host the panel is served from (never a hardcoded domain).
 * On a phone the label folds away and the icon carries the accessible name.
 */
export default function ViewWebsiteLink() {
  return (
    <a
      href="/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View website (opens in a new tab)"
      title="Open the website in a new tab"
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:border-blue-600 hover:text-blue-700"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">View website</span>
    </a>
  );
}
