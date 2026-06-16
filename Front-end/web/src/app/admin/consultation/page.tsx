'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Eye, Trash2, ChevronLeft, ChevronRight, Calendar, Phone, Car, MapPin, Zap, Check } from 'lucide-react';
import apiClient from '@/lib/api';

interface Consultation {
  _id: string;
  name: string;
  whatsapp: string;
  city: string;
  vehicleNumber: string;
  makeModel: string;
  upgrades: string[];
  usage: string;
  drivingStyle: string;
  mode: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
  status: 'new' | 'contacted' | 'completed' | 'cancelled';
  createdAt: string;
}

interface Counts { new: number; contacted: number; completed: number; cancelled: number }

const STATUS_STYLES: Record<string, string> = {
  new:       'bg-blue-900/40 text-blue-300 border-blue-700/50',
  contacted: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  completed: 'bg-green-900/40 text-green-300 border-green-700/50',
  cancelled: 'bg-gray-800 text-gray-400 border-gray-700',
};

const STATUS_OPTIONS = ['new', 'contacted', 'completed', 'cancelled'] as const;

export default function AdminConsultationPage() {
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [counts, setCounts] = useState<Counts>({ new: 0, contacted: 0, completed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selected, setSelected] = useState<Consultation | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (tab !== 'all') params.set('status', tab);
      if (search) params.set('search', search);

      const res = await apiClient.get<{
        success: boolean;
        data: Consultation[];
        counts: Counts;
        pagination: { page: number; pages: number; total: number };
      }>(`/consultation/admin?${params.toString()}`);

      if (res.success) {
        setConsultations(res.data);
        setCounts(res.counts);
        setPagination(res.pagination);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => { load(1); }, [load]);

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id);
    try {
      await apiClient.patch(`/consultation/admin/${id}/status`, { status });
      setConsultations(prev => prev.map(c => c._id === id ? { ...c, status: status as Consultation['status'] } : c));
      if (selected?._id === id) setSelected(prev => prev ? { ...prev, status: status as Consultation['status'] } : prev);
      await load(pagination.page);
    } catch (e) { console.error(e); }
    finally { setUpdatingId(null); }
  }

  async function deleteConsultation(id: string) {
    if (!confirm('Delete this consultation request?')) return;
    try {
      await apiClient.delete(`/consultation/admin/${id}`);
      if (selected?._id === id) setSelected(null);
      await load(pagination.page);
    } catch (e) { console.error(e); }
  }

  const allTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consultation Requests</h1>
          <p className="text-sm text-gray-500">{allTotal} total leads captured</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, vehicle, city…"
            className="pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-72"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { key: 'all', label: 'All', count: allTotal },
          { key: 'new', label: 'New', count: counts.new },
          { key: 'contacted', label: 'Contacted', count: counts.contacted },
          { key: 'completed', label: 'Completed', count: counts.completed },
          { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${tab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'bg-gray-300 text-gray-700'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* Table */}
        <div className={`flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm ${selected ? 'hidden lg:block' : ''}`}>
          {loading ? (
            <div className="p-8 text-center text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin mx-auto mb-3" />
              Loading…
            </div>
          ) : consultations.length === 0 ? (
            <div className="p-16 text-center text-gray-400">
              <Zap className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="font-medium">No consultation requests yet</p>
              <p className="text-sm mt-1">They&apos;ll appear here once users submit the form.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Vehicle</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Upgrades</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {consultations.map(c => (
                  <tr
                    key={c._id}
                    onClick={() => setSelected(c)}
                    className={`cursor-pointer hover:bg-gray-50 transition-colors ${selected?._id === c._id ? 'bg-red-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" />{c.whatsapp}
                      </p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="font-medium text-gray-800">{c.makeModel}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" />{c.city}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {c.upgrades.slice(0, 2).map(u => (
                          <span key={u} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{u}</span>
                        ))}
                        {c.upgrades.length > 2 && <span className="text-xs text-gray-400">+{c.upgrades.length - 2}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={c.status}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateStatus(c._id, e.target.value)}
                        disabled={updatingId === c._id}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer focus:outline-none ${STATUS_STYLES[c.status]}`}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-white text-gray-800">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={e => { e.stopPropagation(); setSelected(c); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); deleteConsultation(c._id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">Showing {consultations.length} of {pagination.total}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => load(pagination.page - 1)} disabled={pagination.page <= 1} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-600">{pagination.page} / {pagination.pages}</span>
                <button onClick={() => load(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-full lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-900">{selected.name}</h3>
              <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">✕ Close</button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(100vh-14rem)]">
              {/* Status quick-change */}
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">STATUS</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => updateStatus(selected._id, s)}
                      disabled={updatingId === selected._id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${selected.status === s ? STATUS_STYLES[s] : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
                    >
                      {selected.status === s && <Check className="inline h-3 w-3 mr-1" />}
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contact */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
                <Row icon={<Phone className="h-4 w-4 text-green-500" />} label="WhatsApp" value={
                  <a href={`https://wa.me/${selected.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline font-medium">{selected.whatsapp}</a>
                } />
                <Row icon={<MapPin className="h-4 w-4 text-blue-500" />} label="City" value={selected.city} />
              </div>

              {/* Vehicle */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Car className="h-3.5 w-3.5" /> Vehicle</p>
                <Row label="Make & Model" value={selected.makeModel} />
                {selected.vehicleNumber && <Row label="Reg. Number" value={<span className="font-mono uppercase">{selected.vehicleNumber}</span>} />}
              </div>

              {/* Upgrades */}
              {selected.upgrades.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Upgrades Requested</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.upgrades.map(u => (
                      <span key={u} className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full font-medium">{u}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Driving profile */}
              {(selected.usage || selected.drivingStyle) && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Driving Profile</p>
                  {selected.usage && <Row label="Usage" value={selected.usage} />}
                  {selected.drivingStyle && <Row label="Style" value={selected.drivingStyle} />}
                </div>
              )}

              {/* Consultation pref */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Consultation</p>
                <Row label="Mode" value={selected.mode || '—'} />
                {selected.preferredDate && <Row label="Date" value={new Date(selected.preferredDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' })} />}
                {selected.preferredTime && <Row label="Time" value={selected.preferredTime} />}
              </div>

              {/* Notes */}
              {selected.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Build Vision</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 leading-relaxed">{selected.notes}</p>
                </div>
              )}

              <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">
                Submitted {new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex items-baseline gap-2">
        <span className="text-xs text-gray-400 shrink-0">{label}:</span>
        <span className="text-sm text-gray-800 wrap-break-word">{value}</span>
      </div>
    </div>
  );
}
