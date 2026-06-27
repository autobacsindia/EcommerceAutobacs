'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Search, Info } from 'lucide-react';

/**
 * Reusable SEO editor. Drop into any admin entity form (products today;
 * blog/category/pages next). Every field is an OPTIONAL override — when left
 * blank the public page falls back to values computed from the entity, so the
 * admin only fills these in for pages that need bespoke SEO.
 *
 * Pair with the backend `seo` sub-document (models/shared/seoSchema.js) and the
 * frontend `resolveSeo` helper (lib/seo.ts), which share these exact limits.
 */

export interface SeoFormValue {
  metaTitle: string;
  metaDescription: string;
  canonical: string;
  ogImage: string;
  noindex: boolean;
  focusKeyword: string;
}

export const EMPTY_SEO: SeoFormValue = {
  metaTitle: '',
  metaDescription: '',
  canonical: '',
  ogImage: '',
  noindex: false,
  focusKeyword: '',
};

/** Coerce an API `seo` object (which may be undefined / partial) into form state. */
export function toSeoFormValue(seo?: Partial<SeoFormValue> | null): SeoFormValue {
  return { ...EMPTY_SEO, ...(seo ?? {}) };
}

interface SeoPanelProps {
  value: SeoFormValue;
  onChange: (next: SeoFormValue) => void;
  /** Preview fallbacks + placeholders shown when a field is left blank. */
  defaults?: { title?: string; description?: string; url?: string };
  /** Start expanded. Default false (collapsed — it's an optional/advanced area). */
  defaultOpen?: boolean;
}

// Ideal SERP lengths (soft guidance) vs. hard caps (enforced by maxLength).
const TITLE_IDEAL = 60;
const TITLE_MAX = 70;
const DESC_IDEAL = 155;
const DESC_MAX = 200;

function Counter({ length, ideal, max }: { length: number; ideal: number; max: number }) {
  const color =
    length === 0 ? 'text-gray-400' : length > ideal ? 'text-amber-600' : 'text-green-600';
  return (
    <span className={`text-xs tabular-nums ${color}`}>
      {length}/{max}
      {length > ideal && length <= max ? ` · over ideal ${ideal}` : ''}
    </span>
  );
}

export default function SeoPanel({ value, onChange, defaults, defaultOpen = false }: SeoPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const set = <K extends keyof SeoFormValue>(key: K, v: SeoFormValue[K]) =>
    onChange({ ...value, [key]: v });

  const previewTitle = value.metaTitle.trim() || defaults?.title || 'Page title';
  const previewDesc =
    value.metaDescription.trim() ||
    defaults?.description ||
    'A short description of this page will appear here in search results.';
  const previewUrl = value.canonical.trim() || defaults?.url || 'https://autobacsindia.com/…';

  return (
    <div className="md:col-span-2 border border-gray-200 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-800">
          <Search className="h-4 w-4 text-gray-500" />
          Search engine optimization (SEO)
          <span className="text-xs font-normal text-gray-400">optional · overrides defaults</span>
        </span>
        {open ? (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {/* Google SERP preview */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
              Google preview
            </p>
            <p className="text-[#1a0dab] text-base leading-snug truncate">{previewTitle}</p>
            <p className="text-[#006621] text-xs truncate">{previewUrl}</p>
            <p className="text-gray-600 text-sm leading-snug line-clamp-2">{previewDesc}</p>
          </div>

          {/* Meta title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Meta title</label>
              <Counter length={value.metaTitle.length} ideal={TITLE_IDEAL} max={TITLE_MAX} />
            </div>
            <input
              type="text"
              value={value.metaTitle}
              maxLength={TITLE_MAX}
              onChange={(e) => set('metaTitle', e.target.value)}
              placeholder={defaults?.title ? `Default: ${defaults.title}` : 'Defaults to the entity name'}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Meta description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Meta description</label>
              <Counter length={value.metaDescription.length} ideal={DESC_IDEAL} max={DESC_MAX} />
            </div>
            <textarea
              value={value.metaDescription}
              maxLength={DESC_MAX}
              rows={2}
              onChange={(e) => set('metaDescription', e.target.value)}
              placeholder="Defaults to the short description"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Focus keyword — internal only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Focus keyword
            </label>
            <input
              type="text"
              value={value.focusKeyword}
              maxLength={100}
              onChange={(e) => set('focusKeyword', e.target.value)}
              placeholder="e.g. car body kit"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 flex items-start gap-1 text-xs text-gray-500">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Internal note for your team only. It is never shown to customers and is not used by
              Google for ranking — it just helps you keep each page focused on one topic.
            </p>
          </div>

          {/* Advanced: canonical + OG image */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-gray-600 select-none">
              Advanced
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Canonical URL
                </label>
                <input
                  type="url"
                  value={value.canonical}
                  onChange={(e) => set('canonical', e.target.value)}
                  placeholder="Leave blank — defaults to this page's own URL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Only set this to point search engines at a different primary URL for duplicate
                  content.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Social share image (Open Graph)
                </label>
                <input
                  type="url"
                  value={value.ogImage}
                  onChange={(e) => set('ogImage', e.target.value)}
                  placeholder="Defaults to the primary image"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </details>

          {/* noindex */}
          <label className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={value.noindex}
              onChange={(e) => set('noindex', e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-sm text-amber-800">
              <span className="font-medium">Hide from search engines (noindex)</span>
              <span className="block text-xs text-amber-700">
                Stops this page from appearing in Google. Use only for thin or duplicate pages —
                leave unchecked for anything you want found.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
