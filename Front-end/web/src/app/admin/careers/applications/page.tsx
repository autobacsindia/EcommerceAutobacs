'use client';

/*
 * Admin → Careers → Applications. The in-house review inbox that replaces the
 * Google Sheet. Applicant files (resume, video answers) live in private
 * Cloudinary storage; opening a row fetches short-lived SIGNED URLs from the
 * backend — the raw asset URLs are never exposed.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, ArrowLeft, FileText, Video, ExternalLink, Inbox,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

type Status = 'new' | 'reviewing' | 'shortlisted' | 'rejected' | 'hired';

interface AppRow {
  _id: string;
  roleTitle: string;
  fullName: string;
  email: string;
  phone?: string;
  city: string;
  status: Status;
  createdAt: string;
}

interface SignedFile { url: string; bytes: number }
interface AppDetail extends AppRow {
  whatYouBring: string;
  howFound?: string;
  posting?: { title: string; slug: string } | null;
  files: {
    videoOne?: SignedFile; videoTwo?: SignedFile; resume?: SignedFile; support?: SignedFile;
  };
}

const STATUSES: Status[] = ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'];
const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-amber-100 text-amber-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  hired: 'bg-green-100 text-green-700',
  rejected: 'bg-gray-100 text-gray-500',
};

const fmtSize = (b?: number) => (b ? `${(b / (1024 * 1024)).toFixed(1)} MB` : '');

export default function AdminCareersApplicationsPage() {
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '25' };
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get<{ success: boolean; applications: AppRow[]; pagination: { pages: number; total: number } }>(
        API_ENDPOINTS.ADMIN_CAREERS_APPLICATIONS, { params },
      );
      if (res.success) {
        setRows(res.applications);
        setPages(res.pagination.pages);
        setTotal(res.pagination.total);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiClient.get<{ success: boolean; application: AppDetail }>(
        API_ENDPOINTS.ADMIN_CAREERS_APPLICATION(id),
      );
      if (res.success) {
        setDetail(res.application);
        setNotes((res.application as AppDetail & { adminNotes?: string }).adminNotes || '');
      }
    } catch (_) {}
    finally { setDetailLoading(false); }
  }

  // Confirm before any status change — it's an outward-facing action (a move to
  // "rejected" emails the candidate the rejection notice), so it shouldn't fire
  // on a stray click. No-op when the status isn't actually changing.
  function changeStatus(next: Status) {
    if (!detail || savingStatus || detail.status === next) return;
    const message =
      next === 'rejected'
        ? `Reject ${detail.fullName}'s application?\n\nThe candidate will be emailed the rejection notice (sent once). Continue?`
        : `Change ${detail.fullName}'s status to "${next}"?`;
    if (!window.confirm(message)) return;
    patchApplication(detail._id, { status: next });
  }

  async function patchApplication(id: string, body: Record<string, unknown>) {
    setSavingStatus(true);
    try {
      const res = await apiClient.patch<{ success: boolean; application: AppDetail }>(
        API_ENDPOINTS.ADMIN_CAREERS_APPLICATION(id), body,
      );
      if (res.success) {
        setDetail((d) => (d ? { ...d, ...res.application } : d));
        setRows((rs) => rs.map((r) => (r._id === id ? { ...r, status: res.application.status } : r)));
      }
    } catch (_) {}
    finally { setSavingStatus(false); }
  }

  const fileLinks = (d: AppDetail) => ([
    { label: 'Resume', icon: FileText, f: d.files.resume },
    { label: 'Supporting doc', icon: FileText, f: d.files.support },
    { label: 'Video answer 1', icon: Video, f: d.files.videoOne },
    { label: 'Video answer 2', icon: Video, f: d.files.videoTwo },
  ].filter((x) => x.f?.url));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/admin/careers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft className="h-4 w-4" /> Roles
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Applications{total > 0 ? ` (${total})` : ''}</h1>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none h-fit"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Inbox className="h-16 w-16 mx-auto mb-3" />
          <p>No applications yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Applicant</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Received</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r._id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => openDetail(r._id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.fullName}</p>
                    <p className="text-xs text-gray-400">{r.email}{r.city ? ` · ${r.city}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.roleTitle}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={(e) => { e.stopPropagation(); openDetail(r._id); }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center text-sm text-gray-600 px-3">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <div className="p-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                <div className="p-6 border-b border-gray-200 flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{detail.fullName}</h2>
                    <p className="text-sm text-gray-500">{detail.roleTitle}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[detail.status]}`}>{detail.status}</span>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-gray-400 block text-xs">Email</span>{detail.email}</div>
                    <div><span className="text-gray-400 block text-xs">Phone</span>{detail.phone || '—'}</div>
                    <div><span className="text-gray-400 block text-xs">City</span>{detail.city}</div>
                    <div><span className="text-gray-400 block text-xs">How found</span>{detail.howFound || '—'}</div>
                  </div>

                  <div>
                    <span className="text-gray-400 block text-xs mb-1">What they bring</span>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{detail.whatYouBring}</p>
                  </div>

                  <div>
                    <span className="text-gray-400 block text-xs mb-2">Files</span>
                    <div className="flex flex-wrap gap-2">
                      {fileLinks(detail).length === 0 ? (
                        <span className="text-sm text-gray-400">No files.</span>
                      ) : fileLinks(detail).map(({ label, icon: Icon, f }) => (
                        <a
                          key={label}
                          href={f!.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
                        >
                          <Icon className="h-4 w-4 text-red-600" />
                          {label}
                          <span className="text-xs text-gray-400">{fmtSize(f!.bytes)}</span>
                          <ExternalLink className="h-3 w-3 text-gray-400" />
                        </a>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-gray-400 block text-xs mb-2">Status</span>
                    <div className="flex flex-wrap gap-2">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={savingStatus}
                          onClick={() => changeStatus(s)}
                          className={`text-xs font-medium px-3 py-1.5 rounded-full capitalize transition-colors disabled:opacity-50 ${detail.status === s ? STATUS_STYLE[s] : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-400 block text-xs mb-1">Internal notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        disabled={savingStatus}
                        onClick={() => patchApplication(detail._id, { adminNotes: notes })}
                        className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
                      >
                        Save notes
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-100 flex justify-end">
                  <button onClick={() => setDetail(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
