'use client';

import { useEffect, useRef } from 'react';

/**
 * The product's URL, editable, sitting directly under the title.
 *
 * Before this, the slug was derived from the title server-side and the admin
 * never saw it. That is fine until you want a shorter, cleaner or
 * keyword-chosen URL — and by then the product is saved, the URL is indexed,
 * and changing it means a redirect.
 *
 * Behaviour:
 *  • While untouched, it tracks the title live, so the common case needs no
 *    thought at all.
 *  • The moment the admin types in it, it stops tracking. Typing a slug and
 *    then fixing a typo in the title must not silently throw the slug away.
 *  • On an EXISTING product it never auto-tracks: the URL is live, Google knows
 *    it, and rewriting it because someone fixed a spelling in the title would
 *    break every inbound link. Changing it there is always deliberate.
 *
 * The value is normalised as it is typed, so what is shown is exactly what the
 * URL will be — the server applies the same `slugify` and would otherwise
 * silently change it after save.
 */

/**
 * Character-for-character the backend's `utils/slug.js`.
 *
 * It has to be: the server re-slugifies whatever is submitted, so any
 * difference here means the admin is shown one URL and the product saves with
 * another. "Toyota A&B" must become `toyota-a-b` in both, not `toyota-ab`.
 */
export function slugify(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function SlugField({
  title,
  value,
  onChange,
  /** True on the edit screen, where the URL is already live. */
  existing = false,
  baseUrl = 'autobacsindia.com/products/',
}: {
  title: string;
  value: string;
  onChange: (next: string) => void;
  existing?: boolean;
  baseUrl?: string;
}) {
  // Not state: flipping it must not re-render, and the effect reads it directly.
  const touched = useRef(existing);

  useEffect(() => {
    if (touched.current) return;
    onChange(slugify(title));
    // `onChange` is a setter from the parent; tracking it would re-run this on
    // every parent render and fight the admin's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <div className="mb-4">
      <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
        Product URL
      </label>
      <div className="flex items-stretch rounded-md border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500">
        <span className="flex items-center px-3 text-sm text-gray-500 bg-gray-50 border-r border-gray-300 rounded-l-md whitespace-nowrap">
          {baseUrl}
        </span>
        <input
          id="slug"
          type="text"
          name="slug"
          value={value}
          onChange={(e) => {
            touched.current = true;
            onChange(slugify(e.target.value));
          }}
          placeholder="auto-generated-from-the-title"
          className="flex-1 min-w-0 px-3 py-2 rounded-r-md focus:outline-none"
          aria-describedby="slug-help"
        />
      </div>
      <p id="slug-help" className="mt-1 text-xs text-gray-500">
        {existing
          ? 'Changing this changes the live URL. The old address will stop working unless a redirect is added.'
          : 'Filled in from the product name. Edit it to choose your own — it must be unique.'}
      </p>
    </div>
  );
}
