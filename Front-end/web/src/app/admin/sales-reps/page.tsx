'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { UserPlus, Check, X, Pencil, RefreshCw, ArrowLeft } from 'lucide-react';
import apiClient from '@/lib/api';
import { SalesRep } from '@/lib/leads';

/**
 * Name-only sales-rep profiles. These are labels (no login) used to attribute
 * CRM work — who claimed a lead, who closed an offline deal — under the shared
 * admin login. See backend models/SalesRep.js.
 */
export default function AdminSalesRepsPage() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // ?all=true so deactivated profiles remain visible for management.
      const res = await apiClient.get<{ success: boolean; reps: SalesRep[] }>('/sales-reps?all=true');
      if (res.success) setReps(res.reps);
    } catch (e) {
      console.error('[SalesReps] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addRep() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError('');
    try {
      const res = await apiClient.post<{ success: boolean }>('/sales-reps', { name });
      if (res.success) { setNewName(''); await load(); }
    } catch (e: unknown) {
      const msg = (e as { rawData?: { message?: string } })?.rawData?.message;
      setError(msg || 'Could not add rep (duplicate name?)');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    setBusy(true); setError('');
    try {
      const res = await apiClient.patch<{ success: boolean }>(`/sales-reps/${id}`, { name });
      if (res.success) { setEditId(null); await load(); }
    } catch (e: unknown) {
      const msg = (e as { rawData?: { message?: string } })?.rawData?.message;
      setError(msg || 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(rep: SalesRep) {
    setBusy(true); setError('');
    try {
      await apiClient.patch(`/sales-reps/${rep._id}`, { isActive: !rep.isActive });
      await load();
    } catch (e) {
      console.error('[SalesReps] toggle failed', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/admin/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> Back to leads
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales Reps</h1>
            <p className="text-sm text-gray-500">
              Name-only profiles used to credit who claims leads and closes deals. Not logins.
            </p>
          </div>
          <button onClick={load} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Add */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRep(); }}
            placeholder="New rep name (e.g. Rahul K)"
            maxLength={80}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={addRep}
            disabled={busy || !newName.trim()}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Add rep
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : reps.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400">No reps yet. Add one above.</td></tr>
            ) : (
              reps.map((rep) => (
                <tr key={rep._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {editId === rep._id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(rep._id); }}
                        autoFocus
                        maxLength={80}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className={`font-medium ${rep.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{rep.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${rep.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                      {rep.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {editId === rep._id ? (
                        <>
                          <button onClick={() => saveEdit(rep._id)} disabled={busy} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
                            <Check className="h-3 w-3" /> Save
                          </button>
                          <button onClick={() => setEditId(null)} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditId(rep._id); setEditName(rep.name); }} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                            <Pencil className="h-3 w-3" /> Rename
                          </button>
                          <button onClick={() => toggleActive(rep)} disabled={busy} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            {rep.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Deactivating a rep keeps their name on past leads/orders but removes them from the assign dropdown.
      </p>
    </div>
  );
}
