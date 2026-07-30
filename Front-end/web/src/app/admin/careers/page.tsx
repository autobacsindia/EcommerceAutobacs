'use client';

/*
 * Admin → Careers. Manage the open roles that render on /careers. Replaces the
 * old "edit the code + redeploy" flow: create/edit/withdraw a role here and it
 * goes live (subject to the page's short ISR window + `careers` cache tag).
 *
 * Bullets ("What you'll own" / "What we need") are edited one-per-line and sent
 * as string arrays. SEO is optional (SeoPanel) — blank fields fall back to the
 * role's title/tagline on the public page.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Edit2, Trash2, Eye, EyeOff, GripVertical, Briefcase, Inbox } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import SeoPanel, { EMPTY_SEO, toSeoFormValue, type SeoFormValue } from '@/components/admin/SeoPanel';
import CareerCategoriesPanel, { type CareerCategory } from './CareerCategoriesPanel';

type Status = 'draft' | 'open' | 'closed' | 'filled';

interface Posting {
  _id: string;
  department: string;
  category?: string;
  title: string;
  slug: string;
  tagline?: string;
  experience?: string;
  intro?: string;
  responsibilities?: string[];
  requirements?: string[];
  closer?: string;
  location?: string;
  employmentType?: string;
  status: Status;
  sortOrder: number;
  seo?: SeoFormValue;
  createdAt: string;
}

const EMPTY_FORM = {
  title: '',
  department: '',
  category: '',
  slug: '',
  tagline: '',
  experience: '',
  intro: '',
  responsibilities: '', // newline-separated in the form
  requirements: '',
  closer: '',
  location: '',
  employmentType: 'FULL_TIME',
  status: 'draft' as Status,
  sortOrder: 0,
};

const STATUS_STYLE: Record<Status, string> = {
  open: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-600',
  closed: 'bg-amber-100 text-amber-700',
  filled: 'bg-blue-100 text-blue-700',
};

const linesToArray = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arrayToLines = (a?: string[]) => (a || []).join('\n');

export default function AdminCareersPage() {
  const [postings, setPostings] = useState<Posting[]>([]);
  const [categories, setCategories] = useState<CareerCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Posting | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPostings = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get<{ success: boolean; postings: Posting[] }>(
        API_ENDPOINTS.ADMIN_CAREERS_POSTINGS,
        { params },
      );
      if (res.success) setPostings(res.postings);
    } catch (_) {}
    finally { setLoading(false); }
  }, [statusFilter]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; categories: CareerCategory[] }>(
        API_ENDPOINTS.ADMIN_CAREERS_CATEGORIES,
      );
      if (res.success) { setCategories(res.categories); setCategoriesError(false); }
    } catch (_) {
      // Surface the failure: without categories the role form can't assign a
      // section, so the admin must know the list didn't load (vs. "none exist").
      setCategoriesError(true);
    }
  }, []);

  useEffect(() => { fetchPostings(); }, [fetchPostings]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setSeo(EMPTY_SEO);
    setError(null);
    setShowForm(true);
  }

  function startEdit(p: Posting) {
    setEditing(p);
    setError(null);
    setForm({
      title: p.title,
      department: p.department,
      category: p.category || '',
      slug: p.slug,
      tagline: p.tagline || '',
      experience: p.experience || '',
      intro: p.intro || '',
      responsibilities: arrayToLines(p.responsibilities),
      requirements: arrayToLines(p.requirements),
      closer: p.closer || '',
      location: p.location || '',
      employmentType: p.employmentType || 'FULL_TIME',
      status: p.status,
      sortOrder: p.sortOrder ?? 0,
    });
    setSeo(toSeoFormValue(p.seo));
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!form.department.trim()) { setError('Department is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title,
        department: form.department,
        category: form.category,
        // Only send slug when the admin typed one (blank => backend derives/keeps).
        ...(form.slug.trim() ? { slug: form.slug } : {}),
        tagline: form.tagline,
        experience: form.experience,
        intro: form.intro,
        responsibilities: linesToArray(form.responsibilities),
        requirements: linesToArray(form.requirements),
        closer: form.closer,
        location: form.location,
        employmentType: form.employmentType,
        status: form.status,
        sortOrder: Number(form.sortOrder) || 0,
        seo,
      };
      if (editing) {
        await apiClient.put(API_ENDPOINTS.ADMIN_CAREERS_POSTING(editing._id), payload);
      } else {
        await apiClient.post(API_ENDPOINTS.ADMIN_CAREERS_POSTINGS, payload);
      }
      setShowForm(false);
      setEditing(null);
      fetchPostings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the role.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(p: Posting) {
    // Open ⇄ Closed quick toggle from the list (draft/filled are set in the form).
    const next: Status = p.status === 'open' ? 'closed' : 'open';
    try {
      await apiClient.put(API_ENDPOINTS.ADMIN_CAREERS_POSTING(p._id), { status: next });
      fetchPostings();
    } catch (_) {}
  }

  async function remove(id: string) {
    if (!confirm('Delete this role? This cannot be undone.')) return;
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_CAREERS_POSTING(id));
      fetchPostings();
    } catch (_) {}
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Careers</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/careers/applications"
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            <Inbox className="h-4 w-4 text-gray-500" />
            Applications
          </Link>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New Role
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
          <option value="filled">Filled</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : postings.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Briefcase className="h-16 w-16 mx-auto mb-3" />
          <p>No roles yet. Create your first one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-10"></th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Department</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {postings.map((p) => (
                <tr key={p._id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-300"><GripVertical className="h-4 w-4" /></td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 line-clamp-1">{p.title}</span>
                    <span className="block text-xs text-gray-400">/{p.slug}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.category || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500">{p.department}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleStatus(p)}
                        title={p.status === 'open' ? 'Close role' : 'Open role'}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {p.status === 'open' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => startEdit(p)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(p._id)}
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

      {/* Managed section categories */}
      <CareerCategoriesPanel categories={categories} onChanged={fetchCategories} loadError={categoriesError} />

      {/* Role Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold">{editing ? 'Edit Role' : 'New Role'}</h2>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Title *</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Marketing Manager"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Department *</label>
                  <input
                    required
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                    placeholder="Marketing"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">Small label above the title on the card.</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Category (page section)</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white"
                  >
                    <option value="">— No category —</option>
                    {categories.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
                    {/* Preserve a legacy/orphan category the role already has that
                        isn't in the managed list, so editing doesn't silently drop it. */}
                    {form.category && !categories.some((c) => c.name === form.category) && (
                      <option value={form.category}>{form.category} (unmanaged)</option>
                    )}
                  </select>
                  {categoriesError ? (
                    <p className="text-xs text-red-500 mt-1">Couldn&apos;t load categories — reopen this form once the list loads to assign a section.</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">Groups roles into a section. Manage the list below; section order follows the category order.</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Tagline</label>
                  <input
                    value={form.tagline}
                    onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                    placeholder="Own the story. Own the growth."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Experience</label>
                  <input
                    value={form.experience}
                    onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
                    placeholder="3-5 years exp"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="draft">Draft (hidden)</option>
                    <option value="open">Open (live)</option>
                    <option value="closed">Closed (hidden)</option>
                    <option value="filled">Filled (hidden)</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Employment type</label>
                  <select
                    value={form.employmentType}
                    onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="FULL_TIME">Full time</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="CONTRACTOR">Contractor</option>
                    <option value="INTERN">Intern</option>
                    <option value="TEMPORARY">Temporary</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Location (optional)</label>
                  <input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Bengaluru, India"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Sort order</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Slug {editing ? '' : '(optional — auto-generated from title)'}
                  </label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    placeholder="marketing-manager"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Intro</label>
                  <textarea
                    value={form.intro}
                    onChange={(e) => setForm((f) => ({ ...f, intro: e.target.value }))}
                    rows={2}
                    placeholder="The paragraph shown when the role card is expanded."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    What you&apos;ll own <span className="text-gray-400 font-normal">(one bullet per line)</span>
                  </label>
                  <textarea
                    value={form.responsibilities}
                    onChange={(e) => setForm((f) => ({ ...f, responsibilities: e.target.value }))}
                    rows={4}
                    placeholder={'The entire marketing engine…\nEvery campaign from Meta to ground activations…'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    What we need <span className="text-gray-400 font-normal">(one bullet per line)</span>
                  </label>
                  <textarea
                    value={form.requirements}
                    onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
                    rows={4}
                    placeholder={'3-5 years running marketing that moved a P&L…'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Closer</label>
                  <textarea
                    value={form.closer}
                    onChange={(e) => setForm((f) => ({ ...f, closer: e.target.value }))}
                    rows={2}
                    placeholder="The highlighted 'why this matters' line at the bottom of the card."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                  />
                </div>
              </div>

              <SeoPanel
                value={seo}
                onChange={setSeo}
                defaults={{ title: form.title, description: form.tagline || form.intro }}
              />

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditing(null); }}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editing ? 'Update Role' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
