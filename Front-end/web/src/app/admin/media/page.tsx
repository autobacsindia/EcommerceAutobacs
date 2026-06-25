'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Star, Search, ExternalLink, Newspaper, ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Media = external Press Coverage cards rendered on the public /media page.
// (Blog posts + gallery/videos are managed in the Blog admin.)

interface PressItem {
  _id: string;
  publication: string;
  date: string;
  headline: string;
  excerpt: string;
  url: string;
  image: string;
  tilt: number | null;
  tape: '' | 'left' | 'center' | 'right';
  order: number;
  featured: boolean;
  status: 'draft' | 'published';
  createdAt: string;
}

const EMPTY_PRESS = {
  publication: '', date: '', headline: '', excerpt: '', url: '', image: '',
  tilt: '' as string, tape: '' as '' | 'left' | 'center' | 'right',
  order: '0', featured: false, status: 'published' as 'draft' | 'published',
};

export default function AdminMediaPage() {
  const [items, setItems] = useState<PressItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PressItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PRESS });
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(pagination.page), limit: '50' };
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get<any>(API_ENDPOINTS.ADMIN_MEDIA_PRESS, { params });
      if (res.success) {
        setItems(res.data);
        setPagination(p => ({ ...p, pages: res.pagination.pages }));
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [pagination.page, statusFilter]);

  useEffect(() => { setPagination(p => ({ ...p, page: 1 })); }, [statusFilter]);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_PRESS });
    setShowForm(true);
  }

  function openEdit(item: PressItem) {
    setEditing(item);
    setForm({
      publication: item.publication, date: item.date || '', headline: item.headline,
      excerpt: item.excerpt || '', url: item.url, image: item.image || '',
      tilt: item.tilt === null || item.tilt === undefined ? '' : String(item.tilt),
      tape: item.tape || '', order: String(item.order ?? 0),
      featured: item.featured, status: item.status,
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        publication: form.publication,
        date: form.date,
        headline: form.headline,
        excerpt: form.excerpt,
        url: form.url,
        image: form.image,
        tape: form.tape,
        order: Number(form.order) || 0,
        featured: form.featured,
        status: form.status,
        tilt: form.tilt === '' ? null : Number(form.tilt),
      };
      if (editing) {
        await apiClient.put(API_ENDPOINTS.ADMIN_MEDIA_PRESS_ITEM(editing._id), payload);
      } else {
        await apiClient.post(API_ENDPOINTS.ADMIN_MEDIA_PRESS, payload);
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...EMPTY_PRESS });
      fetchItems();
    } catch (_) {}
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this press item?')) return;
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_MEDIA_PRESS_ITEM(id));
      fetchItems();
    } catch (_) {}
  }

  const filtered = items.filter(i =>
    !search ||
    i.headline.toLowerCase().includes(search.toLowerCase()) ||
    i.publication.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Media / Press</h1>
          <p className="text-sm text-gray-500 mt-0.5">External press coverage cards shown on the public Media page.</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          New Press Item
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search headline or publication..."
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Headline</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Publication</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Order</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">No press items yet. Add your first one!</td></tr>
              ) : filtered.map(item => (
                <tr key={item._id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {item.featured && <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      {item.image
                        ? <img src={item.image} alt="" className="w-10 h-10 object-cover rounded border border-gray-200 shrink-0" />
                        : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0"><Newspaper className="h-4 w-4 text-gray-300" /></div>}
                      <span className="font-medium text-gray-900 line-clamp-1">{item.headline}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.publication}</td>
                  <td className="px-4 py-3 text-gray-500">{item.date || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{item.order}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open article"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(item._id)}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            disabled={pagination.page <= 1}
            onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
            className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center text-sm text-gray-600 px-3">Page {pagination.page} of {pagination.pages}</span>
          <button
            disabled={pagination.page >= pagination.pages}
            onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
            className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold">{editing ? 'Edit Press Item' : 'New Press Item'}</h2>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Publication *</label>
                  <input
                    required
                    value={form.publication}
                    onChange={e => setForm(f => ({ ...f, publication: e.target.value }))}
                    placeholder="Business Standard"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Date (display text)</label>
                  <input
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    placeholder="MAR 2, 2026"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Headline *</label>
                  <input
                    required
                    value={form.headline}
                    onChange={e => setForm(f => ({ ...f, headline: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Article URL *</label>
                  <input
                    required
                    type="url"
                    value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Image / clipping URL</label>
                  <input
                    value={form.image}
                    onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                    placeholder="https://..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Excerpt</label>
                  <textarea
                    value={form.excerpt}
                    onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
                    rows={3}
                    maxLength={600}
                    placeholder="One or two sentence summary..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as 'draft' | 'published' }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Order (lower = first)</label>
                  <input
                    type="number"
                    value={form.order}
                    onChange={e => setForm(f => ({ ...f, order: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Tape (optional)</label>
                  <select
                    value={form.tape}
                    onChange={e => setForm(f => ({ ...f, tape: e.target.value as '' | 'left' | 'center' | 'right' }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="">Auto</option>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Tilt ° (optional, -5 to 5)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={-5}
                    max={5}
                    value={form.tilt}
                    onChange={e => setForm(f => ({ ...f, tilt: e.target.value }))}
                    placeholder="auto"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 self-end pb-2">
                  <input
                    type="checkbox"
                    id="press-featured"
                    checked={form.featured}
                    onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))}
                    className="w-4 h-4 accent-red-600"
                  />
                  <label htmlFor="press-featured" className="text-sm font-medium text-gray-700">Featured (shown first)</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
