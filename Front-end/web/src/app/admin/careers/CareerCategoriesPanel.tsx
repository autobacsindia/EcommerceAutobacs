'use client';

/*
 * Admin → Careers → Categories. Manages the section vocabulary that groups roles
 * on the public /careers page (e.g. "Leadership / Executive", "Growth").
 *
 * Categories are a managed collection (CareerCategory): add / rename / reorder /
 * delete. A role references its category by NAME string, so a rename cascades to
 * every role that used it (handled server-side), and a delete is blocked while
 * any role still uses it (surfaced here as an inline error). Reorder drives the
 * section order on the public page.
 *
 * The parent owns the category list + refetch so the "New Role" form's dropdown
 * stays in sync; this panel only issues the writes and asks the parent to reload.
 */

import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, ChevronUp, ChevronDown } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

export interface CareerCategory {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

interface Props {
  categories: CareerCategory[];
  onChanged: () => void; // ask the parent to refetch after any write
  loadError?: boolean;   // the parent's category fetch failed
}

export default function CareerCategoriesPanel({ categories, onChanged, loadError }: Props) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await apiClient.post(API_ENDPOINTS.ADMIN_CAREERS_CATEGORIES, { name });
      setNewName('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the category.');
    } finally {
      setAdding(false);
    }
  }

  function startEdit(c: CareerCategory) {
    setEditingId(c._id);
    setEditName(c.name);
    setError(null);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    setBusyId(id);
    setError(null);
    try {
      await apiClient.put(API_ENDPOINTS.ADMIN_CAREERS_CATEGORY(id), { name });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the category.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: CareerCategory) {
    if (!confirm(`Delete the "${c.name}" category?`)) return;
    setBusyId(c._id);
    setError(null);
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_CAREERS_CATEGORY(c._id));
      onChanged();
    } catch (err) {
      // Backend returns a 409 with a helpful "N roles still use this" message.
      setError(err instanceof Error ? err.message : 'Could not delete the category.');
    } finally {
      setBusyId(null);
    }
  }

  // Move a category up/down. The whole new order is persisted in ONE request so
  // it can't half-apply; on any failure we still refetch so the UI reflects the
  // server's actual order rather than the optimistic swap.
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusyId(categories[index]._id);
    setError(null);
    try {
      await apiClient.put(API_ENDPOINTS.ADMIN_CAREERS_CATEGORIES_REORDER, {
        orderedIds: reordered.map((c) => c._id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder categories.');
    } finally {
      onChanged();
      setBusyId(null);
    }
  }

  return (
    <div className="mt-8 bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Categories</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Sections that group roles on the careers page. Order here sets the section order; renaming updates every role in it.
        </p>
      </div>

      {loadError && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <span>Couldn&apos;t load categories.</span>
          <button onClick={onChanged} className="font-medium underline underline-offset-2 hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {categories.length === 0 ? (
          <li className="px-4 py-4 text-sm text-gray-400">No categories yet. Add one below.</li>
        ) : (
          categories.map((c, i) => (
            <li key={c._id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || busyId === c._id}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                  title="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === categories.length - 1 || busyId === c._id}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                  title="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {editingId === c._id ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(c._id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    onClick={() => saveEdit(c._id)}
                    disabled={busyId === c._id}
                    className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600"
                    title="Save"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-800">{c.name}</span>
                  <button
                    onClick={() => startEdit(c)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                    title="Rename"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(c)}
                    disabled={busyId === c._id}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))
        )}
      </ul>

      <form onSubmit={addCategory} className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          disabled={adding || !newName.trim()}
          className="flex items-center gap-1.5 bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>
  );
}
