'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Pencil, Check, X, Globe } from 'lucide-react';
import apiClient from '@/lib/api';
import SeoPanel, { EMPTY_SEO, toSeoFormValue, type SeoFormValue } from '@/components/admin/SeoPanel';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsindia.com';

interface PageRow {
  path: string;
  label: string;
  group: string;
  defaultTitle: string;
  defaultDescription: string;
  seo: Partial<SeoFormValue>;
  updatedAt: string | null;
}

function hasOverride(seo: Partial<SeoFormValue>): boolean {
  return Boolean(
    seo.metaTitle || seo.metaDescription || seo.canonical || seo.ogImage || seo.focusKeyword || seo.noindex
  );
}

export default function AdminPagesSeoPage() {
  const [rows, setRows] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editSeo, setEditSeo] = useState<SeoFormValue>(EMPTY_SEO);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: PageRow[] }>('/page-seo/admin');
      setRows(res.data || []);
    } catch (e) {
      console.error('Failed to load page SEO:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(row: PageRow) {
    setEditingPath(row.path);
    setEditSeo(toSeoFormValue(row.seo));
  }

  function cancelEdit() {
    setEditingPath(null);
    setEditSeo(EMPTY_SEO);
  }

  async function save(row: PageRow) {
    setSaving(true);
    try {
      const res = await apiClient.put<{ success: boolean; data: { seo: Partial<SeoFormValue> } }>(
        '/page-seo/admin',
        { path: row.path, seo: editSeo }
      );
      // Reflect the normalized server value back into the list.
      setRows((prev) =>
        prev.map((r) => (r.path === row.path ? { ...r, seo: res.data?.seo || {}, updatedAt: new Date().toISOString() } : r))
      );
      cancelEdit();
    } catch (e) {
      console.error('Failed to save page SEO:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Group rows by their `group` for display, preserving first-seen order.
  const grouped = useMemo(() => {
    const map = new Map<string, PageRow[]>();
    for (const r of rows) {
      if (!map.has(r.group)) map.set(r.group, []);
      map.get(r.group)!.push(r);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <Globe className="h-6 w-6 text-gray-500" />
        <h1 className="text-3xl font-bold">Pages SEO</h1>
      </div>
      <p className="text-gray-500 mb-8">
        Manage search-engine metadata for fixed pages that aren’t products or blog posts — careers,
        contact, legal, and more. Leave a field blank to use the page’s built-in default.
      </p>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([group, groupRows]) => (
            <section key={group}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{group}</h2>
              <div className="space-y-2">
                {groupRows.map((row) => {
                  const isEditing = editingPath === row.path;
                  const customized = hasOverride(row.seo);
                  return (
                    <div key={row.path} className="border border-gray-200 rounded-lg bg-white">
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{row.label}</span>
                            {row.seo.noindex && (
                              <span className="text-[10px] font-semibold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                noindex
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="truncate">{row.path}</span>
                            <span>·</span>
                            <span className={customized ? 'text-green-600' : 'text-gray-400'}>
                              {customized ? 'Custom SEO' : 'Using defaults'}
                            </span>
                          </div>
                        </div>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50 shrink-0"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                        )}
                      </div>

                      {isEditing && (
                        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                          {/* The shared SeoPanel renders as a self-contained block here. */}
                          <div className="grid grid-cols-1">
                            <SeoPanel
                              value={editSeo}
                              onChange={setEditSeo}
                              defaultOpen
                              defaults={{
                                title: row.defaultTitle,
                                description: row.defaultDescription,
                                url: `${SITE_URL}${row.path === '/' ? '' : row.path}`,
                              }}
                            />
                          </div>
                          <div className="flex justify-end gap-2 mt-4">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" /> Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => save(row)}
                              disabled={saving}
                              className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
