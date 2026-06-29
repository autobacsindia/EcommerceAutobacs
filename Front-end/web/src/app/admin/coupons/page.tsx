'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Plus, Edit, Trash2, ToggleLeft, ToggleRight, EyeOff, Eye } from 'lucide-react';
import Link from 'next/link';

interface Coupon {
  _id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  maxDiscountAmount?: number | null;
  minCartValue?: number;
  visibility: 'public' | 'hidden';
  usageLimit?: number | null;
  usedCount: number;
  expiresAt?: string | null;
  isActive: boolean;
}

interface ListResponse {
  success: boolean;
  coupons: Coupon[];
  total: number;
  page: number;
  pages: number;
}

function describe(c: Coupon): string {
  if (c.type === 'percentage') return `${c.value}% off${c.maxDiscountAmount ? ` (max ₹${c.maxDiscountAmount})` : ''}`;
  if (c.type === 'fixed') return `₹${c.value} off`;
  return 'Free shipping';
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { fetchCoupons(page); }, [page, debounced]);

  const fetchCoupons = async (p: number) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(p), limit: '20' });
      if (debounced) params.append('search', debounced);
      const res = await apiClient.get<ListResponse>(`${API_ENDPOINTS.COUPONS}?${params.toString()}`);
      setCoupons(res.coupons || []);
      setPages(res.pages || 1);
    } catch (err) {
      console.error('Failed to fetch coupons:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Delete coupon "${code}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(API_ENDPOINTS.COUPON_DETAIL(id));
      fetchCoupons(page);
    } catch (err: any) {
      alert(err.message || 'Failed to delete coupon');
    }
  };

  const toggleActive = async (c: Coupon) => {
    try {
      await apiClient.put(API_ENDPOINTS.COUPON_DETAIL(c._id), { isActive: !c.isActive });
      fetchCoupons(page);
    } catch (err: any) {
      alert(err.message || 'Failed to update coupon');
    }
  };

  if (loading && coupons.length === 0) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Coupons</h1>
        <Link href="/admin/coupons/create" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Coupon
        </Link>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by code…"
        className="mb-6 w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2"
      />

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Min cart</th>
              <th className="px-4 py-3">Visibility</th>
              <th className="px-4 py-3">Used</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c._id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-3">{describe(c)}</td>
                <td className="px-4 py-3">{c.minCartValue ? `₹${c.minCartValue}` : '—'}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    {c.visibility === 'public' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {c.visibility}
                  </span>
                </td>
                <td className="px-4 py-3">{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}</td>
                <td className="px-4 py-3">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(c)} title="Toggle active">
                    {c.isActive ? <ToggleRight className="h-6 w-6 text-green-600" /> : <ToggleLeft className="h-6 w-6 text-gray-400" />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/admin/coupons/edit/${c._id}`} className="text-blue-600 hover:text-blue-800"><Edit className="h-4 w-4" /></Link>
                    <button onClick={() => handleDelete(c._id, c.code)} className="text-red-600 hover:text-red-800"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {coupons.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No coupons found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
          <span className="px-3 py-1">{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
